-- Run manually in the Supabase SQL editor before publishing the frontend.
-- Uses existing RLS; does not grant shared viewers project-edit permission.
begin;
create or replace function public.add_roadmap_item_task(
  p_note_id uuid, p_item_id text, p_due_date timestamptz, p_due_timezone text
)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  note public.cork_notes;
  item jsonb;
  item_index integer;
  task_id uuid;
begin
  if not public.is_member() then
    raise exception 'Members only';
  end if;
  if p_due_date is null or p_due_timezone is null then
    raise exception 'Choose a task date and timezone';
  end if;
  perform now() at time zone p_due_timezone;

  -- Serialize retries and different steps on this same project, so replacing
  -- its JSON array cannot discard another request's task link.
  select * into note from public.cork_notes
  where id = p_note_id and author_id = auth.uid() and not archived
  for update;
  if note.id is null then
    raise exception 'Only the owner can schedule steps from an active project';
  end if;
  select value, (ordinality - 1)::integer into item, item_index
  from jsonb_array_elements(note.roadmap_items) with ordinality
  where value ->> 'id' = p_item_id;
  if item is null then
    raise exception 'This project step no longer exists';
  end if;
  if nullif(item ->> 'taskId', '') is not null then
    return (item ->> 'taskId')::uuid;
  end if;
  if coalesce(btrim(item ->> 'text'), '') = '' then
    raise exception 'This project step needs a title';
  end if;

  insert into public.tasks(title, assignee_ids, due_date, due_timezone, created_by)
  values (item ->> 'text', array[auth.uid()], p_due_date, p_due_timezone, auth.uid())
  returning id into task_id;
  update public.cork_notes
  set roadmap_items = jsonb_set(note.roadmap_items,
    array[item_index::text, 'taskId'], to_jsonb(task_id::text), true)
  where id = note.id;
  if not found then
    raise exception 'Could not link this task to its project';
  end if;
  return task_id;
end;
$$;
revoke all on function public.add_roadmap_item_task(uuid,text,timestamptz,text) from public, anon;
grant execute on function public.add_roadmap_item_task(uuid,text,timestamptz,text) to authenticated;
commit;

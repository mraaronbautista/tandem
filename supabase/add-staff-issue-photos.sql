-- Photos on the house manager's issue reports. Run once by hand in the Supabase
-- SQL editor, AFTER add-staff-issue-reports.sql and add-staff-push.sql.
-- Idempotent: safe to re-run. No AI session applies this without Aaron saying
-- "run it".
--
-- Shape of it:
--   * A PRIVATE storage bucket, issue-photos. Only JPEG, at most 5 MB each (the
--     house manager's phone shrinks them to about 400 KB first).
--   * A staff account can only ADD a photo to one of his own recent reports
--     (the path must be {his id}/{report id}-{random}.jpg, the report must be
--     his and no more than 7 days old, at most 100 photos per report). He can
--     never list, read, replace or delete photos, his own included.
--   * Members with Rentals can read every photo. Nobody else can.
--   * staff_issue_photos records each photo against its report. It is written
--     only by staff_add_issue_photo(); members can read it.
--   * His own report list now says how many photos each report has.
-- Nothing is ever deleted by this file. Backing photos up and clearing them
-- from Tandem is a later, separate step.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('issue-photos', 'issue-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'];

create table if not exists public.staff_issue_photos (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.staff_issue_reports(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  path text not null unique,                 -- {staff id}/{report id}-{random}.jpg in issue-photos
  size_bytes integer,
  created_at timestamptz not null default now()
);
create index if not exists staff_issue_photos_report_idx on public.staff_issue_photos (report_id, created_at);

alter table public.staff_issue_photos enable row level security;
drop policy if exists "rentals members read issue photos" on public.staff_issue_photos;
create policy "rentals members read issue photos" on public.staff_issue_photos
  for select to authenticated using (public.is_member() and public.has_permission('rentals'));
revoke all on public.staff_issue_photos from anon, authenticated;
grant select on public.staff_issue_photos to authenticated;

-- Is this storage path one the signed-in staff account may add right now?
create or replace function public.can_upload_issue_photo(object_name text)
returns boolean language sql stable security definer set search_path = public, storage as $$
  select public.is_staff()
    and object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    and split_part(object_name, '/', 1) = auth.uid()::text
    and exists (
      select 1 from public.staff_issue_reports r
      where r.id = public.safe_uuid(left(split_part(object_name, '/', 2), 36))
        and r.staff_id = auth.uid()
        and r.created_at > now() - interval '7 days'
    )
    and (
      select count(*) from storage.objects o
      where o.bucket_id = 'issue-photos'
        and o.name like split_part(object_name, '/', 1) || '/' || left(split_part(object_name, '/', 2), 36) || '-%'
    ) < 100
$$;
revoke all on function public.can_upload_issue_photo(text) from public, anon;
grant execute on function public.can_upload_issue_photo(text) to authenticated;

drop policy if exists "staff add issue photos" on storage.objects;
create policy "staff add issue photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'issue-photos' and public.can_upload_issue_photo(name));

drop policy if exists "rentals members read issue photo files" on storage.objects;
create policy "rentals members read issue photo files" on storage.objects
  for select to authenticated
  using (bucket_id = 'issue-photos' and public.is_member() and public.has_permission('rentals'));

-- Records an uploaded photo against a report. Safe to call twice for the same
-- file (a retry): the second call returns the first row.
create or replace function public.staff_add_issue_photo(p_report_id uuid, p_path text)
returns uuid language plpgsql security definer set search_path = public, storage as $$
declare
  v_id uuid;
  v_size integer;
begin
  if not public.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.staff_issue_reports r
    where r.id = p_report_id and r.staff_id = auth.uid() and r.created_at > now() - interval '7 days'
  ) then
    raise exception 'That report is not available' using errcode = '22023';
  end if;
  if p_path is null
     or split_part(p_path, '/', 1) <> auth.uid()::text
     or split_part(p_path, '/', 2) not like p_report_id::text || '-%'
     or p_path !~ '\.jpg$' then
    raise exception 'That photo does not belong to this report' using errcode = '22023';
  end if;
  select (metadata ->> 'size')::integer into v_size from storage.objects where bucket_id = 'issue-photos' and name = p_path;
  if not found then
    raise exception 'That photo has not finished uploading' using errcode = '22023';
  end if;
  select id into v_id from public.staff_issue_photos where path = p_path;
  if v_id is not null then
    return v_id;
  end if;
  if (select count(*) from public.staff_issue_photos where report_id = p_report_id) >= 100 then
    raise exception 'A report can hold up to 100 photos' using errcode = '54000';
  end if;
  insert into public.staff_issue_photos (report_id, staff_id, path, size_bytes)
  values (p_report_id, auth.uid(), p_path, v_size)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.staff_add_issue_photo(uuid, text) from public, anon;
grant execute on function public.staff_add_issue_photo(uuid, text) to authenticated;

-- His own recent reports, now with a photo count (the return shape changed).
drop function if exists public.staff_my_issue_reports();
create function public.staff_my_issue_reports()
returns table (id uuid, place text, body text, urgency text, created_at timestamptz, status text, photo_count integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select r.id, r.place, r.body, r.urgency, r.created_at,
         case when r.task_id is null or t.id is null or t.status = 'done' then 'done' else 'open' end,
         (select count(*)::integer from public.staff_issue_photos p where p.report_id = r.id)
  from public.staff_issue_reports r
  left join public.tasks t on t.id = r.task_id
  where r.staff_id = auth.uid()
  order by r.created_at desc
  limit 20;
end $$;
revoke all on function public.staff_my_issue_reports() from public, anon;
grant execute on function public.staff_my_issue_reports() to authenticated;

-- Lets Aaron's open task show new photos as they arrive.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'staff_issue_photos') then
    alter publication supabase_realtime add table public.staff_issue_photos;
  end if;
end $$;

-- Read-only check. Expect: the bucket (private), the table, and both functions.
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'issue-photos';
select tablename from pg_tables where schemaname = 'public' and tablename = 'staff_issue_photos';
select proname from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('can_upload_issue_photo', 'staff_add_issue_photo', 'staff_my_issue_reports') order by proname;

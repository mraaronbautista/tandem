-- "Report an issue" for the house manager: he picks a unit (or the whole
-- location), says what is wrong and how urgent it is; the database makes a
-- task for the admin (Aaron) and records the report so he can see later
-- whether it is open or done. Run once by hand in the Supabase SQL editor.
-- Idempotent: safe to re-run. No AI session applies this without Aaron
-- saying "run it".
--
-- A staff account still cannot read or write tasks or rental tables. The only
-- doors are three functions that check is_staff() and return or create a fixed
-- shape. Photos are not part of this version. The alert to Aaron is sent by
-- manual-notify's new `staff_issue` kind, which looks the report up itself and
-- never trusts text from the browser.

create table if not exists public.staff_issue_reports (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  property_id uuid references public.rental_properties(id) on delete set null,
  work_site_id uuid references public.work_sites(id) on delete set null,
  place text not null,                       -- the unit or location name at the time
  body text not null check (length(btrim(body)) between 1 and 500),
  urgency text not null check (urgency in ('can_wait', 'soon', 'urgent')),
  task_id uuid references public.tasks(id) on delete set null,
  notified_at timestamptz,                   -- set once, when the alert is sent
  created_at timestamptz not null default now(),
  constraint staff_issue_one_place check (property_id is null or work_site_id is null)
);
create index if not exists staff_issue_reports_staff_idx on public.staff_issue_reports (staff_id, created_at desc);

alter table public.staff_issue_reports enable row level security;
drop policy if exists "rentals members read issue reports" on public.staff_issue_reports;
create policy "rentals members read issue reports" on public.staff_issue_reports
  for select to authenticated using (public.is_member() and public.has_permission('rentals'));
revoke all on public.staff_issue_reports from anon, authenticated;
grant select on public.staff_issue_reports to authenticated;

-- Where he can report: every active unit, plus each location as a whole.
create or replace function public.staff_issue_places()
returns table (kind text, id uuid, name text, location_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select * from (
    select 'location'::text as kind, w.id, w.name, w.name as location_name
    from public.work_sites w
    where exists (select 1 from public.rental_properties p where p.work_site_id = w.id and p.active)
    union all
    select 'unit'::text, p.id, p.unit_name, coalesce(w.name, '')
    from public.rental_properties p left join public.work_sites w on w.id = p.work_site_id
    where p.active
  ) s
  order by s.location_name, case when s.kind = 'location' then 0 else 1 end, s.name;
end $$;
revoke all on function public.staff_issue_places() from public, anon;
grant execute on function public.staff_issue_places() to authenticated;

-- Creates the task for the admin(s) and the report, and returns the report id.
create or replace function public.staff_report_issue(p_property_id uuid, p_work_site_id uuid, p_body text, p_urgency text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_staff record;
  v_place text;
  v_body text := btrim(coalesce(p_body, ''));
  v_admins uuid[];
  v_task uuid;
  v_report uuid;
begin
  if not public.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if (p_property_id is null) = (p_work_site_id is null) then
    raise exception 'Choose where the issue is' using errcode = '22023';
  end if;
  if length(v_body) = 0 or length(v_body) > 500 then
    raise exception 'Describe the issue in 1 to 500 characters' using errcode = '22023';
  end if;
  if p_urgency not in ('can_wait', 'soon', 'urgent') then
    raise exception 'Choose how urgent it is' using errcode = '22023';
  end if;
  -- A runaway screen or a stuck button must not bury the admin in tasks.
  if (select count(*) from public.staff_issue_reports where staff_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many reports in the last hour. Call instead.' using errcode = '54000';
  end if;

  select display_name into v_staff from public.staff where id = auth.uid();
  if p_property_id is not null then
    select unit_name into v_place from public.rental_properties where id = p_property_id and active;
  else
    select name into v_place from public.work_sites where id = p_work_site_id;
  end if;
  if v_place is null then
    raise exception 'That place is no longer available' using errcode = '22023';
  end if;

  v_admins := array(select id from public.members where is_admin order by display_name);
  if coalesce(array_length(v_admins, 1), 0) = 0 then
    raise exception 'No one is set up to receive reports' using errcode = '22023';
  end if;

  insert into public.tasks (title, assignee_ids, priority, notes, created_by)
  values (
    'Issue at ' || v_place || ': ' || left(regexp_replace(v_body, '\s+', ' ', 'g'), 80),
    v_admins,
    case p_urgency when 'urgent' then 'high' when 'soon' then 'med' else 'low' end::task_priority,
    v_body || E'\n\nReported by ' || coalesce(v_staff.display_name, 'the house manager') || ' (house manager) on '
      || to_char(now() at time zone 'America/New_York', 'Mon DD, HH12:MI AM') || ' ET'
      || case p_urgency when 'urgent' then '. Marked urgent.' when 'soon' then '. Marked soon.' else '. Can wait.' end,
    v_admins[1]
  )
  returning id into v_task;

  insert into public.staff_issue_reports (staff_id, property_id, work_site_id, place, body, urgency, task_id)
  values (auth.uid(), p_property_id, p_work_site_id, v_place, v_body, p_urgency, v_task)
  returning id into v_report;
  return v_report;
end $$;
revoke all on function public.staff_report_issue(uuid, uuid, text, text) from public, anon;
grant execute on function public.staff_report_issue(uuid, uuid, text, text) to authenticated;

-- His own recent reports and whether each is still open.
create or replace function public.staff_my_issue_reports()
returns table (id uuid, place text, body text, urgency text, created_at timestamptz, status text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select r.id, r.place, r.body, r.urgency, r.created_at,
         case when r.task_id is null or t.id is null or t.status = 'done' then 'done' else 'open' end
  from public.staff_issue_reports r
  left join public.tasks t on t.id = r.task_id
  where r.staff_id = auth.uid()
  order by r.created_at desc
  limit 20;
end $$;
revoke all on function public.staff_my_issue_reports() from public, anon;
grant execute on function public.staff_my_issue_reports() to authenticated;

-- Read-only check. Expect: the table and the three functions.
select tablename from pg_tables where schemaname = 'public' and tablename = 'staff_issue_reports';
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('staff_issue_places', 'staff_report_issue', 'staff_my_issue_reports') order by proname;

-- ---------------------------------------------------------------------------
-- Recurrence fixes (incremental migration) — UI/UX follow-up, Oct 2026
-- ---------------------------------------------------------------------------
-- Run once in the Supabase SQL Editor, top to bottom. NOT applied by the
-- assistant. Idempotent: safe to re-run. Replaces the generator that
-- show-current-month-recurrences.sql / schema.sql installed. Fixes:
--
--   1. Selected weekdays created copies for days BEFORE the task's own
--      date (a Mon/Wed/Fri task made on the 28th got ~11 overdue copies).
--   2. Daily / weekly / every-2-weeks / every-3-weeks stepped by exact
--      hours in UTC, so a 3:00 PM Central task slid to 2:00 PM after the
--      clocks went back. Every type now steps in the task's own local
--      wall-clock time and converts at the end, so 3:00 PM stays 3:00 PM.
--   3. Monthly (and 2-monthly / quarterly / 6-monthly / annual) compounded:
--      Jan 31 -> Feb 28 -> Mar 28 forever. Each occurrence is now computed
--      from the ORIGINAL date (Jan 31 -> Feb 28 -> Mar 31 -> Apr 30).
--   4. Occurrences only existed for months somebody had opened in the app,
--      so a task due early on the 1st had no row (and no reminder) until
--      then. A scheduled job now keeps this month and next month ready.
--
-- Part 4 adds the function behind "this and future tasks" when editing a
-- repeating task. Part 5 is a read-only review and is deliberately LAST: the
-- Supabase SQL editor only shows the result of the final statement, so the
-- list of old back-filled copies is what you see when the run finishes.

-- ---------------------------------------------------------------------------
-- Part 1: the generator
-- ---------------------------------------------------------------------------
create or replace function generate_month_occurrences(template_id uuid, target_month date)
returns void as $$
declare
  template tasks%rowtype;
  month_start date := date_trunc('month', target_month)::date;
  month_end date := (date_trunc('month', target_month) + interval '1 month - 1 day')::date;
  local_start timestamp;   -- the template's own date + wall-clock time, in its own zone
  start_date date;
  wall_time time;
  step_days integer;
  step_months integer;
  last_k integer;
begin
  select * into template from tasks where id = template_id;
  if not found or template.recurrence::text = 'none'
     or template.recurrence_series_id <> template.id or template.due_date is null then
    return;
  end if;

  local_start := template.due_date at time zone template.due_timezone;
  start_date := local_start::date;
  wall_time := local_start::time;

  if template.recurrence::text = 'selected_weekdays' then
    -- Starts at the template's own date, never earlier in the month.
    insert into tasks (
      title, assignee_ids, priority, icon, due_date, due_timezone, duration_minutes,
      source, source_note, notes, checklist, recurrence, recurrence_days,
      created_by, recurrence_series_id
    )
    select template.title, template.assignee_ids, template.priority, template.icon,
      (day_stamp::date + wall_time) at time zone template.due_timezone,
      template.due_timezone, template.duration_minutes, template.source,
      template.source_note, template.notes, template.checklist,
      template.recurrence, template.recurrence_days,
      template.created_by, template.id
    from generate_series(greatest(month_start, start_date)::timestamp, month_end::timestamp, interval '1 day') as days(day_stamp)
    where extract(dow from day_stamp)::smallint = any(template.recurrence_days)
      and (day_stamp::date + wall_time) at time zone template.due_timezone <> template.due_date
      and not exists (
        select 1 from task_recurrence_exclusions e
        where e.recurrence_series_id = template.id
          and e.due_date = (day_stamp::date + wall_time) at time zone template.due_timezone
      )
      -- One copy per local day: an existing copy that is a little off (for
      -- example one finished early at the old, shifted hour) is not doubled up.
      and not exists (
        select 1 from tasks t2
        where t2.recurrence_series_id = template.id and t2.due_date is not null
          and (t2.due_date at time zone template.due_timezone)::date = day_stamp::date
      )
    on conflict (recurrence_series_id, due_date)
      where recurrence_series_id is not null and due_date is not null do nothing;
    return;
  end if;

  step_days := case template.recurrence::text
    when 'daily' then 1
    when 'weekly' then 7
    when 'biweekly' then 14
    when 'every_3_weeks' then 21
  end;
  step_months := case template.recurrence::text
    when 'monthly' then 1
    when 'every_2_months' then 2
    when 'quarterly' then 3
    when 'every_6_months' then 6
    when 'annually' then 12
  end;
  if step_days is null and step_months is null then
    return;
  end if;

  -- How many steps from the template reach the end of the target month.
  if step_days is not null then
    last_k := greatest(0, ceil((month_end - start_date)::numeric / step_days))::integer;
  else
    last_k := greatest(0,
      ((extract(year from month_end)::integer - extract(year from start_date)::integer) * 12
        + extract(month from month_end)::integer - extract(month from start_date)::integer) / step_months + 1);
  end if;

  -- Occurrence k is local_start + k steps, computed from the ORIGINAL start
  -- (not from the previous occurrence) in wall-clock time, then converted to
  -- an instant. Day steps on a plain timestamp are calendar days, so a
  -- daylight-saving change cannot shift the time; month steps clamp to the
  -- month's last day each time without carrying the clamp forward.
  insert into tasks (
    title, assignee_ids, priority, icon, due_date, due_timezone, duration_minutes,
    source, source_note, notes, checklist, recurrence, recurrence_days,
    created_by, recurrence_series_id
  )
  select template.title, template.assignee_ids, template.priority, template.icon,
    occ.local_ts at time zone template.due_timezone,
    template.due_timezone, template.duration_minutes, template.source,
    template.source_note, template.notes, template.checklist,
    template.recurrence, template.recurrence_days,
    template.created_by, template.id
  from (
    select case
      when step_days is not null then local_start + (k * step_days) * interval '1 day'
      else local_start + (k * step_months) * interval '1 month'
    end as local_ts
    from generate_series(0, last_k) as g(k)
  ) occ
  where occ.local_ts::date between month_start and month_end
    and occ.local_ts at time zone template.due_timezone <> template.due_date
    and not exists (
      select 1 from task_recurrence_exclusions e
      where e.recurrence_series_id = template.id
        and e.due_date = occ.local_ts at time zone template.due_timezone
    )
    -- One copy per local day (see the same guard above).
    and not exists (
      select 1 from tasks t2
      where t2.recurrence_series_id = template.id and t2.due_date is not null
        and (t2.due_date at time zone template.due_timezone)::date = occ.local_ts::date
    )
  on conflict (recurrence_series_id, due_date)
    where recurrence_series_id is not null and due_date is not null do nothing;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------------
-- Part 2: repair future copies the old generator got wrong
-- ---------------------------------------------------------------------------
-- Deletes only FUTURE, NOT-DONE copies of non-weekday repeating tasks whose
-- time of day is off (the daylight-saving slide) or, for month-based types,
-- whose day of the month is not what the new rule gives (the 28th drift),
-- then regenerates this month and next. Completed and past copies are left
-- alone. Same "app.recurrence_sync" guard the template-edit trigger uses, so
-- the deletes are not remembered as deliberate user deletions.
do $$
declare
  tpl tasks%rowtype;
  tpl_local timestamp;
begin
  for tpl in
    select * from tasks
    where recurrence_series_id = id and due_date is not null
      and recurrence::text not in ('none', 'selected_weekdays')
  loop
    tpl_local := tpl.due_date at time zone tpl.due_timezone;
    perform set_config('app.recurrence_sync', '1', true);
    delete from tasks occ
    where occ.recurrence_series_id = tpl.id
      and occ.id <> tpl.id
      and occ.status <> 'done'
      and occ.due_date >= now()
      and (
        (occ.due_date at time zone tpl.due_timezone)::time <> tpl_local::time
        or (
          tpl.recurrence::text in ('monthly', 'every_2_months', 'quarterly', 'every_6_months', 'annually')
          and extract(day from (occ.due_date at time zone tpl.due_timezone))::integer <>
            least(
              extract(day from tpl_local)::integer,
              extract(day from (date_trunc('month', occ.due_date at time zone tpl.due_timezone) + interval '1 month - 1 day'))::integer
            )
        )
      );
    perform set_config('app.recurrence_sync', '0', true);
    perform generate_month_occurrences(tpl.id, current_date);
    perform generate_month_occurrences(tpl.id, (current_date + interval '1 month')::date);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Part 3: keep this month and next month ready (no one has to open the app)
-- ---------------------------------------------------------------------------
-- Only the database job calls this; browsers still use
-- ensure_month_recurrences(), which checks the signed-in member.
create or replace function ensure_upcoming_recurrences()
returns void as $$
declare template_id uuid;
begin
  for template_id in
    select id from tasks where recurrence::text <> 'none' and recurrence_series_id = id
  loop
    perform generate_month_occurrences(template_id, current_date);
    perform generate_month_occurrences(template_id, (current_date + interval '1 month')::date);
  end loop;
end;
$$ language plpgsql security definer;

revoke all on function ensure_upcoming_recurrences() from public, anon, authenticated;

-- Hourly. pg_cron is already in use for notify-reminders, so the extension is
-- enabled. Re-running this statement updates the job rather than adding a second.
select cron.schedule('ensure-upcoming-recurrences', '5 * * * *', $job$select ensure_upcoming_recurrences()$job$);

-- Run once right now so next month exists immediately.
select ensure_upcoming_recurrences();

-- ---------------------------------------------------------------------------
-- Part 4: "this and future tasks" edits
-- ---------------------------------------------------------------------------
-- Copies the listed fields from a patch onto the repeating task's template
-- (so copies made later pick them up) and onto every open copy from the
-- target forward. `security invoker`: row-level security still applies, so
-- you can only change copies you are allowed to edit; anything else is
-- skipped, and a reassignment you are not allowed to make is refused by the
-- existing reassignment trigger. Schedule fields are NOT handled here (the
-- existing template-edit trigger owns those).
create or replace function update_recurring_series_future(target_task_id uuid, patch jsonb)
returns void as $$
declare
  target tasks%rowtype;
  series uuid;
begin
  select * into target from tasks where id = target_task_id;
  if not found then return; end if;
  series := target.recurrence_series_id;
  if series is null then
    raise exception 'This task is not part of a repeating series.';
  end if;

  update tasks set
    title = case when patch ? 'title' then patch->>'title' else title end,
    priority = case when patch ? 'priority' then (patch->>'priority')::task_priority else priority end,
    icon = case when patch ? 'icon' then patch->>'icon' else icon end,
    assignee_ids = case when patch ? 'assignee_ids'
      then array(select jsonb_array_elements_text(patch->'assignee_ids'))::uuid[] else assignee_ids end,
    duration_minutes = case when patch ? 'duration_minutes'
      then nullif(patch->>'duration_minutes', '')::integer else duration_minutes end,
    source = case when patch ? 'source' then (patch->>'source')::task_source else source end,
    source_note = case when patch ? 'source_note' then patch->>'source_note' else source_note end,
    notes = case when patch ? 'notes' then patch->>'notes' else notes end,
    checklist = case when patch ? 'checklist' then patch->'checklist' else checklist end
  where recurrence_series_id = series
    and (
      id = series
      or (id <> target.id and status <> 'done' and due_date >= target.due_date)
    );
end;
$$ language plpgsql security invoker;

-- ---------------------------------------------------------------------------
-- Part 5: READ-ONLY review of copies the old weekday rule created in the past
-- ---------------------------------------------------------------------------
-- These are not-done copies that sit BEFORE their repeating task's own start
-- date. Nothing here changes data. Look the list over, and only if every row
-- is junk, run the delete below it (it is commented out on purpose, so
-- copy it out and run it by itself).
select occ.id, occ.title, occ.due_date, tpl.due_date as task_starts
from tasks occ
join tasks tpl on tpl.id = occ.recurrence_series_id and tpl.id <> occ.id
where tpl.recurrence = 'selected_weekdays'
  and occ.status <> 'done'
  and occ.due_date < tpl.due_date
order by tpl.title, occ.due_date;

-- delete from tasks occ
-- using tasks tpl
-- where tpl.id = occ.recurrence_series_id and tpl.id <> occ.id
--   and tpl.recurrence = 'selected_weekdays'
--   and occ.status <> 'done'
--   and occ.due_date < tpl.due_date;

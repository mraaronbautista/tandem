-- Run once in the Supabase SQL editor for an existing Tandem project.
-- Safe to re-run if you already applied an earlier version of this file —
-- every statement is idempotent (add column/create table if not exists,
-- create or replace function, drop ... if exists before create).
--
-- Materializes every recurring task's upcoming occurrences ahead of time,
-- for whichever calendar month is actually being viewed, rather than
-- spawning one at a time only after the current occurrence is completed.
-- Originally this applied only to "selected weekdays" schedules — every
-- other recurrence type (daily/weekly/monthly/...) instead spawned
-- exactly one next occurrence on completion via spawn_next_recurrence(),
-- so a still-open recurring task's future occurrences simply didn't
-- exist yet anywhere, including on the calendar. This migration retires
-- that trigger and brings every recurrence type onto the same
-- template/materialize model, so picking any Repeats option shows its
-- upcoming occurrences on the calendar immediately.

alter table tasks add column if not exists recurrence_series_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_recurrence_series_id_fkey'
      and conrelid = 'tasks'::regclass
  ) then
    alter table tasks add constraint tasks_recurrence_series_id_fkey
      foreign key (recurrence_series_id) references tasks (id) on delete cascade;
  end if;
end;
$$;

create unique index if not exists tasks_recurrence_series_due_unique
  on tasks (recurrence_series_id, due_date)
  where recurrence_series_id is not null and due_date is not null;

create table if not exists task_recurrence_exclusions (
  recurrence_series_id uuid not null references tasks (id) on delete cascade,
  due_date timestamptz not null,
  primary key (recurrence_series_id, due_date)
);

alter table task_recurrence_exclusions enable row level security;

create or replace function remember_deleted_recurrence_occurrence()
returns trigger as $$
begin
  if old.recurrence_series_id is not null
     and old.recurrence_series_id <> old.id
     and pg_trigger_depth() = 1
     and coalesce(current_setting('app.recurrence_sync', true), '0') <> '1' then
    insert into task_recurrence_exclusions (recurrence_series_id, due_date)
    values (old.recurrence_series_id, old.due_date)
    on conflict do nothing;
  end if;
  return old;
end;
$$ language plpgsql security definer;

drop trigger if exists tasks_remember_deleted_recurrence_occurrence on tasks;
create trigger tasks_remember_deleted_recurrence_occurrence
before delete on tasks
for each row execute function remember_deleted_recurrence_occurrence();

-- Retire the old one-at-a-time, completion-triggered model. Every
-- recurrence type now goes through generate_month_occurrences below
-- instead — leaving this trigger in place would double up occurrences
-- (one from materialization, another spawned on completion) for any
-- non-selected_weekdays recurring task.
drop trigger if exists tasks_spawn_recurrence on tasks;
drop function if exists spawn_next_recurrence();

-- Every active recurring task (any recurrence <> 'none') becomes a
-- template pointing to its own id, not just selected_weekdays schedules.
create or replace function prepare_recurrence_series()
returns trigger as $$
begin
  if new.recurrence::text <> 'none' and new.recurrence_series_id is null then
    new.recurrence_series_id := new.id;
  elsif new.recurrence::text = 'none' and new.recurrence_series_id = new.id then
    new.recurrence_series_id := null;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists tasks_prepare_recurrence_series on tasks;
create trigger tasks_prepare_recurrence_series
before insert or update of recurrence, recurrence_days on tasks
for each row execute function prepare_recurrence_series();

-- Existing recurring tasks of every type become templates, not just
-- selected-weekday ones. Intended before any pre-generated occurrences
-- exist for them — safe to re-run (only touches rows with no series yet).
update tasks
set recurrence_series_id = id
where recurrence::text <> 'none'
  and recurrence_series_id is null;

-- Drop the old single-argument, selected_weekdays-only version — the
-- two-argument generate_month_occurrences(template_id, target_month)
-- below replaces it for every recurrence type, including the current
-- month (sync_current_month_recurrences now just passes current_date).
drop function if exists generate_current_month_occurrences(uuid);

-- Materializes template_id's occurrences landing inside target_month.
-- Selected-weekday schedules match by day-of-week, over every day in the
-- month (no fixed step to anchor from). Every other recurrence type has
-- a fixed step (a day count for daily/weekly/biweekly/every_3_weeks, a
-- calendar-month count for monthly/every_2_months/quarterly/
-- every_6_months/annually) and is walked forward from the template's own
-- due_date via generate_series — the same '+ interval' arithmetic the
-- old per-completion spawn used (so a monthly task recurring on the 31st
-- still compounds/clamps exactly like it always has, e.g. Jan 31 -> Feb
-- 28 -> Mar 28, not Mar 31), just computed as a sequence up front instead
-- of one step at a time. Both branches share the same assignee
-- resolution, exclusion check, and (recurrence_series_id, due_date)
-- on-conflict dedup.
create or replace function generate_month_occurrences(template_id uuid, target_month date)
returns void as $$
declare
  template tasks%rowtype;
  month_start date := date_trunc('month', target_month)::date;
  month_end date := (date_trunc('month', target_month) + interval '1 month - 1 day')::date;
  month_end_ts timestamptz;
  wall_time time;
  assignee_id uuid;
  step interval;
begin
  select * into template from tasks where id = template_id;
  if not found or template.recurrence::text = 'none'
     or template.recurrence_series_id <> template.id or template.due_date is null then
    return;
  end if;

  wall_time := (template.due_date at time zone template.due_timezone)::time;
  select id into assignee_id from members
  where lower(display_name) = case when template.who = 'assistant' then 'aaron' else 'ada' end
  limit 1;

  if template.recurrence::text = 'selected_weekdays' then
    insert into tasks (
      title, who, priority, icon, due_date, due_timezone, duration_minutes,
      source, source_note, notes, checklist, recurrence, recurrence_days,
      created_by, recurrence_series_id
    )
    select template.title, template.who, template.priority, template.icon,
      (day_stamp::date + wall_time) at time zone template.due_timezone,
      template.due_timezone, template.duration_minutes, template.source,
      template.source_note, template.notes, template.checklist,
      template.recurrence, template.recurrence_days,
      coalesce(assignee_id, template.created_by), template.id
    from generate_series(month_start::timestamp, month_end::timestamp, interval '1 day') as days(day_stamp)
    where extract(dow from day_stamp)::smallint = any(template.recurrence_days)
      and (day_stamp::date + wall_time) at time zone template.due_timezone <> template.due_date
      and not exists (
        select 1 from task_recurrence_exclusions e
        where e.recurrence_series_id = template.id
          and e.due_date = (day_stamp::date + wall_time) at time zone template.due_timezone
      )
    on conflict (recurrence_series_id, due_date)
      where recurrence_series_id is not null and due_date is not null do nothing;
    return;
  end if;

  step := case template.recurrence::text
    when 'daily' then interval '1 day'
    when 'weekly' then interval '7 days'
    when 'biweekly' then interval '14 days'
    when 'every_3_weeks' then interval '21 days'
    when 'monthly' then interval '1 month'
    when 'every_2_months' then interval '2 months'
    when 'quarterly' then interval '3 months'
    when 'every_6_months' then interval '6 months'
    when 'annually' then interval '1 year'
  end;
  if step is null then
    return;
  end if;

  -- One day past month_end, in the template's own zone, so a candidate
  -- landing on the last day of the month is still inside generate_series'
  -- inclusive upper bound.
  month_end_ts := (month_end + 1)::timestamp at time zone template.due_timezone;

  insert into tasks (
    title, who, priority, icon, due_date, due_timezone, duration_minutes,
    source, source_note, notes, checklist, recurrence, recurrence_days,
    created_by, recurrence_series_id
  )
  select template.title, template.who, template.priority, template.icon,
    occurrence, template.due_timezone, template.duration_minutes, template.source,
    template.source_note, template.notes, template.checklist,
    template.recurrence, template.recurrence_days,
    coalesce(assignee_id, template.created_by), template.id
  from generate_series(template.due_date, month_end_ts, step) as occ(occurrence)
  where (occurrence at time zone template.due_timezone)::date between month_start and month_end
    and occurrence <> template.due_date
    and not exists (
      select 1 from task_recurrence_exclusions e
      where e.recurrence_series_id = template.id and e.due_date = occurrence
    )
  on conflict (recurrence_series_id, due_date)
    where recurrence_series_id is not null and due_date is not null do nothing;
end;
$$ language plpgsql security definer;

-- Keeps a template's own materialized occurrences honest as it's edited,
-- and always regenerates the real current calendar month right away
-- (independent of whichever month the editor happens to be browsing —
-- see ensure_month_recurrences below for materializing whatever month is
-- actually being viewed).
create or replace function sync_current_month_recurrences()
returns trigger as $$
begin
  if tg_op = 'UPDATE' and old.recurrence_series_id = old.id and (
    new.recurrence::text <> old.recurrence::text
    or new.due_date is distinct from old.due_date
    or new.due_timezone is distinct from old.due_timezone
    or new.recurrence_days is distinct from old.recurrence_days
  ) then
    perform set_config('app.recurrence_sync', '1', true);
    delete from tasks where recurrence_series_id = old.id and id <> old.id and status <> 'done';
    perform set_config('app.recurrence_sync', '0', true);
  end if;
  if new.recurrence::text <> 'none' and new.recurrence_series_id = new.id then
    perform generate_month_occurrences(new.id, current_date);
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists tasks_sync_current_month_recurrences on tasks;
create trigger tasks_sync_current_month_recurrences
after insert or update of recurrence, recurrence_days, due_date, due_timezone on tasks
for each row execute function sync_current_month_recurrences();

-- No longer needed now that sync_current_month_recurrences calls the
-- two-argument generate_month_occurrences directly for current_date, and
-- the frontend only ever calls the parameterized ensure_month_recurrences
-- below (even for "now," it just passes today's date as the target).
drop function if exists ensure_current_month_recurrences();

-- Called from the client (see ensureMonthRecurrences in tasks.js) whenever
-- the viewed month changes, so every recurring template's occurrences for
-- that month exist by the time the calendar renders it.
create or replace function ensure_month_recurrences(target_month date)
returns void as $$
declare template_id uuid;
begin
  if not exists (select 1 from members where id = auth.uid()) then raise exception 'Not authorized'; end if;
  for template_id in select id from tasks
    where recurrence::text <> 'none' and recurrence_series_id = id
  loop
    perform generate_month_occurrences(template_id, target_month);
  end loop;
end;
$$ language plpgsql security definer;

create or replace function delete_recurring_task(target_task_id uuid, delete_future boolean)
returns void as $$
declare
  target tasks%rowtype;
  series_id uuid;
  replacement_id uuid;
begin
  if not exists (select 1 from members where id = auth.uid()) then
    raise exception 'Not authorized';
  end if;

  select * into target from tasks where id = target_task_id;
  if not found then return; end if;
  series_id := coalesce(target.recurrence_series_id, target.id);

  if delete_future then
    -- Preserve earlier history without its old parent link, then delete
    -- the template; its cascade removes the selected and later rows.
    update tasks set recurrence = 'none', recurrence_days = '{}',
      recurrence_series_id = null
    where recurrence_series_id = series_id
      and id <> series_id
      and due_date < target.due_date;
    delete from tasks where id = series_id;
    return;
  end if;

  if target.id <> series_id then
    delete from tasks where id = target.id;
    return;
  end if;

  -- "Only this" can also be chosen on the visible template occurrence.
  -- Promote another occurrence to template before removing the old one.
  select id into replacement_id from tasks
  where recurrence_series_id = series_id and id <> series_id
  order by due_date nulls last limit 1;

  if replacement_id is null then
    delete from tasks where id = target.id;
    return;
  end if;

  update tasks set recurrence_series_id = replacement_id where id = replacement_id;
  update tasks set recurrence_series_id = replacement_id
    where recurrence_series_id = series_id and id <> series_id;
  update task_recurrence_exclusions set recurrence_series_id = replacement_id
    where recurrence_series_id = series_id;
  insert into task_recurrence_exclusions (recurrence_series_id, due_date)
    values (replacement_id, target.due_date) on conflict do nothing;
  delete from tasks where id = target.id;
end;
$$ language plpgsql security definer;

-- One-time backfill: materialize the current month for every recurring
-- template that already exists (including ones just upgraded to a
-- template by the update statement above) — otherwise a daily/weekly/...
-- task saved before this migration won't show upcoming occurrences until
-- it's next edited or its month is browsed in the app.
do $$
declare template_id uuid;
begin
  for template_id in select id from tasks
    where recurrence::text <> 'none' and recurrence_series_id = id
  loop
    perform generate_month_occurrences(template_id, current_date);
  end loop;
end;
$$;

-- Do not call ensure_month_recurrences() from the SQL Editor with a
-- target_month argument as the only statement below — auth.uid() is null
-- there. Tandem calls it with the signed-in member's session
-- automatically before fetching tasks; the backfill above uses the
-- schema's own security definer functions directly instead, bypassing
-- that check the same way the migration statements above it already do.

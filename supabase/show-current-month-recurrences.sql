-- Run once in the Supabase SQL editor. Selected-weekday schedules are
-- materialized only for the current month and deduplicated by series/date.

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

create or replace function prepare_recurrence_series()
returns trigger as $$
begin
  if new.recurrence::text = 'selected_weekdays' and new.recurrence_series_id is null then
    new.recurrence_series_id := new.id;
  elsif new.recurrence::text <> 'selected_weekdays' and new.recurrence_series_id = new.id then
    new.recurrence_series_id := null;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists tasks_prepare_recurrence_series on tasks;
create trigger tasks_prepare_recurrence_series
before insert or update of recurrence, recurrence_days on tasks
for each row execute function prepare_recurrence_series();

-- Existing selected-weekday tasks become templates. This migration is
-- intended before any pre-generated occurrences exist.
update tasks
set recurrence_series_id = id
where recurrence::text = 'selected_weekdays'
  and recurrence_series_id is null;

create or replace function generate_current_month_occurrences(template_id uuid)
returns void as $$
declare
  template tasks%rowtype;
  month_start date;
  month_end date;
  wall_time time;
  assignee_id uuid;
begin
  select * into template from tasks where id = template_id;
  if not found
     or template.recurrence::text <> 'selected_weekdays'
     or template.recurrence_series_id <> template.id
     or template.due_date is null then
    return;
  end if;

  month_start := date_trunc('month', now() at time zone template.due_timezone)::date;
  month_end := (month_start + interval '1 month - 1 day')::date;
  wall_time := (template.due_date at time zone template.due_timezone)::time;

  select id into assignee_id from members
  where lower(display_name) = case when template.who = 'assistant' then 'aaron' else 'ada' end
  limit 1;

  insert into tasks (
    title, who, priority, icon, due_date, due_timezone, duration_minutes,
    source, source_note, notes, checklist, recurrence, recurrence_days,
    created_by, recurrence_series_id
  )
  select
    template.title, template.who, template.priority, template.icon,
    (day_stamp::date + wall_time) at time zone template.due_timezone,
    template.due_timezone, template.duration_minutes, template.source,
    template.source_note, template.notes, template.checklist,
    template.recurrence, template.recurrence_days,
    coalesce(assignee_id, template.created_by), template.id
  from generate_series(month_start::timestamp, month_end::timestamp, interval '1 day') as days(day_stamp)
  where extract(dow from day_stamp)::smallint = any(template.recurrence_days)
    and (day_stamp::date + wall_time) at time zone template.due_timezone <> template.due_date
  on conflict (recurrence_series_id, due_date)
    where recurrence_series_id is not null and due_date is not null
    do nothing;
end;
$$ language plpgsql security definer;

create or replace function sync_current_month_recurrences()
returns trigger as $$
begin
  if tg_op = 'UPDATE'
     and old.recurrence_series_id = old.id
     and (
       new.recurrence::text <> 'selected_weekdays'
       or new.due_date is distinct from old.due_date
       or new.due_timezone is distinct from old.due_timezone
       or new.recurrence_days is distinct from old.recurrence_days
     ) then
    delete from tasks
    where recurrence_series_id = old.id and id <> old.id and status <> 'done';
  end if;

  if new.recurrence::text = 'selected_weekdays'
     and new.recurrence_series_id = new.id then
    perform generate_current_month_occurrences(new.id);
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists tasks_sync_current_month_recurrences on tasks;
create trigger tasks_sync_current_month_recurrences
after insert or update of recurrence, recurrence_days, due_date, due_timezone on tasks
for each row execute function sync_current_month_recurrences();

create or replace function ensure_current_month_recurrences()
returns void as $$
declare
  template_id uuid;
begin
  if not exists (select 1 from members where id = auth.uid()) then
    raise exception 'Not authorized';
  end if;
  for template_id in
    select id from tasks
    where recurrence::text = 'selected_weekdays'
      and recurrence_series_id = id
  loop
    perform generate_current_month_occurrences(template_id);
  end loop;
end;
$$ language plpgsql security definer;

-- Selected-weekday occurrences are already present; completing one must
-- not append another copy using the old one-at-a-time recurrence chain.
create or replace function spawn_next_recurrence()
returns trigger as $$
declare
  next_due timestamptz;
  reset_checklist jsonb;
begin
  if new.status = 'done' and old.status <> 'done'
     and new.recurrence <> 'none'
     and new.recurrence::text <> 'selected_weekdays' then
    next_due := case new.recurrence::text
      when 'daily' then coalesce(new.due_date, now()) + interval '1 day'
      when 'weekly' then coalesce(new.due_date, now()) + interval '7 days'
      when 'biweekly' then coalesce(new.due_date, now()) + interval '14 days'
      when 'every_3_weeks' then coalesce(new.due_date, now()) + interval '21 days'
      when 'monthly' then coalesce(new.due_date, now()) + interval '1 month'
      when 'every_2_months' then coalesce(new.due_date, now()) + interval '2 months'
      when 'quarterly' then coalesce(new.due_date, now()) + interval '3 months'
      when 'every_6_months' then coalesce(new.due_date, now()) + interval '6 months'
      when 'annually' then coalesce(new.due_date, now()) + interval '1 year'
    end;
    select coalesce(jsonb_agg(jsonb_set(item, '{done}', 'false')), '[]'::jsonb)
      into reset_checklist from jsonb_array_elements(new.checklist) as item;
    insert into tasks (
      title, who, priority, due_date, due_timezone, duration_minutes,
      source, source_note, notes, checklist, recurrence, recurrence_days, created_by
    ) values (
      new.title, new.who, new.priority, next_due, new.due_timezone,
      new.duration_minutes, new.source, new.source_note, new.notes,
      reset_checklist, new.recurrence, new.recurrence_days, new.created_by
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

select ensure_current_month_recurrences();

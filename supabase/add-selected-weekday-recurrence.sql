-- Apply this once to an existing Tandem Supabase project. schema.sql already
-- contains these changes for new projects.
alter type task_recurrence add value if not exists 'selected_weekdays' after 'weekly';

alter table tasks
  add column if not exists recurrence_days smallint[] not null default '{}';

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_recurrence_days_valid'
      and conrelid = 'tasks'::regclass
  ) then
    alter table tasks
      add constraint tasks_recurrence_days_valid check (
        recurrence::text <> 'selected_weekdays'
        or (
          cardinality(recurrence_days) > 0
          and recurrence_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
        )
      );
  end if;
end;
$migration$;

create or replace function spawn_next_recurrence()
returns trigger as $$
declare
  next_due timestamptz;
  reset_checklist jsonb;
  current_weekday integer;
  days_until_next integer;
begin
  if new.status = 'done' and old.status <> 'done' and new.recurrence <> 'none' then
    next_due := case new.recurrence::text
      when 'daily' then coalesce(new.due_date, now()) + interval '1 day'
      when 'weekly' then coalesce(new.due_date, now()) + interval '7 days'
      when 'selected_weekdays' then null
      when 'biweekly' then coalesce(new.due_date, now()) + interval '14 days'
      when 'every_3_weeks' then coalesce(new.due_date, now()) + interval '21 days'
      when 'monthly' then coalesce(new.due_date, now()) + interval '1 month'
      when 'every_2_months' then coalesce(new.due_date, now()) + interval '2 months'
      when 'quarterly' then coalesce(new.due_date, now()) + interval '3 months'
      when 'every_6_months' then coalesce(new.due_date, now()) + interval '6 months'
      when 'annually' then coalesce(new.due_date, now()) + interval '1 year'
    end;

    if new.recurrence::text = 'selected_weekdays' then
      current_weekday := extract(dow from coalesce(new.due_date, now()) at time zone new.due_timezone)::integer;
      select min(((day_number::integer - current_weekday + 6) % 7) + 1)
        into days_until_next
        from unnest(new.recurrence_days) as selected_day(day_number);
      next_due := (
        coalesce(new.due_date, now()) at time zone new.due_timezone
        + make_interval(days => days_until_next)
      ) at time zone new.due_timezone;
    end if;

    select coalesce(jsonb_agg(jsonb_set(item, '{done}', 'false')), '[]'::jsonb)
      into reset_checklist
      from jsonb_array_elements(new.checklist) as item;

    insert into tasks (
      title, who, priority, due_date, due_timezone, duration_minutes, source, source_note, notes, checklist, recurrence, recurrence_days, created_by
    ) values (
      new.title, new.who, new.priority, next_due, new.due_timezone, new.duration_minutes, new.source, new.source_note, new.notes, reset_checklist, new.recurrence, new.recurrence_days, new.created_by
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

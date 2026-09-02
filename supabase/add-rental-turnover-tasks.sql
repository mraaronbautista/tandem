-- Run once in the Supabase SQL editor for an existing Tandem project.
-- Creates and maintains one Aaron-assigned cleaning-planning task for
-- each confirmed rental booking, due at 10:00 AM Central seven days
-- before the booking's final occupied date.

alter table tasks
  add column if not exists rental_turnover_booking_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_rental_turnover_booking_id_fkey'
      and conrelid = 'tasks'::regclass
  ) then
    alter table tasks
      add constraint tasks_rental_turnover_booking_id_fkey
      foreign key (rental_turnover_booking_id)
      references rental_bookings (id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_rental_turnover_booking_id_key'
      and conrelid = 'tasks'::regclass
  ) then
    alter table tasks
      add constraint tasks_rental_turnover_booking_id_key
      unique (rental_turnover_booking_id);
  end if;
end;
$$;

create or replace function sync_rental_turnover_task()
returns trigger as $$
declare
  property_name text;
  cleaning_due timestamptz;
begin
  if new.status <> 'confirmed' then
    delete from tasks where rental_turnover_booking_id = new.id;
    return new;
  end if;

  select unit_name into property_name
  from rental_properties
  where id = new.property_id;

  cleaning_due := ((new.check_out - 7) + time '10:00') at time zone 'America/Chicago';

  insert into tasks (
    title, who, priority, due_date, due_timezone, source, notes, checklist,
    created_by, rental_turnover_booking_id
  ) values (
    'Schedule turnover cleaning for ' || property_name,
    'assistant',
    'med',
    cleaning_due,
    'America/Chicago',
    'none',
    'Automatically created seven days before ' || new.guest_name || '''s move-out.',
    jsonb_build_array(jsonb_build_object(
      'id', 'add-cleaner-visit-task',
      'text', 'Add a task for when the cleaner will actually come.',
      'done', false,
      'blocked', false,
      'blockedReason', ''
    )),
    new.created_by,
    new.id
  )
  on conflict (rental_turnover_booking_id) do update set
    title = excluded.title,
    due_date = excluded.due_date,
    due_timezone = excluded.due_timezone,
    notes = excluded.notes,
    who = 'assistant';

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists rental_bookings_sync_turnover_task on rental_bookings;
create trigger rental_bookings_sync_turnover_task
after insert or update of property_id, guest_name, check_out, status
on rental_bookings
for each row execute function sync_rental_turnover_task();

-- Add tasks for current and future confirmed bookings that already exist.
insert into tasks (
  title, who, priority, due_date, due_timezone, source, notes, checklist,
  created_by, rental_turnover_booking_id
)
select
  'Schedule turnover cleaning for ' || p.unit_name,
  'assistant',
  'med',
  ((b.check_out - 7) + time '10:00') at time zone 'America/Chicago',
  'America/Chicago',
  'none',
  'Automatically created seven days before ' || b.guest_name || '''s move-out.',
  jsonb_build_array(jsonb_build_object(
    'id', 'add-cleaner-visit-task',
    'text', 'Add a task for when the cleaner will actually come.',
    'done', false,
    'blocked', false,
    'blockedReason', ''
  )),
  b.created_by,
  b.id
from rental_bookings b
join rental_properties p on p.id = b.property_id
where b.status = 'confirmed'
  and b.check_out >= current_date
on conflict (rental_turnover_booking_id) do update set
  title = excluded.title,
  due_date = excluded.due_date,
  due_timezone = excluded.due_timezone,
  notes = excluded.notes,
  checklist = excluded.checklist,
  who = 'assistant';

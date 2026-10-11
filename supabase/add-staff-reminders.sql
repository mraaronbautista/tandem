-- Reminders for the house manager. Run once by hand in the Supabase SQL
-- editor, AFTER add-rental-visits.sql and add-staff-push.sql. Idempotent:
-- safe to re-run. No AI session applies this without being told "run it".
--
-- What it adds: three "already reminded" marks, and two triggers that clear a
-- mark when the thing it belongs to is rescheduled, so a moved visit or a
-- changed move-out date reminds him again. notify-reminders (the 5-minute
-- job) reads and writes the marks with the service role; nobody else needs
-- them, and the house manager's screens never see them.
--
--   rental_visits.staff_reminder_sent_at              visit-in-an-hour / today
--   rental_bookings.staff_moveout_reminder_sent_at    evening-before digest
--   rental_bookings.staff_movein_reminder_sent_at     evening-before digest

alter table public.rental_visits add column if not exists staff_reminder_sent_at timestamptz;
alter table public.rental_bookings add column if not exists staff_moveout_reminder_sent_at timestamptz;
alter table public.rental_bookings add column if not exists staff_movein_reminder_sent_at timestamptz;

-- A visit that moves (date, time, unit or location) or comes back from Done
-- gets a fresh reminder. Setting the mark itself changes none of these, so the
-- job writing it does not clear it.
create or replace function public.reset_staff_visit_reminder() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.visit_date is distinct from old.visit_date
     or new.visit_time is distinct from old.visit_time
     or new.property_id is distinct from old.property_id
     or new.work_site_id is distinct from old.work_site_id
     or (new.status = 'scheduled' and old.status is distinct from 'scheduled') then
    new.staff_reminder_sent_at := null;
  end if;
  return new;
end $$;

drop trigger if exists rental_visit_reset_staff_reminder on public.rental_visits;
create trigger rental_visit_reset_staff_reminder before update on public.rental_visits
  for each row execute function public.reset_staff_visit_reminder();

-- A move-out reminder is cleared when the check-out date, unit or status
-- changes; a move-in reminder when the check-in date, unit or status changes.
create or replace function public.reset_staff_booking_reminders() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.check_out is distinct from old.check_out
     or new.property_id is distinct from old.property_id
     or (new.status = 'confirmed' and old.status is distinct from 'confirmed') then
    new.staff_moveout_reminder_sent_at := null;
  end if;
  if new.check_in is distinct from old.check_in
     or new.property_id is distinct from old.property_id
     or (new.status = 'confirmed' and old.status is distinct from 'confirmed') then
    new.staff_movein_reminder_sent_at := null;
  end if;
  return new;
end $$;

drop trigger if exists rental_booking_reset_staff_reminders on public.rental_bookings;
create trigger rental_booking_reset_staff_reminders before update on public.rental_bookings
  for each row execute function public.reset_staff_booking_reminders();

-- Read-only check: three columns and two triggers should be listed.
select table_name, column_name from information_schema.columns
  where table_schema = 'public'
    and ((table_name = 'rental_visits' and column_name = 'staff_reminder_sent_at')
      or (table_name = 'rental_bookings' and column_name in ('staff_moveout_reminder_sent_at', 'staff_movein_reminder_sent_at')))
  order by 1, 2;
select tgname from pg_trigger
  where tgname in ('rental_visit_reset_staff_reminder', 'rental_booking_reset_staff_reminders') and not tgisinternal order by 1;

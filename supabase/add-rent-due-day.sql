-- "Rent due day" per unit. Run once by hand in the Supabase SQL editor.
-- Idempotent: safe to re-run. No AI session applies this without Aaron saying
-- "run it". Run it BEFORE the app and the notify-reminders function are
-- deployed, because both now read this column.
--
-- What it adds: rental_properties.rent_due_day.
--   null        = "Same as move-in day": exactly how Tandem has always charged
--                 rent (a full month on the move-in day, then every month on
--                 that day). This is the default, so running this file changes
--                 nothing for any unit until someone sets a due day.
--   1 to 28     = rent is charged on that fixed day every month (like
--                 TurboTenant); a partial first or last month is prorated by
--                 days (see supabase/functions/_shared/rentCharges.ts).
--   -1          = the last day of every month.
-- Existing "paid in advance" marks (rental_bookings.paid_charges) are plain
-- dates and keep working; a mark only matters if that date is still a charge
-- date under the unit's setting.

alter table public.rental_properties add column if not exists rent_due_day smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rental_properties_rent_due_day_check') then
    alter table public.rental_properties add constraint rental_properties_rent_due_day_check
      check (rent_due_day is null or rent_due_day between 1 and 28 or rent_due_day = -1);
  end if;
end $$;

-- Read-only check: the column should list once, and every unit should still be null.
select column_name, data_type from information_schema.columns
  where table_schema = 'public' and table_name = 'rental_properties' and column_name = 'rent_due_day';
select count(*) as units_with_a_due_day from public.rental_properties where rent_due_day is not null;

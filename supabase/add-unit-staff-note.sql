-- A standing note per unit for the house manager ("tenant has a dog, gate code
-- changed, use the side door"). Members with Rentals write it in the unit's
-- What's happening sheet; the house manager reads it on his Schedule tab.
-- Run once by hand in the Supabase SQL editor. Idempotent: safe to re-run.
-- No AI session applies this without Aaron saying "run it".
--
-- Access: members write it through the existing unit update rule (Rentals
-- permission). A staff account still cannot read rental_properties; the only
-- door is staff_unit_notes(), which returns just the unit name, its location,
-- the note and when it was last changed, for active units that have a note.
--
-- Whatever is written here, the house manager can read. Keep tenant phone
-- numbers and private details out (the field says so).

alter table public.rental_properties add column if not exists staff_note text not null default '';
alter table public.rental_properties add column if not exists staff_note_updated_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rental_properties_staff_note_length') then
    alter table public.rental_properties add constraint rental_properties_staff_note_length check (length(staff_note) <= 500);
  end if;
end $$;

-- The database stamps when the note last changed, so it cannot be faked and
-- is never forgotten; clearing the note clears the stamp. It runs on every
-- update of a unit (not only note edits) so the stamp cannot be set directly.
create or replace function public.stamp_unit_staff_note() returns trigger
  language plpgsql set search_path = public as $$
begin
  new.staff_note := btrim(coalesce(new.staff_note, ''));
  if new.staff_note is distinct from btrim(coalesce(old.staff_note, '')) then
    new.staff_note_updated_at := case when new.staff_note = '' then null else now() end;
  else
    new.staff_note_updated_at := old.staff_note_updated_at;
  end if;
  return new;
end $$;
revoke all on function public.stamp_unit_staff_note() from public, anon, authenticated;
drop trigger if exists rental_unit_staff_note_stamp on public.rental_properties;
create trigger rental_unit_staff_note_stamp before update on public.rental_properties
  for each row execute function public.stamp_unit_staff_note();

-- The house manager's read-only door.
create or replace function public.staff_unit_notes()
returns table (
  unit_name text,
  location_id uuid,
  location_name text,
  location_timezone text,
  note text,
  updated_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select p.unit_name, p.work_site_id, w.name, w.timezone, p.staff_note, p.staff_note_updated_at
  from public.rental_properties p
  left join public.work_sites w on w.id = p.work_site_id
  where p.active and btrim(p.staff_note) <> ''
  order by w.name nulls last, p.unit_name;
end $$;
revoke all on function public.staff_unit_notes() from public, anon;
grant execute on function public.staff_unit_notes() to authenticated;

-- Read-only check. Expect: the two columns, the trigger and the function.
select column_name from information_schema.columns where table_name = 'rental_properties' and column_name like 'staff_note%' order by 1;
select tgname from pg_trigger where tgname = 'rental_unit_staff_note_stamp';
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname = 'staff_unit_notes';

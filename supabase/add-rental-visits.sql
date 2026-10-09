-- Scheduled visits to a rental unit or a whole location: a cleaner, a
-- plumber, an inspection, anything. Run once by hand in the Supabase SQL
-- editor. Idempotent: safe to re-run. No AI session applies this.
--
-- Why: Tandem knew about tenants moving in and out, but not about the people
-- who come to the unit in between. The turnover task only reminds Aaron to
-- book a cleaner; it never recorded when the cleaner is actually coming. This
-- table is that record. It powers the "What's happening" sheet on each unit
-- card, and later the house manager's read-only Schedule tab.
--
-- Access: same as the rest of Rentals. A signed-in member who has the Rentals
-- permission can read and manage visits. Staff accounts and members without
-- Rentals get nothing. (The house manager will read a narrow, read-only
-- projection through a separate function, added with that feature.)
--
-- A visit belongs to EITHER one unit (property_id) OR a whole location
-- (work_site_id, for building-wide work such as a gate latch), never both and
-- never neither. `kind` is free text on purpose (Cleaning, Repair, anything
-- typed); the app only suggests common ones. `who` is the name shown; if it
-- was picked from the contacts list, contact_id points at that contact.

create table if not exists public.rental_visits (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.rental_properties(id) on delete cascade,
  work_site_id uuid references public.work_sites(id) on delete cascade,
  kind text not null check (length(btrim(kind)) between 1 and 40),
  -- Plain wall-clock date and optional time at the property, like every other
  -- rental date in this app; no time zone conversion.
  visit_date date not null,
  visit_time time,
  contact_id uuid references public.rental_contacts(id) on delete set null,
  who text not null default '' check (length(who) <= 120),
  note text not null default '' check (length(note) <= 500),
  status text not null default 'scheduled' check (status in ('scheduled', 'done')),
  done_at timestamptz,
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rental_visits_one_target check ((property_id is null) <> (work_site_id is null))
);
create index if not exists rental_visits_property_idx on public.rental_visits (property_id, visit_date);
create index if not exists rental_visits_site_idx on public.rental_visits (work_site_id, visit_date);
create index if not exists rental_visits_date_idx on public.rental_visits (visit_date);

alter table public.rental_visits enable row level security;
drop policy if exists "rentals members manage visits" on public.rental_visits;
create policy "rentals members manage visits" on public.rental_visits
  for all to authenticated
  using (public.is_member() and public.has_permission('rentals'))
  with check (public.is_member() and public.has_permission('rentals'));

revoke all on public.rental_visits from anon, authenticated;
grant select, insert, update, delete on public.rental_visits to authenticated;

-- The database, not the app, decides who created a visit and when it was
-- finished, so neither can be faked or forgotten.
create or replace function public.stamp_rental_visit() returns trigger
  language plpgsql set search_path = public as $$
begin
  new.kind := btrim(new.kind);
  new.who := btrim(new.who);
  new.note := btrim(new.note);
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if new.status = 'done' then
    if tg_op = 'INSERT' or old.status is distinct from 'done' then new.done_at := now(); else new.done_at := old.done_at; end if;
  else
    new.done_at := null;
  end if;
  return new;
end $$;
revoke all on function public.stamp_rental_visit() from public, anon, authenticated;
drop trigger if exists rental_visit_stamp on public.rental_visits;
create trigger rental_visit_stamp before insert or update on public.rental_visits
  for each row execute function public.stamp_rental_visit();

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rental_visits') then
    alter publication supabase_realtime add table public.rental_visits;
  end if;
end $$;

-- Read-only setup checks.
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'rental_visits';
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'rental_visits';
select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rental_visits';

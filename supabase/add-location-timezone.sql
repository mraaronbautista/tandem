-- Each location (1072 Rachel, 967 Parkside, 937 Findlay...) gets a time zone,
-- so a visit's time can be labelled "2:30 PM ET" and shown to a member in
-- another zone ("3:30 AM Wed your time"). Run once by hand in the Supabase
-- SQL editor, AFTER add-rental-visits.sql and add-staff-schedule.sql.
-- Idempotent: safe to re-run. No AI session applies this without Aaron
-- saying "run it".
--
-- A visit's date and time stay plain wall-clock values at the property (no
-- conversion is stored); the zone only decides how they are LABELLED and
-- converted for display, and which calendar day counts as "today" for a unit.
-- Tasks are untouched: each task keeps its own customizable time zone.
--
-- Default is Eastern: all three current locations are in the Cincinnati area
-- (map points checked Oct 11, 2026). A new location starts as Eastern and its
-- zone can be changed in the location's settings.

alter table public.work_sites add column if not exists timezone text not null default 'America/New_York';

-- The same five zones the rest of the app offers.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'work_sites_timezone_known') then
    alter table public.work_sites add constraint work_sites_timezone_known
      check (timezone in ('America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Asia/Manila'));
  end if;
end $$;

-- Rentals-only members read location names through this function (they cannot
-- read work_sites itself); it now also returns the zone. The return shape
-- changed, so it is dropped and recreated.
drop function if exists public.get_rental_locations();
create function public.get_rental_locations()
returns table(id uuid, name text, timezone text) language sql stable security definer set search_path = public as $$
  select ws.id, ws.name, ws.timezone from public.work_sites ws
  where public.is_member() and public.has_permission('rentals') order by ws.name, ws.id
$$;
revoke all on function public.get_rental_locations() from public, anon;
grant execute on function public.get_rental_locations() to authenticated;

-- The house manager's schedule also returns the zone, so he sees "2:30 PM ET".
create or replace function public.staff_tenant_label(p_booking jsonb)
returns text language sql immutable set search_path = public as $$
  select coalesce(string_agg(
    case
      when array_length(parts, 1) is null then ''
      when array_length(parts, 1) = 1 then parts[1]
      else parts[1] || ' ' || upper(left(parts[array_length(parts, 1)], 1)) || '.'
    end, ' and '), '')
  from (
    select regexp_split_to_array(btrim(n), '\s+') as parts
    from unnest(
      case
        when jsonb_typeof(p_booking -> 'guest_names') = 'array' and jsonb_array_length(p_booking -> 'guest_names') > 0
          then array(select jsonb_array_elements_text(p_booking -> 'guest_names'))
        else array[coalesce(p_booking ->> 'guest_name', '')]
      end
    ) as n
    where btrim(n) <> ''
  ) s
$$;
revoke all on function public.staff_tenant_label(jsonb) from public, anon, authenticated;

drop function if exists public.staff_schedule(date, integer);
create function public.staff_schedule(p_from date, p_days integer default 60)
returns table (
  kind text,            -- 'move_out' | 'move_in' | 'visit'
  event_date date,
  event_time time,
  unit_name text,
  location_id uuid,
  location_name text,
  location_timezone text, -- the location's time zone, so staff see "2:30 PM ET"
  title text,           -- tenant label, or the visit type
  who text,
  trade text,
  phone text,
  note text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_from date;
  v_to date;
begin
  if not public.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  -- The caller's own "today" may differ from the server's by a day; allow
  -- that, but never let a caller page back through history.
  v_from := greatest(least(coalesce(p_from, current_date), current_date + 2), current_date - 2);
  v_to := v_from + greatest(least(coalesce(p_days, 60), 180), 1);

  return query
  select * from (
    select 'move_out'::text, b.check_out, null::time, p.unit_name, p.work_site_id, w.name, w.timezone,
           public.staff_tenant_label(to_jsonb(b)), ''::text, ''::text, ''::text, ''::text
    from public.rental_bookings b
    join public.rental_properties p on p.id = b.property_id and p.active
    left join public.work_sites w on w.id = p.work_site_id
    where b.status = 'confirmed' and b.check_out between v_from and v_to

    union all
    select 'move_in'::text, b.check_in, null::time, p.unit_name, p.work_site_id, w.name, w.timezone,
           public.staff_tenant_label(to_jsonb(b)), ''::text, ''::text, ''::text, ''::text
    from public.rental_bookings b
    join public.rental_properties p on p.id = b.property_id and p.active
    left join public.work_sites w on w.id = p.work_site_id
    where b.status = 'confirmed' and b.check_in between v_from and v_to

    union all
    select 'visit'::text, v.visit_date, v.visit_time, p.unit_name,
           coalesce(p.work_site_id, v.work_site_id), coalesce(w.name, vw.name), coalesce(w.timezone, vw.timezone),
           v.kind,
           case when c.kind = 'tenant' then '' else v.who end,
           case when c.kind in ('vendor', 'other') then c.trade else '' end,
           case when c.kind in ('vendor', 'other') then c.phone else '' end,
           v.note
    from public.rental_visits v
    left join public.rental_properties p on p.id = v.property_id
    left join public.work_sites w on w.id = p.work_site_id
    left join public.work_sites vw on vw.id = v.work_site_id
    left join public.rental_contacts c on c.id = v.contact_id and c.active
    where v.status = 'scheduled' and v.visit_date between v_from and v_to
      and (v.property_id is null or p.active)
  ) s
  order by 2, 3 nulls first, 1, 4;
end $$;

revoke all on function public.staff_schedule(date, integer) from public, anon;
grant execute on function public.staff_schedule(date, integer) to authenticated;

-- Read-only checks. Expect: three locations, all America/New_York.
select name, timezone from public.work_sites order by name;
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('get_rental_locations', 'staff_schedule') order by proname;

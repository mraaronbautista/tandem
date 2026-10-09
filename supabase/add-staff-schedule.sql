-- The house manager's read-only schedule. Run once by hand in the Supabase
-- SQL editor, AFTER add-rental-visits.sql. Idempotent: safe to re-run. No AI
-- session applies this.
--
-- Why: a staff account (the house manager) can read no rental data, and
-- should not. But they need to know when tenants move in or out and when a
-- cleaner or vendor is coming. This function is the only door: it returns a
-- small, fixed list of "what is happening" and nothing else. Staff still
-- cannot read rental_properties, rental_bookings, rental_visits,
-- rental_contacts, tasks or the Vault.
--
-- What it returns (and deliberately does not):
--   * Tenants: first name and last initial only ("Jordan K."). No phone,
--     email, rent, payments, notes or contact record.
--   * Move-outs and move-ins from CONFIRMED bookings only (a pending request
--     is not certain, so staff do not see it).
--   * Scheduled visits that are not done, with the visit type, who is coming,
--     the one-line note a member wrote, and, if the visit was picked from a
--     vendor or other contact, that contact's trade and first phone number.
--     A tenant contact never contributes a name or phone.
--   * Active units only; "unit_name" is null for a whole-location visit.
--   * Only today through p_days ahead (1 to 180); never history.
--
-- Only an active staff account may call it (is_staff()).

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

create or replace function public.staff_schedule(p_from date, p_days integer default 60)
returns table (
  kind text,            -- 'move_out' | 'move_in' | 'visit'
  event_date date,
  event_time time,
  unit_name text,
  location_id uuid,
  location_name text,
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
    select 'move_out'::text, b.check_out, null::time, p.unit_name, p.work_site_id, w.name,
           public.staff_tenant_label(to_jsonb(b)), ''::text, ''::text, ''::text, ''::text
    from public.rental_bookings b
    join public.rental_properties p on p.id = b.property_id and p.active
    left join public.work_sites w on w.id = p.work_site_id
    where b.status = 'confirmed' and b.check_out between v_from and v_to

    union all
    select 'move_in'::text, b.check_in, null::time, p.unit_name, p.work_site_id, w.name,
           public.staff_tenant_label(to_jsonb(b)), ''::text, ''::text, ''::text, ''::text
    from public.rental_bookings b
    join public.rental_properties p on p.id = b.property_id and p.active
    left join public.work_sites w on w.id = p.work_site_id
    where b.status = 'confirmed' and b.check_in between v_from and v_to

    union all
    select 'visit'::text, v.visit_date, v.visit_time, p.unit_name,
           coalesce(p.work_site_id, v.work_site_id), coalesce(w.name, vw.name),
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

-- Read-only check: both should list one row each.
select proname, prosecdef as security_definer from pg_proc
  where pronamespace = 'public'::regnamespace and proname in ('staff_schedule', 'staff_tenant_label') order by proname;

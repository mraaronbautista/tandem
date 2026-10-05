-- Location-wide service contacts. Run manually AFTER add-rental-contacts.sql.
-- No production SQL is applied by Codex. Existing unit links are preserved.
begin;
create table if not exists public.rental_contact_location_links (
 contact_id uuid not null references public.rental_contacts(id) on delete cascade,
 work_site_id uuid not null references public.work_sites(id) on delete cascade,
 role text not null default '',
 primary key(contact_id,work_site_id)
);
create index if not exists rental_contact_location_links_site_idx on public.rental_contact_location_links(work_site_id);
alter table public.rental_contact_location_links enable row level security;
drop policy if exists "rentals members manage location contacts" on public.rental_contact_location_links;
create policy "rentals members manage location contacts" on public.rental_contact_location_links for all to authenticated
 using(public.is_member() and public.has_permission('rentals'))
 with check(public.is_member() and public.has_permission('rentals') and exists(
  select 1 from public.rental_contacts c where c.id=contact_id and c.kind<>'tenant'));
revoke all on public.rental_contact_location_links from anon;
grant select,insert,update,delete on public.rental_contact_location_links to authenticated;
-- Rentals-only readers receive names and IDs, never Staff GPS/payroll/capture data.
create or replace function public.get_rental_locations()
returns table(id uuid,name text) language sql stable security definer set search_path=public as $$
 select ws.id,ws.name from public.work_sites ws
 where public.is_member() and public.has_permission('rentals') order by ws.name,ws.id
$$;
revoke all on function public.get_rental_locations() from public,anon;
grant execute on function public.get_rental_locations() to authenticated;
-- Prevent an old client/raw edit from turning a location-wide vendor into
-- a tenant without first clearing their location coverage.
create or replace function public.guard_rental_contact_kind() returns trigger
 language plpgsql security definer set search_path=public as $$
 begin
  if new.kind='tenant' and exists(select 1 from public.rental_contact_location_links l where l.contact_id=new.id) then
   raise exception 'Remove location-wide coverage before changing this contact to a tenant';
  end if;
  return new;
 end $$;
revoke all on function public.guard_rental_contact_kind() from public,anon,authenticated;
drop trigger if exists rental_contact_kind_guard on public.rental_contacts;
create trigger rental_contact_kind_guard before update of kind on public.rental_contacts
 for each row execute function public.guard_rental_contact_kind();
-- Reuse the original invoker save inside this transaction; old clients leave
-- location links untouched. The new caller replaces both coverage sets together.
create or replace function public.save_rental_contact_coverage(contact_id uuid,details jsonb,links jsonb,location_links jsonb)
returns uuid language plpgsql security invoker set search_path=public as $$
declare saved_id uuid;
begin
 if not public.is_member() or not public.has_permission('rentals') then
  raise exception 'Not authorized' using errcode='42501';
 end if;
 if details->>'kind'='tenant' and jsonb_array_length(location_links)>0 then
  raise exception 'Tenants must be linked to specific units';
 end if;
 -- Remove old coverage before kind changes; any later error rolls this back.
 if contact_id is not null then
  delete from public.rental_contact_location_links l where l.contact_id=save_rental_contact_coverage.contact_id;
 end if;
 saved_id:=public.save_rental_contact(contact_id,details,links);
 insert into public.rental_contact_location_links(contact_id,work_site_id,role)
 select saved_id,(item->>'work_site_id')::uuid,coalesce(item->>'role','') from jsonb_array_elements(location_links) item;
 return saved_id;
end $$;
revoke all on function public.save_rental_contact_coverage(uuid,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.save_rental_contact_coverage(uuid,jsonb,jsonb,jsonb) to authenticated;
-- Wake Rentals clients when a location name changes without giving them
-- direct work_sites access or relying on Staff's publication/RLS.
create table if not exists public.rental_location_changes (
 id boolean primary key default true check(id), changed_at timestamptz not null default now()
);
insert into public.rental_location_changes(id) values(true) on conflict do nothing;
alter table public.rental_location_changes enable row level security;
drop policy if exists "rentals members read location changes" on public.rental_location_changes;
create policy "rentals members read location changes" on public.rental_location_changes for select to authenticated
 using(public.is_member() and public.has_permission('rentals'));
revoke all on public.rental_location_changes from anon,authenticated;
grant select on public.rental_location_changes to authenticated;
create or replace function public.signal_rental_location_change() returns trigger
 language plpgsql security definer set search_path=public as $$
 begin update public.rental_location_changes set changed_at=clock_timestamp() where id=true; return null; end $$;
revoke all on function public.signal_rental_location_change() from public,anon,authenticated;
drop trigger if exists rental_location_changed on public.work_sites;
create trigger rental_location_changed after insert or update or delete on public.work_sites
 for each statement execute function public.signal_rental_location_change();
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rental_contact_location_links') then
  alter publication supabase_realtime add table public.rental_contact_location_links;
 end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rental_location_changes') then
  alter publication supabase_realtime add table public.rental_location_changes;
 end if;
end $$;
commit;
-- Review actual unit mappings. No locations are guessed or auto-assigned.
select rp.unit_name,rp.company,ws.name as location from public.rental_properties rp
 left join public.work_sites ws on ws.id=rp.work_site_id where rp.active order by ws.name nulls last,rp.unit_name;
select tablename,rowsecurity from pg_tables where schemaname='public' and tablename in('rental_contact_location_links','rental_location_changes');
select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename in('rental_contact_location_links','rental_location_changes');

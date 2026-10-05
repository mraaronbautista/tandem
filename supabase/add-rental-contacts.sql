-- Property contacts: run this file manually in the Supabase SQL editor.
-- No production changes have been applied by Codex.
begin;
create table if not exists public.rental_contacts (
 id uuid primary key default gen_random_uuid(),
 kind text not null check (kind in ('tenant','vendor','other')),
 name text not null check (length(trim(name)) between 1 and 200),
 organization text not null default '', trade text not null default '',
 phone text not null default '', phone_alt text not null default '',
 email text not null default '', notes text not null default '',
 active boolean not null default true,
 created_by uuid default auth.uid() references public.members(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.rental_contact_links (
 contact_id uuid not null references public.rental_contacts(id) on delete cascade,
 property_id uuid not null references public.rental_properties(id) on delete cascade,
 role text not null default '',
 primary key (contact_id,property_id)
);
create index if not exists rental_contact_links_property_idx on public.rental_contact_links(property_id);
alter table public.rental_contacts enable row level security;
alter table public.rental_contact_links enable row level security;
drop policy if exists "rentals members manage contacts" on public.rental_contacts;
create policy "rentals members manage contacts" on public.rental_contacts for all to authenticated
 using (public.is_member() and public.has_permission('rentals'))
 with check (public.is_member() and public.has_permission('rentals'));
drop policy if exists "rentals members manage contact links" on public.rental_contact_links;
create policy "rentals members manage contact links" on public.rental_contact_links for all to authenticated
 using (public.is_member() and public.has_permission('rentals'))
 with check (public.is_member() and public.has_permission('rentals'));
revoke all on public.rental_contacts, public.rental_contact_links from anon;
grant select, insert, update, delete on public.rental_contacts, public.rental_contact_links to authenticated;
-- One transaction saves the contact and all links; errors roll everything back.
create or replace function public.save_rental_contact(contact_id uuid, details jsonb, links jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare saved_id uuid;
begin
 if not public.is_member() or not public.has_permission('rentals') then
  raise exception 'Not authorized' using errcode = '42501';
 end if;
 if contact_id is null then
  insert into rental_contacts(kind,name,organization,trade,phone,phone_alt,email,notes)
  values(details->>'kind',trim(details->>'name'),coalesce(details->>'organization',''),coalesce(details->>'trade',''),
   coalesce(details->>'phone',''),coalesce(details->>'phone_alt',''),coalesce(details->>'email',''),coalesce(details->>'notes',''))
  returning id into saved_id;
 else
  update rental_contacts set kind=details->>'kind',name=trim(details->>'name'),
   organization=coalesce(details->>'organization',''),trade=coalesce(details->>'trade',''),
   phone=coalesce(details->>'phone',''),phone_alt=coalesce(details->>'phone_alt',''),
   email=coalesce(details->>'email',''),notes=coalesce(details->>'notes',''),updated_at=now()
  where id=contact_id returning id into saved_id;
  if saved_id is null then raise exception 'Contact is no longer available'; end if;
 end if;
 delete from rental_contact_links where rental_contact_links.contact_id=saved_id;
 insert into rental_contact_links(contact_id,property_id,role)
 select saved_id,(entry->>'property_id')::uuid,coalesce(entry->>'role','') from jsonb_array_elements(links) entry;
 return saved_id;
end $$;
revoke all on function public.save_rental_contact(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.save_rental_contact(uuid,jsonb,jsonb) to authenticated;
-- Publication additions are safe when this file is rerun.
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rental_contacts') then
  alter publication supabase_realtime add table public.rental_contacts;
 end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rental_contact_links') then
  alter publication supabase_realtime add table public.rental_contact_links;
 end if;
end $$;
commit;
-- Read-only verification. Both tables should have RLS enabled and appear in the publication.
select tablename, rowsecurity from pg_tables where schemaname='public' and tablename in ('rental_contacts','rental_contact_links');
select tablename, cmd, roles, qual, with_check from pg_policies where schemaname='public' and tablename in ('rental_contacts','rental_contact_links');
select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename in ('rental_contacts','rental_contact_links');

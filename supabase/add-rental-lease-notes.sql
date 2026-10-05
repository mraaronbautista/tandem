-- Dated long-term lease notes. Run manually in Supabase SQL editor.
-- No production migration has been applied by Codex.
begin;
create table if not exists public.rental_lease_notes (
 id uuid primary key default gen_random_uuid(),
 -- Stable history IDs: validated on INSERT; deliberately no cascading FK.
 -- Original lease/unit context remains after a booking or unit is deleted.
 property_id uuid not null, booking_id uuid not null,
 unit_name text not null, tenant_label text not null,
 lease_start date not null, lease_end date not null,
 created_by uuid not null, author_name text not null,
 body text not null check(length(trim(body)) between 1 and 10000),
 archived boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), edited_at timestamptz
);
create index if not exists rental_lease_notes_property_idx on public.rental_lease_notes(property_id,created_at desc);
alter table public.rental_lease_notes enable row level security;
drop policy if exists "rentals members read lease notes" on public.rental_lease_notes;
create policy "rentals members read lease notes" on public.rental_lease_notes for select to authenticated
 using(public.is_member() and public.has_permission('rentals'));
drop policy if exists "rentals members add own lease notes" on public.rental_lease_notes;
create policy "rentals members add own lease notes" on public.rental_lease_notes for insert to authenticated
 with check(public.is_member() and public.has_permission('rentals') and created_by=auth.uid());
drop policy if exists "authors update lease notes" on public.rental_lease_notes;
create policy "authors update lease notes" on public.rental_lease_notes for update to authenticated
 using(public.is_member() and public.has_permission('rentals') and created_by=auth.uid())
 with check(public.is_member() and public.has_permission('rentals') and created_by=auth.uid());
revoke all on public.rental_lease_notes from anon,authenticated;
grant select,insert,update on public.rental_lease_notes to authenticated;
-- Snapshots come from trusted database rows, never caller-supplied labels.
create or replace function public.stamp_rental_lease_note() returns trigger
 language plpgsql security definer set search_path=public as $$
declare lease record;
begin
 if not public.is_member() or not public.has_permission('rentals') then
  raise exception 'Not authorized' using errcode='42501';
 end if;
 new.body:=trim(new.body);
 if tg_op='INSERT' then
  select b.property_id,b.guest_name,b.check_in,b.check_out,p.unit_name into lease
  from public.rental_bookings b join public.rental_properties p on p.id=b.property_id
  where b.id=new.booking_id and p.id=new.property_id and p.term='long_term';
  if not found then raise exception 'Choose an existing long-term lease for this note'; end if;
  new.unit_name:=lease.unit_name; new.tenant_label:=lease.guest_name;
  new.lease_start:=lease.check_in; new.lease_end:=lease.check_out;
  new.created_by:=auth.uid();
  select display_name into new.author_name from public.members where id=auth.uid();
  new.created_at:=now(); new.updated_at:=now(); new.edited_at:=null; new.archived:=false;
 else
  if old.created_by<>auth.uid() then raise exception 'You can only change your own notes' using errcode='42501'; end if;
  if new.id<>old.id or new.property_id<>old.property_id or new.booking_id<>old.booking_id
   or new.created_by<>old.created_by or new.unit_name<>old.unit_name or new.tenant_label<>old.tenant_label
   or new.lease_start<>old.lease_start or new.lease_end<>old.lease_end or new.author_name<>old.author_name then
   raise exception 'A note cannot be moved to another lease or author';
  end if;
  new.created_at:=old.created_at; new.updated_at:=now();
  new.edited_at:=case when new.body is distinct from old.body then now() else old.edited_at end;
 end if;
 return new;
end $$;
revoke all on function public.stamp_rental_lease_note() from public,anon,authenticated;
drop trigger if exists rental_lease_note_stamp on public.rental_lease_notes;
create trigger rental_lease_note_stamp before insert or update on public.rental_lease_notes
 for each row execute function public.stamp_rental_lease_note();
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rental_lease_notes') then
  alter publication supabase_realtime add table public.rental_lease_notes;
 end if;
end $$;
commit;
-- Read-only setup checks.
select tablename,rowsecurity from pg_tables where schemaname='public' and tablename='rental_lease_notes';
select policyname,cmd,qual,with_check from pg_policies where schemaname='public' and tablename='rental_lease_notes';
select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rental_lease_notes';

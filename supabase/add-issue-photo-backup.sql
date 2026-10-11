-- Back up house-manager issue photos to Google Drive (or a zip), then remove
-- the backed-up copies from Tandem. Run once by hand in the Supabase SQL
-- editor, AFTER add-staff-issue-photos.sql. Idempotent: safe to re-run. No AI
-- session applies this without Aaron saying "run it".
--
-- What it adds:
--   * Five columns on staff_issue_photos recording the back-up: when, how
--     ('drive' = Tandem checked the copy in Google Drive; 'zip' = a member
--     said they saved the downloaded zip), the Drive file id and folder link,
--     and when the photo was removed from Tandem.
--   * issue_photo_summary(): the numbers for the Issue photos screen.
--   * issue_photo_manifest(): what the zip download needs about each photo.
--   * mark_issue_photos_backed_up_zip(ids): the member's "I saved this file".
-- The Drive back-up and the removal are done by the issue-photo-backup Edge
-- Function with the service role, so members get no direct write access here.
-- Nothing in this file deletes anything.

alter table public.staff_issue_photos add column if not exists backed_up_at timestamptz;
alter table public.staff_issue_photos add column if not exists backup_kind text;
alter table public.staff_issue_photos add column if not exists drive_file_id text;
alter table public.staff_issue_photos add column if not exists drive_folder_url text;
alter table public.staff_issue_photos add column if not exists removed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_issue_photos_backup_kind_check') then
    alter table public.staff_issue_photos add constraint staff_issue_photos_backup_kind_check
      check (backup_kind is null or backup_kind in ('drive', 'zip'));
  end if;
  -- A photo can only be removed after it was backed up.
  if not exists (select 1 from pg_constraint where conname = 'staff_issue_photos_removed_needs_backup') then
    alter table public.staff_issue_photos add constraint staff_issue_photos_removed_needs_backup
      check (removed_at is null or (backed_up_at is not null and backup_kind is not null));
  end if;
end $$;

-- The numbers for the Issue photos screen. "Done" means the report's task is
-- ticked off or gone, the same rule the house manager's own list uses.
create or replace function public.issue_photo_summary()
returns table (
  in_tandem_count integer, in_tandem_bytes bigint,
  pending_count integer, pending_bytes bigint,
  backed_up_count integer,
  removable_count integer, removable_bytes bigint,
  kept_open_count integer,
  removed_count integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_member() and public.has_permission('rentals')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  with p as (
    select ph.*,
           (r.task_id is null or t.id is null or t.status = 'done') as report_done
    from public.staff_issue_photos ph
    join public.staff_issue_reports r on r.id = ph.report_id
    left join public.tasks t on t.id = r.task_id
  )
  select
    count(*) filter (where removed_at is null)::integer,
    coalesce(sum(size_bytes) filter (where removed_at is null), 0)::bigint,
    count(*) filter (where removed_at is null and backed_up_at is null)::integer,
    coalesce(sum(size_bytes) filter (where removed_at is null and backed_up_at is null), 0)::bigint,
    count(*) filter (where removed_at is null and backed_up_at is not null)::integer,
    count(*) filter (where removed_at is null and backed_up_at is not null and report_done)::integer,
    coalesce(sum(size_bytes) filter (where removed_at is null and backed_up_at is not null and report_done), 0)::bigint,
    count(*) filter (where removed_at is null and backed_up_at is not null and not report_done)::integer,
    count(*) filter (where removed_at is not null)::integer
  from p;
end $$;
revoke all on function public.issue_photo_summary() from public, anon;
grant execute on function public.issue_photo_summary() to authenticated;

-- Every photo still in Tandem that has not been backed up, with what the zip
-- needs to file it (place, reporter, text). Newest reports last.
create or replace function public.issue_photo_manifest()
returns table (
  photo_id uuid, path text, size_bytes integer, ordinal integer,
  report_id uuid, report_body text, urgency text, place text,
  unit_name text, location_name text, reporter_name text, report_created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_member() and public.has_permission('rentals')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select ph.id, ph.path, ph.size_bytes,
         (row_number() over (partition by ph.report_id order by ph.created_at, ph.id))::integer,
         r.id, r.body, r.urgency, r.place,
         p.unit_name,
         coalesce(w1.name, w2.name),
         s.display_name,
         r.created_at
  from public.staff_issue_photos ph
  join public.staff_issue_reports r on r.id = ph.report_id
  left join public.rental_properties p on p.id = r.property_id
  left join public.work_sites w1 on w1.id = p.work_site_id
  left join public.work_sites w2 on w2.id = r.work_site_id
  left join public.staff s on s.id = r.staff_id
  where ph.removed_at is null and ph.backed_up_at is null
  order by r.created_at, ph.created_at, ph.id
  limit 2000;
end $$;
revoke all on function public.issue_photo_manifest() from public, anon;
grant execute on function public.issue_photo_manifest() to authenticated;

-- "I saved this zip somewhere safe": counts those photos as backed up. Tandem
-- cannot see where a downloaded file went, so this is the member's word.
create or replace function public.mark_issue_photos_backed_up_zip(p_photo_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if not (public.is_member() and public.has_permission('rentals')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.staff_issue_photos
     set backed_up_at = now(), backup_kind = 'zip'
   where id = any(coalesce(p_photo_ids, '{}'::uuid[]))
     and removed_at is null and backed_up_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.mark_issue_photos_backed_up_zip(uuid[]) from public, anon;
grant execute on function public.mark_issue_photos_backed_up_zip(uuid[]) to authenticated;

-- Read-only check: five columns and three functions.
select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'staff_issue_photos'
    and column_name in ('backed_up_at', 'backup_kind', 'drive_file_id', 'drive_folder_url', 'removed_at') order by 1;
select proname from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('issue_photo_summary', 'issue_photo_manifest', 'mark_issue_photos_backed_up_zip') order by 1;

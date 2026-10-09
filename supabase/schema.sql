-- Tandem schema: shared task board for a small household/team of member
-- accounts (started as exactly Ada + Aaron; see members.permissions below
-- for how a member's access narrows past that original pair).
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a fresh project.

create extension if not exists pgcrypto;

create type task_status as enum ('to_do', 'in_progress', 'done');
create type task_priority as enum ('low', 'med', 'high');
create type task_source as enum ('teams', 'email', 'none');
create type task_recurrence as enum (
  'none', 'daily', 'weekly', 'selected_weekdays', 'biweekly', 'every_3_weeks', 'monthly',
  'every_2_months', 'quarterly', 'every_6_months', 'annually'
);
-- Per-ordered-pair task-access grant level (see task_access below) — null
-- (no row for that pair) means fully hidden, 'view' means read-only,
-- 'update' means can edit. Deliberately the opposite of members.
-- permissions' deny-list shape: that one exists so every existing member
-- keeps full access with zero data; this one exists specifically to
-- restrict access, so a missing grant must mean no access, never full.
create type task_access_level as enum ('view', 'update');

-- Available (default while online) / Busy / In a meeting — see
-- working_status below. Busy/In a meeting still count as "working"; only
-- the absence of working_since means offline.
create type member_working_status as enum ('available', 'busy', 'in_meeting');

-- Allowlist of the accounts permitted to use the app. Populate this
-- manually after inviting each account via Supabase Auth.
create table members (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  -- Nullable timestamp rather than a plain boolean: doubles as the on/off
  -- flag (is/isn't null) and lets the UI show "working since 2:15 PM" for
  -- free, with no second column that could drift out of sync.
  working_since timestamptz,
  -- Null means offline (mirrors working_since is null); 'available' is
  -- the default the moment someone goes online. Switching between
  -- available/busy/in_meeting never touches working_since, so the
  -- original start time survives a status change.
  working_status member_working_status,
  -- Expiry for busy/in_meeting ('until changed' = null, never expires on
  -- its own). Deliberately NOT the source of truth on its own — every
  -- reader (WorkingStatusToggle.jsx) computes the *effective* status by
  -- comparing this against the current time at render time, rather than
  -- trusting whatever's stored, so an expiry stays correct even if the
  -- member it belongs to has their own browser closed/asleep past it.
  working_status_until timestamptz,
  -- IANA zone this person's own tasks/schedules should default to (set via
  -- SettingsMenu.jsx) — null means "not set yet", falling back to
  -- timezone.js's device-detection/hardcoded default, same as before this
  -- column existed. Lives here rather than a per-device localStorage value
  -- (like theme) because it has to be mutually visible — the other person
  -- needs to see it too when bulk-adding *your* schedule for you.
  default_timezone text,
  -- Per-member badge color (replaces a hardcoded name->color map that
  -- only had room for exactly two people) — pick one when adding a new
  -- member's row; the default is a plain neutral fallback, not a real
  -- suggestion, so a forgotten value renders as gray rather than broken.
  color text not null default '#8a8a8a',
  -- Deny-list of feature access, {} by default — an absent key or an
  -- explicit `true` means allowed, only an explicit `false` denies it.
  -- Deny-list (not allow-list) specifically so every existing member
  -- needs zero data to keep full access. Keys in use: 'rentals', 'vault',
  -- 'staff', 'reports' (EOD/EOW/EOM submission), 'workingStatus' (can set
  -- their own online/busy/in-meeting status at all — off for Ada, who's a
  -- viewer only) — see has_permission() below. Enforcement for
  -- 'workingStatus' is UI-only for now (same as 'reports'): the existing
  -- "members can update own working status" policy below is a plain
  -- self-row check with no column restriction, so a real server-side gate
  -- would need the same trigger-guard machinery permissions/is_admin
  -- already got, more than this cosmetic feature justifies yet. A
  -- member managed entirely through SettingsMenu.jsx's admin panel
  -- (is_admin below), not created through it — member rows are still
  -- added by hand via Supabase Auth + a manual insert here.
  permissions jsonb not null default '{}'::jsonb,
  -- Who can edit *other* members' permissions above — separate from the
  -- permissions object itself, since this is about who can grant/revoke
  -- access, not what one member can personally see.
  is_admin boolean not null default false
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  -- Every member assigned to this task — an empty array is a task with
  -- no one on it yet (the UI doesn't allow saving one, but the column
  -- itself doesn't enforce it). A native array, not a join table: RLS
  -- here is table-wide (is_member()), not per-assignee, and every
  -- consumer (overlap detection, EOD-report scoping, the who-filter)
  -- already operates client-side over a fully-fetched task list rather
  -- than a server-side WHERE query — a GIN index would be the answer if
  -- that ever changes, not a schema change.
  assignee_ids uuid[] not null default '{}',
  status task_status not null default 'to_do',
  priority task_priority not null default 'med',
  -- A manually-picked Lucide icon *name* (e.g. 'Dumbbell'), from
  -- TASK_ICON_OPTIONS in src/lib/taskIcons.js — null means "keep
  -- guessing one live from the title" (guessTaskIcon, also in
  -- taskIcons.js) rather than nothing at all. Deliberately not storing
  -- the guessed icon here even when it's what's actually shown: the
  -- guess should be able to keep improving later (a bigger/better
  -- keyword map) without a backfill migration touching every existing
  -- row's icon. Only ever set once someone taps the icon and explicitly
  -- picks one, at which point it wins over the guess for good.
  icon text,
  due_date timestamptz,
  -- IANA zone the due_date's wall-clock time was set in (e.g. picking
  -- "3:00 PM" while this is 'America/New_York' means 3pm Eastern, not 3pm
  -- in whichever timezone the browser that created it happened to be in).
  -- Needed to redisplay the same intended time consistently for both of you.
  due_timezone text not null default 'America/Chicago',
  -- How long the task is expected to take, in minutes, starting at
  -- due_date — null means it's just a point-in-time/deadline with no
  -- span. Drives the "7:45–8:45 PM" range display; the end time is always
  -- derived (due_date + duration_minutes), never stored separately, so it
  -- can't drift out of sync with due_date.
  duration_minutes integer,
  source task_source not null default 'none',
  source_note text,
  notes text,
  -- Lightweight subtask checklist: [{ id, text, done }, ...]. A jsonb array
  -- rather than a child table — a handful of checklist items per task
  -- doesn't need its own relation, RLS policies, and fetch/join logic.
  checklist jsonb not null default '[]'::jsonb,
  recurrence task_recurrence not null default 'none',
  -- PostgreSQL weekday numbers (Sunday = 0 through Saturday = 6). Used
  -- only by selected_weekdays; the other recurrence modes leave it empty.
  recurrence_days smallint[] not null default '{}',
  -- The template points to itself; generated occurrences point to their
  -- template. This supplies a stable database-level deduplication key.
  recurrence_series_id uuid references tasks (id) on delete cascade,
  constraint tasks_recurrence_days_valid check (
    recurrence::text <> 'selected_weekdays'
    or (cardinality(recurrence_days) > 0 and recurrence_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[])
  ),
  created_by uuid not null references members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  -- Optional proof-of-completion, e.g. a link to the finished website or
  -- a note about what was done — filled in after checking a task done,
  -- not required to complete it.
  completion_note text,
  -- Optional completion attachments — screenshots, PDFs, docs, slide
  -- decks, whatever the task called for — uploaded to the
  -- `task-attachments` Storage bucket (see the bucket + policies below).
  -- A jsonb array of { url, name }, same pattern as checklist: a handful
  -- of files per task doesn't need its own child table. url is the full
  -- public URL (bucket is public); name is the original filename, kept
  -- separately from the storage path (which is namespaced/timestamped to
  -- avoid collisions) so the UI can show "meeting_notes.docx" instead of
  -- a generated path, and so it knows whether to render an image preview
  -- or a plain download link.
  completion_attachments jsonb not null default '[]'::jsonb,
  -- Set once the "about to start" push reminder has fired for this task,
  -- so the reminder cron job (runs every few minutes) doesn't re-notify
  -- on every subsequent pass. Null means not sent yet.
  reminder_sent_at timestamptz,
  -- Same one-shot dedup idea as reminder_sent_at, for the "still overdue
  -- after N days" nudge instead of the "about to start" one — set by
  -- either the automatic overdue-nudge cron pass (notify-reminders) or a
  -- manual per-task nudge (manual-notify), whichever fires first, so the
  -- other doesn't immediately duplicate it. Unlike reminder_sent_at, this
  -- one is read by the frontend — InboxView.jsx's Nudges section (see
  -- tasks.js's getNudgedTasks) surfaces any task this is set on.
  overdue_nudge_sent_at timestamptz,
  -- Lightweight Q&A thread for clarifying a vague assignment — same
  -- "doesn't need a child table" reasoning as checklist/
  -- completion_attachments. A jsonb array of { id, askedBy, question,
  -- questionAttachments, answer, answerAttachments, askedAt, answeredBy,
  -- answeredAt }; askedBy/answeredBy are members.id, answer/answeredBy/
  -- answeredAt are null until answered. questionAttachments/
  -- answerAttachments are [{url, name}] arrays, same shape and bucket as
  -- completion_attachments — either message can be attachment-only, with
  -- its text left '' rather than required. Purely client-driven, no
  -- server-side logic — generate_month_occurrences() doesn't reference
  -- it, so a recurring task's generated occurrences each start with an
  -- empty thread rather than carrying forward the template's own Q&A.
  clarifications jsonb not null default '[]'::jsonb
);

create index tasks_status_idx on tasks (status);
create index tasks_due_date_idx on tasks (due_date);
create unique index tasks_recurrence_series_due_unique
  on tasks (recurrence_series_id, due_date)
  where recurrence_series_id is not null and due_date is not null;

-- What viewer_id may see/do regarding target_id's own tasks — one row per
-- ordered pair, not per task; a task's actual accessibility is resolved
-- at query time from every one of its assignee_ids (see can_view_task()
-- and friends below), not stored per-task. Absence of a row is the
-- default and means fully hidden (see task_access_level above for why).
-- can_create/can_delete/can_reassign are checked with a stricter "every
-- other assignee" rule than plain view/update's "any assignee" rule —
-- being a co-assignee on a shared task must not let someone delete or
-- reassign it away from people they have no such grant for.
create table task_access (
  viewer_id uuid not null references members (id) on delete cascade,
  target_id uuid not null references members (id) on delete cascade,
  level task_access_level,
  can_create boolean not null default false,
  can_delete boolean not null default false,
  can_reassign boolean not null default false,
  updated_at timestamptz not null default now(),
  -- Nullable: rows written by the grant_admin_access_to_new_member
  -- trigger below or a migration backfill have no human granter.
  updated_by uuid references members (id) on delete set null,
  primary key (viewer_id, target_id),
  constraint task_access_no_self_grant check (viewer_id <> target_id),
  -- Can't grant Create/Delete/Reassign on a row still set to Hidden —
  -- matches the admin UI's own "disable incompatible controls" rule.
  constraint task_access_actions_require_access check (
    level is not null or (not can_create and not can_delete and not can_reassign)
  )
);

alter table task_access enable row level security;

create or replace function stamp_task_access_meta()
returns trigger as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$ language plpgsql;

create trigger task_access_stamp_meta
before insert or update on task_access
for each row execute function stamp_task_access_meta();

-- The moment a new member's row is created, every existing admin
-- automatically gets full view & update access to THAT member's own
-- tasks ("as her supervisors") — no manual grant needed before they can
-- oversee her work. The reverse (what the new member can see of an
-- admin) stays fully hidden by default, since this only ever inserts
-- rows with the new member as target_id, never as viewer_id.
-- Deliberately does not set can_delete/can_reassign — left for an admin
-- to grant explicitly via the (future) access-management screen.
create or replace function grant_admin_access_to_new_member()
returns trigger as $$
begin
  insert into task_access (viewer_id, target_id, level)
  select m.id, new.id, 'update'
  from members m
  where m.is_admin and m.id <> new.id
  on conflict (viewer_id, target_id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger members_grant_admin_access_to_new_member
after insert on members
for each row execute function grant_admin_access_to_new_member();

-- Tombstones for individual generated occurrences the user deliberately
-- deletes. Without this, the monthly ensure pass sees a missing date and
-- recreates it immediately.
create table task_recurrence_exclusions (
  recurrence_series_id uuid not null references tasks (id) on delete cascade,
  due_date timestamptz not null,
  primary key (recurrence_series_id, due_date)
);

alter table task_recurrence_exclusions enable row level security;

create or replace function remember_deleted_recurrence_occurrence()
returns trigger as $$
begin
  if old.recurrence_series_id is not null
     and old.recurrence_series_id <> old.id
     and pg_trigger_depth() = 1
     and coalesce(current_setting('app.recurrence_sync', true), '0') <> '1' then
    insert into task_recurrence_exclusions (recurrence_series_id, due_date)
    values (old.recurrence_series_id, old.due_date)
    on conflict do nothing;
  end if;
  return old;
end;
$$ language plpgsql security definer;

create trigger tasks_remember_deleted_recurrence_occurrence
before delete on tasks
for each row execute function remember_deleted_recurrence_occurrence();

-- Keep updated_at/completed_at in sync with status changes.
create or replace function set_task_meta()
returns trigger as $$
begin
  new.updated_at = now();
  if new.status = 'done' and old.status <> 'done' then
    new.completed_at = now();
  elsif new.status <> 'done' then
    new.completed_at = null;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger tasks_set_meta
before update on tasks
for each row execute function set_task_meta();

-- Recurrence: every non-'none' recurrence type is materialized ahead of
-- time as real rows, not spawned one-at-a-time on completion. The first
-- task saved with a recurrence becomes a template (recurrence_series_id
-- points to its own id — see prepare_recurrence_series below); every
-- generated occurrence points its recurrence_series_id back at that
-- template, deduplicated by the (recurrence_series_id, due_date) unique
-- index above rather than application logic. This used to be true only
-- for "selected weekdays" schedules, with every other recurrence type
-- (daily/weekly/monthly/...) instead spawning exactly one next occurrence
-- on completion and nothing before that — which meant a still-open
-- recurring task's future occurrences simply didn't exist yet anywhere,
-- including on the calendar. Unifying every type onto the same
-- template/materialize model makes every Repeats option behave the same
-- way: pick one, and its upcoming occurrences show up on the calendar
-- immediately, not only after you complete the current one.
create or replace function prepare_recurrence_series()
returns trigger as $$
begin
  if new.recurrence::text <> 'none' and new.recurrence_series_id is null then
    new.recurrence_series_id := new.id;
  elsif new.recurrence::text = 'none' and new.recurrence_series_id = new.id then
    new.recurrence_series_id := null;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger tasks_prepare_recurrence_series
before insert or update of recurrence, recurrence_days on tasks
for each row execute function prepare_recurrence_series();

-- Materializes template_id's occurrences landing inside target_month.
-- Selected-weekday schedules match by day-of-week, over every day in the
-- month (no fixed step to anchor from). Every other recurrence type has
-- a fixed step (a day count for daily/weekly/biweekly/every_3_weeks, a
-- calendar-month count for monthly/every_2_months/quarterly/
-- every_6_months/annually) and is walked forward from the template's own
-- due_date via generate_series — the same '+ interval' arithmetic the
-- old per-completion spawn used (so a monthly task recurring on the 31st
-- still compounds/clamps exactly like it always has, e.g. Jan 31 -> Feb
-- 28 -> Mar 28, not Mar 31), just computed as a sequence up front instead
-- of one step at a time. Both branches share the same assignee
-- resolution, exclusion check, and (recurrence_series_id, due_date)
-- on-conflict dedup.
create or replace function generate_month_occurrences(template_id uuid, target_month date)
returns void as $$
declare
  template tasks%rowtype;
  month_start date := date_trunc('month', target_month)::date;
  month_end date := (date_trunc('month', target_month) + interval '1 month - 1 day')::date;
  month_end_ts timestamptz;
  wall_time time;
  step interval;
begin
  select * into template from tasks where id = template_id;
  if not found or template.recurrence::text = 'none'
     or template.recurrence_series_id <> template.id or template.due_date is null then
    return;
  end if;

  wall_time := (template.due_date at time zone template.due_timezone)::time;
  -- No assignee lookup needed here any more — assignee_ids is copied
  -- straight from the template (below), and created_by (not null, no
  -- default, always supplied by every real insert path) needs no
  -- fallback resolution either.

  if template.recurrence::text = 'selected_weekdays' then
    insert into tasks (
      title, assignee_ids, priority, icon, due_date, due_timezone, duration_minutes,
      source, source_note, notes, checklist, recurrence, recurrence_days,
      created_by, recurrence_series_id
    )
    select template.title, template.assignee_ids, template.priority, template.icon,
      (day_stamp::date + wall_time) at time zone template.due_timezone,
      template.due_timezone, template.duration_minutes, template.source,
      template.source_note, template.notes, template.checklist,
      template.recurrence, template.recurrence_days,
      template.created_by, template.id
    from generate_series(month_start::timestamp, month_end::timestamp, interval '1 day') as days(day_stamp)
    where extract(dow from day_stamp)::smallint = any(template.recurrence_days)
      and (day_stamp::date + wall_time) at time zone template.due_timezone <> template.due_date
      and not exists (
        select 1 from task_recurrence_exclusions e
        where e.recurrence_series_id = template.id
          and e.due_date = (day_stamp::date + wall_time) at time zone template.due_timezone
      )
    on conflict (recurrence_series_id, due_date)
      where recurrence_series_id is not null and due_date is not null do nothing;
    return;
  end if;

  step := case template.recurrence::text
    when 'daily' then interval '1 day'
    when 'weekly' then interval '7 days'
    when 'biweekly' then interval '14 days'
    when 'every_3_weeks' then interval '21 days'
    when 'monthly' then interval '1 month'
    when 'every_2_months' then interval '2 months'
    when 'quarterly' then interval '3 months'
    when 'every_6_months' then interval '6 months'
    when 'annually' then interval '1 year'
  end;
  if step is null then
    return;
  end if;

  -- One day past month_end, in the template's own zone, so a candidate
  -- landing on the last day of the month is still inside generate_series'
  -- inclusive upper bound.
  month_end_ts := (month_end + 1)::timestamp at time zone template.due_timezone;

  insert into tasks (
    title, assignee_ids, priority, icon, due_date, due_timezone, duration_minutes,
    source, source_note, notes, checklist, recurrence, recurrence_days,
    created_by, recurrence_series_id
  )
  select template.title, template.assignee_ids, template.priority, template.icon,
    occurrence, template.due_timezone, template.duration_minutes, template.source,
    template.source_note, template.notes, template.checklist,
    template.recurrence, template.recurrence_days,
    template.created_by, template.id
  from generate_series(template.due_date, month_end_ts, step) as occ(occurrence)
  where (occurrence at time zone template.due_timezone)::date between month_start and month_end
    and occurrence <> template.due_date
    and not exists (
      select 1 from task_recurrence_exclusions e
      where e.recurrence_series_id = template.id and e.due_date = occurrence
    )
  on conflict (recurrence_series_id, due_date)
    where recurrence_series_id is not null and due_date is not null do nothing;
end;
$$ language plpgsql security definer;

-- Keeps a template's own materialized occurrences honest as it's edited,
-- and always regenerates the real current calendar month right away
-- (independent of whichever month the editor happens to be browsing —
-- see ensure_month_recurrences below for materializing whatever month is
-- actually being viewed).
create or replace function sync_current_month_recurrences()
returns trigger as $$
begin
  if tg_op = 'UPDATE' and old.recurrence_series_id = old.id and (
    new.recurrence::text <> old.recurrence::text
    or new.due_date is distinct from old.due_date
    or new.due_timezone is distinct from old.due_timezone
    or new.recurrence_days is distinct from old.recurrence_days
  ) then
    perform set_config('app.recurrence_sync', '1', true);
    delete from tasks where recurrence_series_id = old.id and id <> old.id and status <> 'done';
    perform set_config('app.recurrence_sync', '0', true);
  end if;
  if new.recurrence::text <> 'none' and new.recurrence_series_id = new.id then
    perform generate_month_occurrences(new.id, current_date);
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger tasks_sync_current_month_recurrences
after insert or update of recurrence, recurrence_days, due_date, due_timezone on tasks
for each row execute function sync_current_month_recurrences();

-- Called from the client (see ensureMonthRecurrences in tasks.js) whenever
-- the viewed month changes, so every recurring template's occurrences for
-- that month exist by the time the calendar renders it.
create or replace function ensure_month_recurrences(target_month date)
returns void as $$
declare template_id uuid;
begin
  if not exists (select 1 from members where id = auth.uid()) then raise exception 'Not authorized'; end if;
  for template_id in select id from tasks
    where recurrence::text <> 'none' and recurrence_series_id = id
  loop
    perform generate_month_occurrences(template_id, target_month);
  end loop;
end;
$$ language plpgsql security definer;

create or replace function delete_recurring_task(target_task_id uuid, delete_future boolean)
returns void as $$
declare
  target tasks%rowtype;
  series_id uuid;
  replacement_id uuid;
begin
  if not exists (select 1 from members where id = auth.uid()) then
    raise exception 'Not authorized';
  end if;

  select * into target from tasks where id = target_task_id;
  if not found then return; end if;
  -- security definer bypasses tasks' own RLS entirely, so this can't rely
  -- on the DELETE policy to keep an unauthorized caller out — can_delete_task
  -- (defined further down, forward-referenced here; fine for plpgsql, which
  -- only resolves other functions at call time, not at CREATE time) is
  -- called explicitly instead, same check the DELETE policy itself uses.
  if not can_delete_task(target.assignee_ids) then
    raise exception 'Not authorized';
  end if;
  series_id := coalesce(target.recurrence_series_id, target.id);

  if delete_future then
    -- Preserve earlier history without its old parent link, then delete
    -- the template; its cascade removes the selected and later rows.
    update tasks set recurrence = 'none', recurrence_days = '{}',
      recurrence_series_id = null
    where recurrence_series_id = series_id
      and id <> series_id
      and due_date < target.due_date;
    delete from tasks where id = series_id;
    return;
  end if;

  if target.id <> series_id then
    delete from tasks where id = target.id;
    return;
  end if;

  -- "Only this" can also be chosen on the visible template occurrence.
  -- Promote another occurrence to template before removing the old one.
  select id into replacement_id from tasks
  where recurrence_series_id = series_id and id <> series_id
  order by due_date nulls last limit 1;

  if replacement_id is null then
    delete from tasks where id = target.id;
    return;
  end if;

  update tasks set recurrence_series_id = replacement_id where id = replacement_id;
  update tasks set recurrence_series_id = replacement_id
    where recurrence_series_id = series_id and id <> series_id;
  update task_recurrence_exclusions set recurrence_series_id = replacement_id
    where recurrence_series_id = series_id;
  insert into task_recurrence_exclusions (recurrence_series_id, due_date)
    values (replacement_id, target.due_date) on conflict do nothing;
  delete from tasks where id = target.id;
end;
$$ language plpgsql security definer;

-- RLS: every allow-listed member can read every other member's own row
-- (needed for attribution/greeting/badges) and can read the whole staff
-- roster. Task-level access is NOT uniform mutual visibility any more —
-- see can_view_task() and friends below, which resolve access per task
-- from task_access grants, not a blanket is_member() check.
alter table members enable row level security;
alter table tasks enable row level security;

-- security definer so checking "is caller a member" doesn't recursively
-- re-trigger RLS on the members table it queries.
create or replace function is_member()
returns boolean as $$
  select exists (select 1 from members where id = auth.uid());
$$ language sql security definer stable;

-- Per-member feature gating, alongside is_member() (never instead of it) —
-- members.permissions is a deny-list jsonb blob ({} by default), so an
-- absent key or explicit `true` means allowed and only an explicit
-- `false` denies it. Deny-list rather than allow-list specifically so
-- every existing member needs zero data to keep full access — a brand
-- new feature key someday needs no migration either, just a caller that
-- starts checking has_permission('newFeature'). Feature names in use:
-- 'rentals', 'vault', 'staff', 'reports' (EOD/EOW/EOM submission).
create or replace function has_permission(feature text)
returns boolean as $$
  select exists (
    select 1 from members
    where id = auth.uid()
      and coalesce((permissions ->> feature)::boolean, true)
  );
$$ language sql security definer stable;

-- Task-level authorization, alongside is_member() (never instead of it).
-- Two shapes, matching task_access's own comment: "any assignee" for
-- view/update (being assigned to a task always grants baseline access to
-- it; a non-assignee viewer needs the matching grant for at least one
-- assignee), and "every other assignee" for delete/reassign/create
-- (stricter — co-assignment alone must never let someone delete/reassign
-- a task away from people they have no grant for). security definer
-- stable, same shape as is_member()/has_permission(), so checking
-- task_access doesn't recursively re-trigger RLS on task_access itself.
create or replace function can_view_task(assignees uuid[])
returns boolean as $$
  select auth.uid() = any(assignees)
    or exists (
      select 1 from task_access
      where viewer_id = auth.uid() and target_id = any(assignees)
        and level in ('view', 'update')
    );
$$ language sql security definer stable;

create or replace function can_update_task(assignees uuid[])
returns boolean as $$
  select auth.uid() = any(assignees)
    or exists (
      select 1 from task_access
      where viewer_id = auth.uid() and target_id = any(assignees) and level = 'update'
    );
$$ language sql security definer stable;

-- Who already has legitimate visibility into a given task — assignees,
-- plus anyone with a view/update task_access grant toward any of them.
-- Backs TaskRow.jsx's post-completion "Notify" picker: the picker's own
-- options are deliberately limited to this set, not every member, so it
-- can never suggest notifying someone into a dead end (a push that
-- opens to a task they can't actually see). can_view_task above answers
-- "can *I* see this task"; this answers "who *besides me* can," which
-- can_view_task alone can't express since it only ever checks auth.uid().
create or replace function members_who_can_view_task(check_task_id uuid)
returns table(member_id uuid)
language sql
security definer
stable
as $$
  select m.id
  from members m
  join tasks t on t.id = check_task_id
  where is_member()
    and (
      m.id = any(t.assignee_ids)
      or exists (
        select 1 from task_access ta
        where ta.viewer_id = m.id and ta.target_id = any(t.assignee_ids) and ta.level in ('view', 'update')
      )
    );
$$;

grant execute on function members_who_can_view_task(uuid) to authenticated;

-- "Every other assignee" shape, shared by can_delete_task/
-- can_reassign_task/can_create_task_for — a task assigned solely to the
-- caller has no "other assignee" to check, so unnest() over that empty
-- set makes the inner not exists() vacuously satisfied and this returns
-- true: you're always fully able to delete/reassign/create for your own
-- solo tasks.
create or replace function can_delete_task(assignees uuid[])
returns boolean as $$
  select not exists (
    select 1 from unnest(assignees) as other(id)
    where other.id <> auth.uid()
      and not exists (
        select 1 from task_access
        where viewer_id = auth.uid() and target_id = other.id and can_delete
      )
  );
$$ language sql security definer stable;

create or replace function can_reassign_task(assignees uuid[])
returns boolean as $$
  select not exists (
    select 1 from unnest(assignees) as other(id)
    where other.id <> auth.uid()
      and not exists (
        select 1 from task_access
        where viewer_id = auth.uid() and target_id = other.id and can_reassign
      )
  );
$$ language sql security definer stable;

-- Gates who a task may be created for/reassigned to: the caller needs a
-- can_create grant for every OTHER member being assigned. Assigning
-- purely to yourself needs no grant at all.
create or replace function can_create_task_for(assignees uuid[])
returns boolean as $$
  select not exists (
    select 1 from unnest(assignees) as other(id)
    where other.id <> auth.uid()
      and not exists (
        select 1 from task_access
        where viewer_id = auth.uid() and target_id = other.id and can_create
      )
  );
$$ language sql security definer stable;

-- Reassignment (changing assignee_ids on an existing task) needs the
-- stricter can_reassign_task/can_create_task_for grants, not just plain
-- can_update_task — but RLS's UPDATE policy (using/with check below)
-- never sees OLD and NEW at once, so "did assignee_ids actually change"
-- can't be expressed there. Only a trigger can compare both, so this
-- rule lives here instead — a plain field edit (checklist, notes) never
-- fires this at all, since it's scoped to "before update of assignee_ids".
create or replace function enforce_task_reassignment_access()
returns trigger as $$
begin
  if new.assignee_ids is distinct from old.assignee_ids then
    if not can_reassign_task(old.assignee_ids) then
      raise exception 'Not authorized to reassign this task away from its current assignees';
    end if;
    if not can_create_task_for(new.assignee_ids) then
      raise exception 'Not authorized to assign this task to one or more of the new assignees';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger tasks_enforce_reassignment_access
before update of assignee_ids on tasks
for each row execute function enforce_task_reassignment_access();

-- The actual mechanism behind "notify-task-events — Database Webhook on
-- tasks INSERT/UPDATE" (see that function's own header comment): not a
-- Dashboard-configured Database Webhook, a plain pg_net-based trigger
-- calling the deployed Edge Function's URL directly. Found missing from
-- this file entirely on Oct 2, 2026 during a full deployment-cohesion
-- audit — it was real, correct, working production infrastructure
-- (confirmed via pg_get_functiondef against the live database) that had
-- simply never been captured here, so a from-scratch rebuild of this
-- project would have silently lost task assignment/completion
-- notifications with no error anywhere pointing at why. The project URL
-- below is this specific Supabase project's own — a different project
-- needs its own URL substituted in by hand, same as every other
-- project-specific value (VAPID keys, etc.) this app's setup already
-- requires.
create extension if not exists pg_net;

create or replace function notify_task_event()
returns trigger as $$
begin
  perform net.http_post(
    url := 'https://qizvsymlntbukuhypkxh.supabase.co/functions/v1/notify-task-events',
    -- x-notify-secret: the function refuses callers without it (see
    -- supabase/set-notify-secret.sql). Keep the real value out of git: this
    -- placeholder is replaced by hand when the SQL is run.
    headers := '{"Content-Type": "application/json", "x-notify-secret": "REPLACE-WITH-NOTIFY-SECRET"}'::jsonb,
    body := jsonb_build_object(
      'type', tg_op,
      'table', 'tasks',
      'record', to_jsonb(new),
      'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) else null end
    )
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists tasks_notify_events on tasks;
create trigger tasks_notify_events
after insert or update on tasks
for each row execute function notify_task_event();

-- Both members can see each other's display name — needed for the greeting
-- and task attribution features.
create policy "members can read all members"
  on members for select
  using (is_member());

-- A viewer can read their own outgoing grants (what they've been granted
-- about others), never the reverse (who can see them) — full admin
-- read/write over every grant is the security definer RPC below.
create policy "members can read their own outgoing task access grants"
  on task_access for select
  using (is_member() and viewer_id = auth.uid());

-- Admin-managed access (ManageMemberAccessView.jsx / MemberAccessForm.jsx).
-- Mirrors is_member()/has_permission()'s shape.
create or replace function is_admin_member()
returns boolean as $$
  select exists (select 1 from members where id = auth.uid() and is_admin);
$$ language sql security definer stable;

-- members' only UPDATE policy ("members can update own working status",
-- below) has no column restriction — it was written before permissions/
-- is_admin existed as columns, so as-is it would let any member update
-- either one on their own row via a raw client call (self-granting admin
-- status, or clearing their own restrictions). This trigger closes that:
-- permissions/is_admin can only change through the flag-guarded RPC
-- below. before insert isn't needed — members has no INSERT policy at
-- all today (rows are only ever created by hand), so there's no insert
-- path to guard yet.
create or replace function guard_member_privilege_columns()
returns trigger as $$
begin
  if (new.permissions is distinct from old.permissions or new.is_admin is distinct from old.is_admin)
     and coalesce(current_setting('app.member_privilege_write', true), '0') <> '1' then
    raise exception 'permissions/is_admin can only be changed via set_member_permissions()';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger members_guard_privilege_columns
before update on members
for each row execute function guard_member_privilege_columns();

-- The one controlled write path for `permissions`. Deliberately has no
-- way to set `is_admin` — admin-role transfer stays SQL-editor-only for
-- now (promoting/demoting an admin needs
-- `select set_config('app.member_privilege_write', '1', true);` run
-- first in the same session, then a plain update — the guard trigger
-- above blocks it otherwise, from any role including the SQL editor's).
-- set_config's is_local=true flag is transaction-scoped — PostgREST
-- wraps each RPC call in its own transaction, so it can never leak into
-- a later, unrelated request; reset explicitly anyway to match this
-- schema's existing app.recurrence_sync convention. The jsonb_typeof
-- guard matters because has_permission()'s
-- (permissions ->> feature)::boolean lookup fails OPEN (coalesce(...,
-- true)) when the key is missing or the value isn't parseable — a
-- malformed permissions value would silently grant everything rather
-- than denying it, so a non-object is rejected outright here.
create or replace function set_member_permissions(target_id uuid, new_permissions jsonb)
returns members
language plpgsql
security definer
set search_path = public
as $$
declare
  updated members%rowtype;
begin
  if not is_admin_member() then
    raise exception 'Not authorized';
  end if;
  if jsonb_typeof(new_permissions) <> 'object' then
    raise exception 'permissions must be a JSON object';
  end if;

  perform set_config('app.member_privilege_write', '1', true);
  update members set permissions = new_permissions where id = target_id
  returning * into updated;
  perform set_config('app.member_privilege_write', '0', true);

  if not found then
    raise exception 'Member not found';
  end if;
  return updated;
end;
$$;

grant execute on function set_member_permissions(uuid, jsonb) to authenticated;

-- An admin needs to read grants between two OTHER members too, not just
-- their own outgoing ones — the self-only policy above stays as-is.
create policy "admins can read all task access grants"
  on task_access for select
  using (is_member() and is_admin_member());

-- The one write path for task_access — no direct INSERT/UPDATE policy
-- needed since this RPC is the sole mechanism. viewer_id/target_id's own
-- FK constraints (references members(id)) already reject a non-member
-- id, so no redundant existence check here — it would only turn a raw
-- foreign-key-violation error into a friendlier message, not add
-- correctness.
create or replace function upsert_task_access(
  p_viewer_id uuid, p_target_id uuid, p_level task_access_level,
  p_can_create boolean, p_can_delete boolean, p_can_reassign boolean
)
returns task_access
language plpgsql
security definer
set search_path = public
as $$
declare
  result task_access%rowtype;
begin
  if not is_admin_member() then
    raise exception 'Not authorized';
  end if;
  if p_viewer_id = p_target_id then
    raise exception 'Cannot grant a member access to themselves';
  end if;

  insert into task_access (viewer_id, target_id, level, can_create, can_delete, can_reassign)
  values (p_viewer_id, p_target_id, p_level, p_can_create, p_can_delete, p_can_reassign)
  on conflict (viewer_id, target_id) do update set
    level = excluded.level, can_create = excluded.can_create,
    can_delete = excluded.can_delete, can_reassign = excluded.can_reassign
  returning * into result;
  return result;
end;
$$;

grant execute on function upsert_task_access(uuid, uuid, task_access_level, boolean, boolean, boolean) to authenticated;

create policy "members can view accessible tasks"
  on tasks for select
  using (is_member() and can_view_task(assignee_ids));

create policy "members can insert tasks they may create"
  on tasks for insert
  with check (is_member() and can_create_task_for(assignee_ids));

create policy "members can update accessible tasks"
  on tasks for update
  using (is_member() and can_update_task(assignee_ids))
  with check (is_member() and can_update_task(assignee_ids));

create policy "members can delete accessible tasks"
  on tasks for delete
  using (is_member() and can_delete_task(assignee_ids));

-- A record of the person-level 👋 header nudge (TaskBoard.jsx's picker —
-- distinct from the task-level 🔔 nudge, which just sets
-- tasks.overdue_nudge_sent_at and needs no table of its own). Was
-- previously a pure fire-and-forget push with nothing persisted, so
-- there was no way to browse "who nudged whom" afterward and no in-app
-- record for someone who missed the push. The only write path is
-- manual-notify's own service-role client (see its 'nudge' branch) — no
-- client-facing INSERT policy needed at all, same reasoning time_entries
-- locks staff writes to one controlled RPC rather than a broad policy.
create table member_nudges (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references members (id) on delete cascade,
  target_id uuid not null references members (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table member_nudges enable row level security;

create policy "members can read all member nudges"
  on member_nudges for select
  using (is_member());

-- Storage bucket for optional completion screenshots/photos. Created
-- public here so a fresh project has something to migrate from — the
-- "Private task attachments" incremental migration far below flips this
-- same bucket to public=false and replaces every policy below with
-- authenticated, per-task-access-gated ones. Don't take this block's own
-- policies as the current behavior; they're superseded, not this app's
-- actual attachment privacy model.
insert into storage.buckets (id, name, public)
values ('task-attachments', 'task-attachments', true)
on conflict (id) do nothing;

create policy "members can upload task attachments"
  on storage.objects for insert
  with check (bucket_id = 'task-attachments' and is_member());

create policy "members can update task attachments"
  on storage.objects for update
  using (bucket_id = 'task-attachments' and is_member());

create policy "members can view task attachments"
  on storage.objects for select
  using (bucket_id = 'task-attachments' and is_member());

create policy "members can delete task attachments"
  on storage.objects for delete
  using (bucket_id = 'task-attachments' and is_member());

-- Web push subscriptions. One member can have several rows (one per
-- device/browser they've enabled notifications on — phone + desktop,
-- say). The Edge Functions that actually send pushes use the service
-- role key and so bypass RLS entirely; these policies only govern what
-- a signed-in client can do to its own subscriptions directly.
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

create policy "members can read own push subscriptions"
  on push_subscriptions for select
  using (member_id = auth.uid());

create policy "members can insert own push subscriptions"
  on push_subscriptions for insert
  with check (member_id = auth.uid());

create policy "members can update own push subscriptions"
  on push_subscriptions for update
  using (member_id = auth.uid())
  with check (member_id = auth.uid());

create policy "members can delete own push subscriptions"
  on push_subscriptions for delete
  using (member_id = auth.uid());

-- Allow updating your own working_since — members previously had only a
-- SELECT policy.
create policy "members can update own working status"
  on members for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- End-of-day/week/month/biweekly reports: manually submitted, auto-
-- tallied from that period's completed tasks but editable before
-- sending. Persisted (not just a fire-and-forget push) since push
-- delivery is best-effort — losing the report entirely if the
-- notification doesn't land defeats the point, especially once it's
-- tracking logged minutes. One row per (submitted_by, period,
-- report_date) — a work day rarely happens in one sitting, so later
-- submissions the same day append to the existing row's body (see
-- upsert_eod_report below) rather than creating a new, disconnected row
-- per session. 'biweekly' matches the household's actual payroll cutoff
-- (a fixed 14-day cycle anchored to a known pay-period start, not just
-- "the last 14 days" — see BIWEEKLY_ANCHOR in src/lib/tasks.js), added
-- for accounting all tasks completed within one payroll period at once.
create type report_period as enum ('day', 'week', 'month', 'biweekly');

create table eod_reports (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references members (id),
  period report_period not null default 'day',
  -- Always passed explicitly by the client, computed in the submitter's
  -- own local timezone (see reportDateForPeriod in src/lib/tasks.js) —
  -- deliberately no default here, since a UTC-based one would silently
  -- bucket under the wrong day for part of every day in the Philippines.
  report_date date not null,
  -- Minutes, not decimal hours — avoids "4h20m -> 4.33" mental math, and
  -- an unambiguous integer over float rounding. Overwritten, not summed,
  -- on each submission: this tracks an external time tracker's running
  -- total for the day, which the submitter corrects to match, not
  -- something this app tallies itself.
  minutes_logged integer,
  body text not null,
  -- Snapshot of completion_attachments pulled from whichever tasks this
  -- submission's tally covered, [{taskTitle, url, name}] — a denormalized
  -- copy rather than a live reference to tasks.id, same "doesn't need a
  -- foreign key, just carry what you need" reasoning as checklist/
  -- clarifications elsewhere. Appends on each submission (see
  -- upsert_eod_report below), same as body, rather than being overwritten.
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  -- Bumped on every append — this is the "since my last submission"
  -- boundary the report form uses to avoid re-listing already-reported
  -- completed tasks in a second session's draft.
  updated_at timestamptz not null default now()
);

alter table eod_reports enable row level security;

-- report_access (viewer_id, target_id) is a plain presence grant — a row
-- means viewer_id may read target_id's reports, same "exists = allowed"
-- shape vault_access already established, not task_access's tiered
-- level/create/delete/reassign model, since reading someone else's
-- report has no finer-grained action to gate than read-or-not. Requested
-- directly once the team grew past two people: a submitter's reports
-- used to be unconditionally mutually visible to every member, which
-- stopped being appropriate once reports could belong to people who
-- aren't supposed to be reading each other's day-to-day work logs
-- (two VAs, say). No auto-grant for admins the way task_access's
-- grant_admin_access_to_new_member() gives — reports are explicitly the
-- more private case here, so even the admin has to opt in to seeing a
-- given member's reports rather than getting it for free.
create table report_access (
  viewer_id uuid not null references members (id) on delete cascade,
  target_id uuid not null references members (id) on delete cascade,
  updated_at timestamptz not null default now(),
  updated_by uuid references members (id) on delete set null,
  primary key (viewer_id, target_id),
  constraint report_access_no_self_grant check (viewer_id <> target_id)
);

alter table report_access enable row level security;

-- Reuses task_access's own generic meta-stamping trigger function — it
-- only ever touches new.updated_at/new.updated_by, nothing table-shaped.
create trigger report_access_stamp_meta
before insert or update on report_access
for each row execute function stamp_task_access_meta();

create policy "members can read their own outgoing report access grants"
  on report_access for select
  using (is_member() and viewer_id = auth.uid());

create policy "admins can read all report access grants"
  on report_access for select
  using (is_member() and is_admin_member());

-- security definer so eod_reports' own SELECT policy below doesn't need
-- a direct cross-table subquery — same has_vault_access()/is_member()
-- reasoning used everywhere else in this schema.
create or replace function has_report_access(check_target_id uuid)
returns boolean as $$
  select exists (select 1 from report_access where viewer_id = auth.uid() and target_id = check_target_id);
$$ language sql security definer stable;

-- The one write path for report_access — a plain presence table, so
-- "granting" is an insert and "revoking" is a delete, not a level
-- change. No direct INSERT/UPDATE/DELETE policy exists on the table
-- itself, by design, same as task_access's own upsert_task_access().
create or replace function set_report_access(p_viewer_id uuid, p_target_id uuid, p_can_view boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin_member() then
    raise exception 'Not authorized';
  end if;
  if p_viewer_id = p_target_id then
    raise exception 'Cannot grant a member access to themselves';
  end if;

  if p_can_view then
    insert into report_access (viewer_id, target_id, updated_by)
    values (p_viewer_id, p_target_id, auth.uid())
    on conflict (viewer_id, target_id) do nothing;
  else
    delete from report_access where viewer_id = p_viewer_id and target_id = p_target_id;
  end if;
end;
$$;

grant execute on function set_report_access(uuid, uuid, boolean) to authenticated;

create policy "members can read accessible eod reports"
  on eod_reports for select
  using (is_member() and (submitted_by = auth.uid() or has_report_access(submitted_by)));

create policy "members can insert own eod reports"
  on eod_reports for insert
  with check (is_member() and submitted_by = auth.uid());

create policy "members can update own eod reports"
  on eod_reports for update
  using (submitted_by = auth.uid())
  with check (submitted_by = auth.uid());

create unique index eod_reports_unique_bucket
  on eod_reports (submitted_by, period, report_date);

-- security invoker (the default, stated explicitly) so the insert/update
-- below still runs under RLS as the calling user — that's why the update
-- policy above is required even though nothing hits it directly from the
-- client. Plain .upsert() can't express this: it can only overwrite
-- columns with literal values, not "old body + new chunk."
create or replace function upsert_eod_report(
  p_period report_period,
  p_report_date date,
  p_body_chunk text,
  p_minutes_logged integer,
  p_attachments jsonb default '[]'::jsonb
) returns eod_reports
language plpgsql
security invoker
as $$
declare
  result eod_reports;
begin
  insert into eod_reports (submitted_by, period, report_date, minutes_logged, body, attachments, updated_at)
  values (auth.uid(), p_period, p_report_date, p_minutes_logged, coalesce(p_body_chunk, ''), coalesce(p_attachments, '[]'::jsonb), now())
  on conflict (submitted_by, period, report_date)
  do update set
    body = case
      when p_body_chunk is null or btrim(p_body_chunk) = '' then eod_reports.body
      else eod_reports.body || E'\n\n---\n' || p_body_chunk
    end,
    attachments = eod_reports.attachments || coalesce(p_attachments, '[]'::jsonb),
    minutes_logged = coalesce(p_minutes_logged, eod_reports.minutes_logged),
    updated_at = now()
  returning * into result;
  return result;
end;
$$;

grant execute on function upsert_eod_report(report_period, date, text, integer, jsonb) to authenticated;

-- Priorities for the upcoming day/week/month — any member can set their
-- own. Append-only: each save is a new row, most recent per (set_by,
-- period) is "current" for that person; querying history is free rather
-- than needing its own table later. Originally a single shared note
-- (whoever saved most recently "won" as the one current entry for
-- everyone, regardless of who actually wrote it) — genuinely per-person
-- now, same "exists = allowed" priorities_access model eod_reports'
-- report_access already established, once it became clear a global
-- "most recent wins" view couldn't coexist with per-person privacy: an
-- admin-restricted viewer would've silently seen a stale older entry
-- standing in for "current" with no indication it wasn't.
create table priorities (
  id uuid primary key default gen_random_uuid(),
  set_by uuid not null references members (id),
  period report_period not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table priorities enable row level security;

create table priorities_access (
  viewer_id uuid not null references members (id) on delete cascade,
  target_id uuid not null references members (id) on delete cascade,
  updated_at timestamptz not null default now(),
  updated_by uuid references members (id) on delete set null,
  primary key (viewer_id, target_id),
  constraint priorities_access_no_self_grant check (viewer_id <> target_id)
);

alter table priorities_access enable row level security;

create trigger priorities_access_stamp_meta
before insert or update on priorities_access
for each row execute function stamp_task_access_meta();

create policy "members can read their own outgoing priorities access grants"
  on priorities_access for select
  using (is_member() and viewer_id = auth.uid());

create policy "admins can read all priorities access grants"
  on priorities_access for select
  using (is_member() and is_admin_member());

create or replace function has_priorities_access(check_target_id uuid)
returns boolean as $$
  select exists (select 1 from priorities_access where viewer_id = auth.uid() and target_id = check_target_id);
$$ language sql security definer stable;

create or replace function set_priorities_access(p_viewer_id uuid, p_target_id uuid, p_can_view boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin_member() then
    raise exception 'Not authorized';
  end if;
  if p_viewer_id = p_target_id then
    raise exception 'Cannot grant a member access to themselves';
  end if;

  if p_can_view then
    insert into priorities_access (viewer_id, target_id, updated_by)
    values (p_viewer_id, p_target_id, auth.uid())
    on conflict (viewer_id, target_id) do nothing;
  else
    delete from priorities_access where viewer_id = p_viewer_id and target_id = p_target_id;
  end if;
end;
$$;

grant execute on function set_priorities_access(uuid, uuid, boolean) to authenticated;

create policy "members can read accessible priorities"
  on priorities for select
  using (is_member() and (set_by = auth.uid() or has_priorities_access(set_by)));

create policy "members can insert priorities"
  on priorities for insert
  with check (is_member() and set_by = auth.uid());

-- Rental occupancy calendar. Two businesses share the same shape (a unit
-- has a name/address and a stream of bookings), so one pair of tables
-- covers both rather than duplicating awa_/azu_ prefixed tables — the
-- 'company' column is what a calendar view filters/groups on.
create type rental_company as enum ('awa', 'azu');
-- 'pending' is an inbound request (e.g. an Airbnb reservation request)
-- not yet accepted — still blocks the dates against a double-booking,
-- but isn't counted as revenue in Financials until confirmed.
create type rental_booking_status as enum ('pending', 'confirmed');
-- Where the tenant/guest actually came from — tracked so it's possible
-- to tell which listing platform is worth the effort. Nullable: optional
-- at booking time, and existing bookings predate this column entirely.
create type rental_booking_source as enum (
  'airbnb', 'furnished_finder', 'rotating_room', 'zillow', 'referral', 'other'
);

-- Short/midterm rooms need active vacancy monitoring (an empty room is
-- money lost); a long-term unit's rent is fixed for the lease and its
-- income is static, so it doesn't belong on the same calendar-first
-- dashboard — see RentalsView.jsx's term toggle and RentalLongTermView.jsx.
create type rental_term as enum ('short_midterm', 'long_term');

create table rental_properties (
  id uuid primary key default gen_random_uuid(),
  company rental_company not null,
  term rental_term not null default 'short_midterm',
  unit_name text not null,
  address text,
  -- Asking/listed monthly rent for the unit — not the same as actual
  -- collected revenue, which would come from bookings if/when this tracks
  -- payment amounts.
  monthly_rent numeric(10, 2),
  -- Per-unit color for the calendar view (distinct ribbon/bar color per
  -- unit) — stored here rather than derived client-side so it stays
  -- consistent regardless of fetch order and can be picked deliberately
  -- per unit instead of auto-assigned.
  color text not null default '#3b82f6',
  -- Soft-hide rather than delete: keeps booking history intact if a unit
  -- is sold/taken off the market.
  active boolean not null default true,
  -- A quick flag for "there's a promising prospective tenant / an active
  -- negotiation happening on this unit right now" — not tied to any
  -- specific booking row (a negotiation usually predates a confirmed
  -- booking existing at all), just a plain toggle set/cleared from the
  -- unit list itself.
  in_negotiation boolean not null default false,
  created_at timestamptz not null default now()
);

create table rental_bookings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references rental_properties (id) on delete cascade,
  guest_name text not null,
  check_in date not null,
  -- Last occupied day, inclusive — not a hotel-style departure day. A
  -- single-day booking has check_out = check_in.
  check_out date not null,
  status rental_booking_status not null default 'confirmed',
  source rental_booking_source,
  -- Only meaningful when source = 'other' — same "free-text detail for
  -- the miscellaneous option" pattern as tasks.source_note.
  source_note text,
  -- General free-form notes about the booking (e.g. "requested early
  -- check-in", "paid via Venmo") — distinct from source_note, which is
  -- specifically the detail for an 'other' source.
  notes text,
  -- Charge dates (see chargeDatesForBooking() in rentals.js) manually
  -- confirmed paid even though the date hasn't arrived yet — an early/
  -- advance payment, which the normal date-driven revenue calc
  -- (isBillableCharge()) would otherwise not count until that day
  -- actually happens. A plain array of 'YYYY-MM-DD' strings, same
  -- "doesn't need a child table" reasoning as tasks.checklist.
  paid_charges jsonb not null default '[]'::jsonb,
  -- Last charge date (see chargeDatesForBooking()) the "rent due today"
  -- reminder already fired for, so the cron pass in notify-reminders
  -- doesn't re-notify on every later run the same day — and, being the
  -- *date* rather than a boolean, naturally allows firing again on a
  -- later cycle's own due date without needing to be reset by hand.
  rent_reminder_sent_for date,
  -- Long-term lease reminders (notify-reminders) — both one-shot, same
  -- reasoning rent_reminder_sent_for gives, but a timestamp rather than a
  -- date since each fires exactly once per booking, not once per cycle.
  last_month_reminder_sent_at timestamptz,
  turnover_reminder_sent_at timestamptz,
  created_by uuid not null references members (id),
  created_at timestamptz not null default now(),
  constraint rental_bookings_dates_check check (check_out >= check_in)
);

create index rental_bookings_property_id_idx on rental_bookings (property_id);
create index rental_bookings_range_idx on rental_bookings (check_in, check_out);

-- One automatically-maintained turnover task per booking. Kept as a
-- nullable link on tasks so ordinary tasks remain completely unchanged;
-- the unique constraint is the database-level duplicate guard.
alter table tasks
  add column rental_turnover_booking_id uuid unique
  references rental_bookings (id) on delete cascade;

create or replace function sync_rental_turnover_task()
returns trigger as $$
declare
  property_name text;
  cleaning_due timestamptz;
  aaron_id uuid;
begin
  -- Pending bookings are not firm move-outs. If a confirmed booking is
  -- moved back to pending, remove its not-yet-needed automatic task.
  if new.status <> 'confirmed' then
    delete from tasks where rental_turnover_booking_id = new.id;
    return new;
  end if;

  select unit_name into property_name
  from rental_properties
  where id = new.property_id;

  -- Give Aaron one week to arrange the turnover. Construct the reminder
  -- day's 10:00 AM wall time in Central before storing it as timestamptz.
  cleaning_due := ((new.check_out - 7) + time '10:00') at time zone 'America/Chicago';

  -- This is a Rentals *operations* decision (who actually handles
  -- turnover), not a general person-count thing, so it deliberately
  -- stays Aaron-specific rather than becoming a config option — just
  -- resolved to a real member id now instead of a fixed enum literal.
  select id into aaron_id from members where lower(display_name) = 'aaron' limit 1;

  insert into tasks (
    title, assignee_ids, priority, due_date, due_timezone, source, notes, checklist,
    created_by, rental_turnover_booking_id
  ) values (
    'Schedule turnover cleaning for ' || property_name,
    array[aaron_id],
    'med',
    cleaning_due,
    'America/Chicago',
    'none',
    'Automatically created seven days before ' || new.guest_name || '''s move-out.',
    jsonb_build_array(jsonb_build_object(
      'id', 'add-cleaner-visit-task',
      'text', 'Add a task for when the cleaner will actually come.',
      'done', false,
      'blocked', false,
      'blockedReason', ''
    )),
    new.created_by,
    new.id
  )
  on conflict (rental_turnover_booking_id) do update set
    title = excluded.title,
    due_date = excluded.due_date,
    due_timezone = excluded.due_timezone,
    notes = excluded.notes,
    assignee_ids = array[aaron_id];

  return new;
end;
$$ language plpgsql security definer;

create trigger rental_bookings_sync_turnover_task
after insert or update of property_id, guest_name, check_out, status
on rental_bookings
for each row execute function sync_rental_turnover_task();

alter table rental_properties enable row level security;
alter table rental_bookings enable row level security;

create policy "members can read all rental properties"
  on rental_properties for select
  using (is_member() and has_permission('rentals'));

create policy "members can insert rental properties"
  on rental_properties for insert
  with check (is_member() and has_permission('rentals'));

create policy "members can update rental properties"
  on rental_properties for update
  using (is_member() and has_permission('rentals'));

create policy "members can delete rental properties"
  on rental_properties for delete
  using (is_member() and has_permission('rentals'));

create policy "members can read all rental bookings"
  on rental_bookings for select
  using (is_member() and has_permission('rentals'));

create policy "members can insert rental bookings"
  on rental_bookings for insert
  with check (is_member() and has_permission('rentals'));

create policy "members can update rental bookings"
  on rental_bookings for update
  using (is_member() and has_permission('rentals'));

create policy "members can delete rental bookings"
  on rental_bookings for delete
  using (is_member() and has_permission('rentals'));

-- Recurring monthly costs (mortgage, utilities, ...) scoped to a company
-- as a whole rather than to one rental_properties row — a mortgage can
-- cover several units at once (e.g. Awa Rentalz's $2,500/mo covers both
-- Rachel Street buildings/4 units together), so per-unit linkage would be
-- wrong more often than it'd be right.
create table rental_expenses (
  id uuid primary key default gen_random_uuid(),
  company rental_company not null,
  label text not null,
  amount numeric(10, 2) not null,
  created_at timestamptz not null default now()
);

alter table rental_expenses enable row level security;

create policy "members can read all rental expenses"
  on rental_expenses for select
  using (is_member() and has_permission('rentals'));

create policy "members can insert rental expenses"
  on rental_expenses for insert
  with check (is_member() and has_permission('rentals'));

create policy "members can update rental expenses"
  on rental_expenses for update
  using (is_member() and has_permission('rentals'));

create policy "members can delete rental expenses"
  on rental_expenses for delete
  using (is_member() and has_permission('rentals'));

-- Multiple milestones against the same accumulating savings (e.g. a
-- $20k short-term goal, then $75k for the actual down payment) rather
-- than one goal per company.
create table rental_savings_goal (
  id uuid primary key default gen_random_uuid(),
  company rental_company not null,
  label text not null,
  target_amount numeric(10, 2) not null,
  -- Plain manually-maintained running total, not derived from bookings —
  -- tried auto-computing this from booking revenue (twice: a raw
  -- cumulative sum, then a per-month approve/edit reconciliation flow)
  -- and both were more machinery than the two-person reality of "check
  -- the numbers, update the total" needed. Edited directly in the goal's
  -- own edit form.
  saved_amount numeric(10, 2) not null default 0,
  updated_at timestamptz not null default now()
);

alter table rental_savings_goal enable row level security;

create policy "members can read all rental savings goals"
  on rental_savings_goal for select
  using (is_member() and has_permission('rentals'));

create policy "members can insert rental savings goals"
  on rental_savings_goal for insert
  with check (is_member() and has_permission('rentals'));

create policy "members can update rental savings goals"
  on rental_savings_goal for update
  using (is_member() and has_permission('rentals'));

create policy "members can delete rental savings goals"
  on rental_savings_goal for delete
  using (is_member() and has_permission('rentals'));

-- Password vault(s), encrypted client-side (AES-GCM, key derived from a
-- master password via PBKDF2) before anything ever reaches Supabase. Was
-- a single global vault_meta row (literally enforced by a unique index on
-- a constant expression) until a second, healthcare-scoped vault was
-- needed, shared with a third member (a household VA) who shouldn't see
-- the original household vault's contents — a feature toggle or
-- client-side filter can't give that, since it wouldn't stop a member
-- who already has the *other* vault's master password from decrypting
-- entries they merely couldn't otherwise query. `vaults` is the real
-- separation: each row gets its own vault_meta (own salt/canary, so a
-- genuinely different master password), and vault_access (below) is who
-- even knows a given vault exists.
create table vaults (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Off (false) for the original household vault, preserving its
  -- existing "whoever has access sees and can edit every entry, no extra
  -- step" behavior exactly. On for the healthcare vault: an entry
  -- defaults to visible only to its creator, with an explicit per-entry
  -- share to specific other vault members (vault_entries.shared_with
  -- below) — same targeted-sharing shape cork_notes.shared_with already
  -- established, requested directly once a shared household vault's
  -- "everyone sees everything" model stopped fitting a vault meant to
  -- hold a VA's own working credentials too.
  private_entries boolean not null default false,
  created_at timestamptz not null default now()
);

-- Who can see a given vault exists, unlock it, and read/write its
-- entries — the real access boundary every policy below is keyed off of.
-- No client-facing write policy: granting/revoking vault access is
-- SQL-editor-only for now, same precedent is_admin promotion already
-- established for a privileged action with no admin UI built yet.
-- Declared before `vaults`' own policies since has_vault_access()
-- (below) already needs it to exist.
create table vault_access (
  vault_id uuid not null references vaults (id) on delete cascade,
  member_id uuid not null references members (id) on delete cascade,
  primary key (vault_id, member_id)
);

-- security definer, same reasoning is_member() already is — a plain
-- "exists (select 1 from vault_access where ...)" inline in vault_access's
-- own select policy would mean evaluating that table's RLS from within
-- itself. This bypasses RLS for the lookup instead of recursing into it,
-- same fix is_member() already applies to the equivalent members-table
-- problem.
create or replace function has_vault_access(check_vault_id uuid)
returns boolean as $$
  select exists (select 1 from vault_access where vault_id = check_vault_id and member_id = auth.uid());
$$ language sql security definer stable;

alter table vaults enable row level security;

create policy "members can read accessible vaults"
  on vaults for select
  using (is_member() and has_vault_access(id));

alter table vault_access enable row level security;

-- Any member with access to a vault can see the rest of that vault's
-- roster — needed so the healthcare vault's per-entry share picker can
-- list who else to share with, not just confirm your own row exists. Not
-- sensitive: knowing who else shares a vault with you isn't a secret,
-- same reasoning a shared cork_notes pin's targets are visible to each
-- other.
create policy "members can read their vault's access roster"
  on vault_access for select
  using (is_member() and has_vault_access(vault_id));

-- Salt for key derivation, plus a canary ciphertext that lets a later
-- unlock attempt verify the master password before any real entry exists
-- to test against — one row per vault now, not one globally. Delete
-- policy exists for the forgot-password reset flow (there is no recovery
-- path by design, so resetting is the only way out of a forgotten master
-- password).
create table vault_meta (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references vaults (id) on delete cascade,
  salt text not null,
  canary_ciphertext text not null,
  canary_iv text not null,
  created_at timestamptz not null default now()
);

-- Enforces "at most one row per vault" at the database level — the same
-- race this index always guarded against (two people opening a
-- never-set-up vault at once and both submitting "Set up vault"), just
-- scoped per vault_id instead of globally now.
create unique index vault_meta_vault_id_unique on vault_meta (vault_id);

alter table vault_meta enable row level security;

create policy "members can read vault meta"
  on vault_meta for select
  using (is_member() and has_vault_access(vault_id));

create policy "members can insert vault meta"
  on vault_meta for insert
  with check (is_member() and has_vault_access(vault_id));

create policy "members can delete vault meta"
  on vault_meta for delete
  using (is_member() and has_vault_access(vault_id));

-- One row per credential. `ciphertext` decrypts (with the vault key) to
-- one JSON blob `{ label, username, loginMethod, password, url, notes }`
-- (loginMethod is set instead of password for accounts with no password
-- of their own, e.g. "Sign in with Google") — the label is encrypted too,
-- not just the password, since even knowing an entry called "Chase Bank"
-- exists is sensitive metadata worth not leaking to anyone with database
-- access. `shared_with` only means anything when the owning vault has
-- `private_entries` — see the policies below.
create table vault_entries (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references vaults (id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  shared_with uuid[] not null default '{}'::uuid[],
  created_by uuid not null references members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Whether vault_id's own private_entries flag is set — wrapped the same
-- way has_vault_access() wraps the vault_access lookup, purely for
-- readability in the policies below (vaults has no RLS-recursion problem
-- of its own here, this is just avoiding repeating the same subquery four
-- times).
create or replace function vault_has_private_entries(check_vault_id uuid)
returns boolean as $$
  select coalesce((select private_entries from vaults where id = check_vault_id), false);
$$ language sql stable;

alter table vault_entries enable row level security;

-- Every policy below shares the same "vault access, and (not a private
-- vault, or you're the creator/a target)" shape. A vault with
-- private_entries = false (none, currently — every vault in this app is
-- private_entries = true as of the "Collapse healthcare vault back into
-- one shared vault" incremental migration below) would never evaluate
-- the last clause, leaving every accessible-vault member seeing/editing
-- every entry; private_entries = true instead makes it genuinely
-- creator-or-shared-with for reading, creator-only for writing —
-- matching cork_notes' own "the other member can see it, not manage it"
-- rule, since sharing a credential is meant to grant visibility, not
-- co-ownership. Kept as a per-vault flag, not hardcoded true, since a
-- future vault with a reason to default back to fully-mutual (no
-- sharing step at all) is still a one-row change away.
create policy "members can read accessible vault entries"
  on vault_entries for select
  using (
    is_member()
    and has_vault_access(vault_id)
    and (not vault_has_private_entries(vault_id) or created_by = auth.uid() or auth.uid() = any(shared_with))
  );

create policy "members can insert vault entries"
  on vault_entries for insert
  with check (is_member() and has_vault_access(vault_id) and created_by = auth.uid());

create policy "members can update vault entries"
  on vault_entries for update
  using (
    is_member()
    and has_vault_access(vault_id)
    and (not vault_has_private_entries(vault_id) or created_by = auth.uid())
  );

create policy "members can delete vault entries"
  on vault_entries for delete
  using (
    is_member()
    and has_vault_access(vault_id)
    and (not vault_has_private_entries(vault_id) or created_by = auth.uid())
  );

-- Cork Board: quick pins with no due date, no timeline — the opposite of
-- a task, which is deliberately scheduled. This is the one place in the
-- app where visibility is NOT automatically mutual: `shared_with` decides
-- whether another member can see a given pin at all, not just whether
-- they can edit it, so the select policy (not just insert/update/delete)
-- checks it. Only the author can edit or delete their own pin, even once
-- shared — a targeted member can see it, not manage it.
--
-- A per-member array, not a boolean — a plain `shared boolean` (this
-- table's original shape, from the original 2-person app) meant "visible
-- to literally every member," which stopped being the right default once
-- task_access made targeted, asymmetric visibility a real concept
-- elsewhere in this schema. Sharing a pin "with the team" now means
-- picking who, same as everything else N-member-aware in this app —
-- there's no "shared with everyone" sentinel; the compose form fills
-- shared_with with every other member's id when that's genuinely what's
-- wanted, so a pin's visibility is always an explicit, inspectable list
-- rather than an implicit "current membership" lookup that would
-- silently widen as new members join.
create table cork_notes (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references members (id),
  body text not null,
  shared_with uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  -- Flat, append-only thread — { id, authorId, body, createdAt } — no
  -- reply-to-reply nesting, same "doesn't need a child table" reasoning
  -- as tasks.clarifications/checklist. Written via add_cork_note_comment()
  -- below rather than a plain update(), since the update RLS policy is
  -- author-only (see below) and a comment needs to come from *either*
  -- member on a shared pin.
  comments jsonb not null default '[]'::jsonb,
  -- Soft-disable, not delete — same reasoning rental_properties.
  -- in_negotiation/archive_property and work_sites.active already
  -- establish elsewhere in this schema. "Unpin" used to be the only way
  -- to get a finished pin off the board, and that meant a real delete —
  -- this gives archiving (reversible, still visible in its own
  -- collapsed section) as the everyday action instead, with delete kept
  -- around as a further, still-available step once a pin is archived.
  -- Goes through the plain author-only update policy below, same as
  -- editing/sharing a pin — archiving isn't a mutual action any more
  -- than those are.
  archived boolean not null default false
);

alter table cork_notes enable row level security;

create policy "members can read own or shared cork notes"
  on cork_notes for select
  using (is_member() and (auth.uid() = any(shared_with) or author_id = auth.uid()));

create policy "members can insert own cork notes"
  on cork_notes for insert
  with check (is_member() and author_id = auth.uid());

create policy "members can update own cork notes"
  on cork_notes for update
  using (is_member() and author_id = auth.uid());

create policy "members can delete own cork notes"
  on cork_notes for delete
  using (is_member() and author_id = auth.uid());

-- Appends one comment to a note's thread. security definer so it can
-- write to a row the caller doesn't own (the plain update RLS policy
-- above is author-only, deliberately, so it can't be reused here) — the
-- visibility check inline below re-implements the select policy's own
-- rule (own or targeted) so a member still can't comment on a pin they
-- can't see. Only ever touches the comments column, never body/shared_with,
-- so this can't be used to work around the author-only edit restriction.
create or replace function add_cork_note_comment(p_note_id uuid, p_body text)
returns cork_notes
language plpgsql
security definer
set search_path = public
as $$
declare
  result cork_notes;
begin
  if not is_member() then
    raise exception 'not a member';
  end if;

  update cork_notes
  set comments = comments || jsonb_build_object(
    'id', gen_random_uuid(),
    'authorId', auth.uid(),
    'body', p_body,
    'createdAt', now()
  )
  where id = p_note_id
    and (auth.uid() = any(shared_with) or author_id = auth.uid())
  returning * into result;

  if result.id is null then
    raise exception 'note not found or not visible';
  end if;

  return result;
end;
$$;

grant execute on function add_cork_note_comment(uuid, text) to authenticated;

-- ============================================================
-- Staff time tracking (property manager / house-manager role)
-- ============================================================
-- Deliberately NOT a third `members` row — is_member() grants full
-- mutual access to tasks/rentals/vault/everything, which this role
-- must not have. Instead: its own narrowly-scoped table, its own
-- is_staff() existence check (mirroring is_member()'s shape), and its
-- own RLS on the two tables below. No existing table's RLS changes.
--
-- DEPLOYMENT NOTE: this whole block is additive. On an existing live
-- project, paste and run only this block in the Supabase SQL editor —
-- do not re-run the full schema.sql file (it has no "if not exists"
-- guards anywhere and will fail immediately on `create table members`).
-- After running it, also run once, by hand:
--   alter publication supabase_realtime add table time_entries;
-- (needed for the admin dashboard's live updates — see TaskBoard.jsx's
-- staff tab / StaffLogsView.jsx). `staff` still doesn't need this — it
-- only ever changes via a member's own edit in this same dashboard, so
-- an explicit reload right after that edit (the same pattern
-- archiveRentalProperty already uses) is enough. `work_sites` used to
-- fall under that same reasoning until the on-site capture/approval
-- migration below gave staff their own independent write path onto it
-- (staff_submit_location_capture()) — see that migration's own
-- publication note for why it needs the same live-update treatment as
-- time_entries now.

create type staff_rate_type as enum ('standard', 'emergency');
create type time_entry_status as enum ('pending', 'approved');

-- Mirrors members' shape (id -> auth.users, display_name) but is its
-- own table — populate manually after inviting the account via
-- Supabase Auth, same as members itself.
create table staff (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  hourly_rate numeric(10, 2) not null default 20,
  -- Nullable: not every role works emergency shifts (e.g. a cleaner vs.
  -- an on-call maintenance manager), so null means "this role has no
  -- emergency rate" rather than a placeholder number nobody meant to set.
  -- stamp_time_entry_meta() below refuses a clock-in at the emergency
  -- rate for a staff row where this is null.
  emergency_rate numeric(10, 2),
  -- Free text, shown to the property manager themselves in
  -- StaffClockView.jsx and editable by a member in StaffProfileForm.jsx —
  -- what the role actually covers, since neither side had anywhere to
  -- write that down before.
  job_description text,
  -- Soft-disable rather than delete: keeps time_entries history intact
  -- if a property manager leaves. is_staff() below checks this, so
  -- deactivating someone revokes clock-in/work-site access immediately.
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table staff enable row level security;

-- security definer, same recursion-avoidance reasoning as is_member().
-- Checks `active` (unlike is_member(), which has no such flag on
-- members) — a deactivated property manager loses access immediately,
-- not just stops being invited to shifts.
create or replace function is_staff()
returns boolean as $$
  select exists (select 1 from staff where id = auth.uid() and active);
$$ language sql security definer stable;

-- Two SELECT policies (Postgres OR's permissive policies together):
-- members see the whole roster (for the admin dashboard's staff-name
-- join and rate display); a staff account can always read its OWN row
-- regardless of `active` — deliberately NOT gated through is_staff(),
-- so a deactivated account gets a clear "you're deactivated" state
-- client-side instead of an ambiguous RLS-denied empty result.
create policy "members can read all staff"
  on staff for select
  using (is_member() and has_permission('staff'));

create policy "staff can read own row"
  on staff for select
  using (id = auth.uid());

create policy "members can insert staff"
  on staff for insert
  with check (is_member() and has_permission('staff'));

create policy "members can update staff"
  on staff for update
  using (is_member() and has_permission('staff'))
  with check (is_member() and has_permission('staff'));

-- Known clock-in locations: existing Awa Rentalz units
-- (rental_property_id set) plus other non-rental properties in the
-- area (rental_property_id null). No lat/lng exists anywhere else in
-- this schema (rental_properties.address is free text) — this is the
-- first structured-geo table in the app.
create table work_sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  latitude double precision not null,
  longitude double precision not null,
  -- Per-site radius, not a global constant — a multi-unit building's
  -- footprint is bigger than a single house's.
  geofence_radius_m integer not null default 100,
  -- Nullable, optional link back to an existing Awa Rentalz unit — a
  -- work_site is its own row either way (rental_properties has no
  -- lat/lng to add without a separate migration, and not every
  -- work_site is a rental unit at all).
  rental_property_id uuid references rental_properties (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table work_sites enable row level security;

create policy "members can read all work sites"
  on work_sites for select
  using (is_member() and has_permission('staff'));

-- Staff only ever needs active sites to clock in at — an archived
-- site shouldn't appear in their nearest-site picker.
create policy "staff can read active work sites"
  on work_sites for select
  using (is_staff() and active);

create policy "members can insert work sites"
  on work_sites for insert
  with check (is_member() and has_permission('staff'));

create policy "members can update work sites"
  on work_sites for update
  using (is_member() and has_permission('staff'))
  with check (is_member() and has_permission('staff'));

create policy "members can delete work sites"
  on work_sites for delete
  using (is_member() and has_permission('staff'));

-- Haversine great-circle distance in meters. Kept as its own small SQL
-- function (not inlined into the trigger below) so it's independently
-- testable via `select haversine_distance_m(...)` in the SQL editor.
create or replace function haversine_distance_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision as $$
  select 2 * 6371000 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2
  ));
$$ language sql immutable;

create table time_entries (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff (id) on delete cascade,
  work_site_id uuid not null references work_sites (id),
  rate_type staff_rate_type not null default 'standard',
  -- Stamped server-side by the trigger below from staff.hourly_rate/
  -- emergency_rate AT THE MOMENT OF CLOCK-IN — never read live off
  -- `staff` at query time. Deliberate: if hourly_rate is later edited,
  -- past entries must not silently reprice. Also closes a tampering
  -- vector — a raw client insert can't set its own rate.
  rate_amount numeric(10, 2),
  clock_in_at timestamptz not null default now(),
  clock_in_lat double precision not null,
  clock_in_lng double precision not null,
  clock_in_accuracy_m numeric,
  -- Both stamped server-side by the trigger below, from the STORED
  -- clock_in_lat/lng vs. the work site's lat/lng — recomputed
  -- server-side (not trusted from the client) so the flag Ada/Aaron
  -- see on the admin dashboard can never be spoofed independently of
  -- the coordinates sitting right next to it. This doesn't make the
  -- underlying GPS reading itself any more trustworthy (an inherent
  -- limit of browser geolocation either way) — it only guarantees the
  -- flag is always internally consistent with the stored coordinates.
  distance_from_site_m numeric,
  flagged boolean not null default false,
  clock_out_at timestamptz,
  clock_out_lat double precision,
  clock_out_lng double precision,
  status time_entry_status not null default 'pending',
  approved_by uuid references members (id),
  approved_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

-- Prevents a double clock-in (a lost/duplicate Start tap, or two tabs)
-- from creating two simultaneously "active" (not-yet-clocked-out)
-- entries for the same staff member — same "enforce the business rule
-- as a unique index" idiom as eod_reports_unique_bucket elsewhere in
-- this file.
create unique index time_entries_one_active_per_staff
  on time_entries (staff_id)
  where clock_out_at is null;

create index time_entries_staff_id_idx on time_entries (staff_id);
create index time_entries_work_site_id_idx on time_entries (work_site_id);
create index time_entries_status_idx on time_entries (status);
create index time_entries_clock_in_at_idx on time_entries (clock_in_at);

-- security definer so the rate/geofence stamping is authoritative
-- regardless of any RLS nuance on staff/work_sites, and so a client
-- insert can never supply its own rate_amount/distance_from_site_m/
-- flagged — those three columns are effectively read-only from the
-- client's perspective even though no column-level privilege blocks
-- writing them; this trigger unconditionally overwrites whatever was
-- submitted.
create or replace function stamp_time_entry_meta()
returns trigger as $$
declare
  v_site work_sites;
  v_staff staff;
begin
  select * into v_site from work_sites where id = new.work_site_id;
  if v_site.id is null then
    raise exception 'work site not found';
  end if;

  select * into v_staff from staff where id = new.staff_id;
  if v_staff.id is null then
    raise exception 'staff not found';
  end if;

  new.rate_amount := case new.rate_type
    when 'emergency' then v_staff.emergency_rate
    else v_staff.hourly_rate
  end;

  new.distance_from_site_m := haversine_distance_m(
    new.clock_in_lat, new.clock_in_lng, v_site.latitude, v_site.longitude
  );
  new.flagged := new.distance_from_site_m > v_site.geofence_radius_m;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- Multiple tenants per rental booking (incremental migration)
-- ---------------------------------------------------------------------------
-- Run once on projects that already have rental_bookings. guest_name stays
-- as a joined display/compatibility value for older clients; guest_names is
-- the structured source used by the current Add/Edit booking form.

alter table rental_bookings
  add column if not exists guest_names text[] not null default '{}';

update rental_bookings
set guest_names = array[guest_name]
where cardinality(guest_names) = 0;

create trigger time_entries_stamp_meta
  before insert on time_entries
  for each row execute function stamp_time_entry_meta();

alter table time_entries enable row level security;

create policy "members and own staff can read time entries"
  on time_entries for select
  using ((is_member() and has_permission('staff')) or staff_id = auth.uid());

create policy "staff can clock in"
  on time_entries for insert
  with check (staff_id = auth.uid() and is_staff());

-- No UPDATE policy for staff at all — clock-out goes exclusively
-- through staff_clock_out() below. A raw UPDATE grant to staff would
-- let them rewrite status/approved_by/rate_type after the fact; this
-- way that's structurally impossible, not just discouraged by the UI.
create policy "members can update time entries"
  on time_entries for update
  using (is_member() and has_permission('staff'))
  with check (is_member() and has_permission('staff'));

-- The one RPC a staff account gets, mirroring add_cork_note_comment()'s
-- shape above: security definer, re-checks ownership inline, and only
-- ever touches the three clock-out columns — never status, approved_by,
-- rate_type, or rate_amount. Returns the updated row directly in the
-- RPC response, so the client updates its own state straight from this
-- call's result rather than needing a follow-up select. p_lat/p_lng
-- are nullable and default null — a flaky GPS signal at the END of a
-- shift shouldn't trap someone unable to clock out (unlike clock-in,
-- where lat/lng is mandatory).
create or replace function staff_clock_out(
  p_entry_id uuid,
  p_lat double precision default null,
  p_lng double precision default null
)
returns time_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  result time_entries;
begin
  if not is_staff() then
    raise exception 'not an active staff member';
  end if;

  update time_entries
  set clock_out_at = now(),
      clock_out_lat = p_lat,
      clock_out_lng = p_lng
  where id = p_entry_id
    and staff_id = auth.uid()
    and clock_out_at is null
  returning * into result;

  if result.id is null then
    raise exception 'time entry not found, not yours, or already clocked out';
  end if;

  return result;
end;
$$;

grant execute on function staff_clock_out(uuid, double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------------
-- Physical staff locations (incremental migration)
-- ---------------------------------------------------------------------------
-- Run this block once after the original staff schema on an existing project.
-- A work_site is now one physical place (Rachel, Parkside, a future
-- acquisition), not one rental unit. Many rental_properties may point to
-- the same work_site; the staff member clocks into the place, while units are
-- only context for Ada/Aaron. Coordinates become nullable so a location group
-- can be created before address lookup/on-site GPS is approved. Such a row is
-- inserted with active=false and therefore stays invisible to staff until its
-- clock-in point is ready.

alter table work_sites alter column latitude drop not null;
alter table work_sites alter column longitude drop not null;

alter table rental_properties
  add column work_site_id uuid references work_sites (id) on delete set null;

create index rental_properties_work_site_id_idx on rental_properties (work_site_id);

-- Preserve any one-unit links created by the first staff implementation.
-- They can then be regrouped into Rachel/Parkside from the member UI.
update rental_properties rp
set work_site_id = ws.id
from work_sites ws
where ws.rental_property_id = rp.id
  and rp.work_site_id is null;

-- Defensive trust-boundary update: even if a client guesses the UUID of an
-- inactive/unconfigured location and attempts a raw insert, clock-in fails
-- before distance calculation rather than producing a null flag or accepting
-- a place that staff should not be able to use.
create or replace function stamp_time_entry_meta()
returns trigger as $$
declare
  v_site work_sites;
  v_staff staff;
begin
  select * into v_site from work_sites where id = new.work_site_id;
  if v_site.id is null then
    raise exception 'work site not found';
  end if;
  if not v_site.active or v_site.latitude is null or v_site.longitude is null then
    raise exception 'work site is not ready for clock-in';
  end if;

  select * into v_staff from staff where id = new.staff_id;
  if v_staff.id is null then
    raise exception 'staff not found';
  end if;
  if new.rate_type = 'emergency' and v_staff.emergency_rate is null then
    raise exception 'this role has no emergency rate';
  end if;

  new.rate_amount := case new.rate_type
    when 'emergency' then v_staff.emergency_rate
    else v_staff.hourly_rate
  end;

  new.distance_from_site_m := haversine_distance_m(
    new.clock_in_lat, new.clock_in_lng, v_site.latitude, v_site.longitude
  );
  new.flagged := new.distance_from_site_m > v_site.geofence_radius_m;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- On-site location capture with member approval (incremental migration)
-- ---------------------------------------------------------------------------
-- Run this block once after the "Physical staff locations" block above, on an
-- existing project. Lets the on-site property manager propose a GPS point for
-- a work_site address lookup couldn't place accurately, without ever granting
-- staff write access to work_sites itself — the same RPC-only discipline
-- staff_clock_out() already established above. Five flat columns, not a
-- child table: a work_site has at most one live geofence point regardless of
-- how many capture attempts led to it, so a second capture before approval
-- simply overwrites the first (self-correcting a bad tap) rather than
-- needing a proposal history to reconcile — the same "pending state on the
-- row itself" shape rental_bookings.status and time_entries.status already
-- use elsewhere in this file.

alter table work_sites
  add column pending_latitude double precision,
  add column pending_longitude double precision,
  add column pending_accuracy_m numeric,
  add column pending_captured_by uuid references staff (id),
  add column pending_captured_at timestamptz;

-- Third SELECT policy on work_sites (Postgres OR's permissive policies
-- together — see "staff can read active work sites" above). Deliberately
-- scoped to "never configured yet" only (active = false AND both real
-- coordinates still null) — an archived site that used to be ready
-- (active = false WITH real coordinates) must stay invisible to staff,
-- unchanged from before this migration. A site with a pending capture still
-- matches this policy (active is still false, latitude/longitude are still
-- null — only pending_* is set), so staff keeps seeing it as "awaiting
-- approval" rather than the row vanishing after they submit a capture.
create policy "staff can read needs-setup work sites"
  on work_sites for select
  using (is_staff() and not active and latitude is null and longitude is null);

-- The one write path staff gets on work_sites, mirroring staff_clock_out()'s
-- shape exactly: security definer, re-checks is_staff() and re-checks the
-- site is still unconfigured inline (never trusts the client's premise), and
-- only ever touches the four pending_* columns — never latitude, longitude,
-- or active. A second call before approval is allowed on purpose and simply
-- overwrites the previous attempt (see migration comment above).
create or replace function staff_submit_location_capture(
  p_work_site_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m numeric default null
)
returns work_sites
language plpgsql
security definer
set search_path = public
as $$
declare
  result work_sites;
begin
  if not is_staff() then
    raise exception 'not an active staff member';
  end if;

  update work_sites
  set pending_latitude = p_lat,
      pending_longitude = p_lng,
      pending_accuracy_m = p_accuracy_m,
      pending_captured_by = auth.uid(),
      pending_captured_at = now()
  where id = p_work_site_id
    and not active
    and latitude is null
    and longitude is null
  returning * into result;

  if result.id is null then
    raise exception 'work site not found or already configured';
  end if;

  return result;
end;
$$;

grant execute on function staff_submit_location_capture(uuid, double precision, double precision, numeric) to authenticated;

-- Approve/reject deliberately get no RPC — members already hold unrestricted
-- update RLS on work_sites ("members can update work sites" above), the same
-- reason approveTimeEntry() in src/lib/staff.js is a plain client update on
-- time_entries rather than an RPC. The RPC-only discipline above exists
-- specifically for the staff write path, where the RLS gap is real; there's
-- no equivalent gap on the member side to work around here.

-- Run once, by hand, same as time_entries above:
--   alter publication supabase_realtime add table work_sites;
-- Real bug found via a live report ("the location the property manager
-- captured never shows as pending on our side"): staff_submit_location_
-- capture() is a write to work_sites that happens entirely outside any
-- member action, so the "explicit reload after an admin edit is enough"
-- reasoning the original staff/work_sites deployment note relied on no
-- longer holds for this table specifically — a member sitting on an
-- already-open Staff tab had no signal that a capture had landed, and
-- StaffLogsView.jsx only ever fetched work_sites once, on mount.

-- ---------------------------------------------------------------------------
-- Staff payroll cadence (incremental migration)
-- ---------------------------------------------------------------------------
-- Run this block once on an existing project, after every earlier staff
-- block above it.

-- A distinct enum from report_period (eod_reports) on purpose: that one is
-- an ad-hoc reporting bucket Ada/Aaron pick per-submission, while this is a
-- fixed, recurring attribute of one staff member's actual pay arrangement.
create type staff_payroll_cadence as enum ('weekly', 'biweekly', 'twice_monthly', 'monthly');

-- Lives on staff, not members — this is this specific property manager's
-- own pay arrangement, same reasoning hourly_rate/emergency_rate already
-- live here. Default 'biweekly' matches the household's actual current
-- arrangement (the same real cutoff BIWEEKLY_ANCHOR in src/lib/tasks.js
-- already encodes).
alter table staff
  add column payroll_cadence staff_payroll_cadence not null default 'biweekly';

-- ---------------------------------------------------------------------------
-- Manual time entries and correction requests (incremental migration)
-- ---------------------------------------------------------------------------
-- Run this block once on an existing project, after every earlier staff
-- block above it. Two related gaps closed together: members had no way to
-- correct a shift's clock-in/out times (or add one that was never logged at
-- all — clock-in was staff-only INSERT), and the property manager had no
-- way to flag either problem short of a side-channel message outside the
-- app.

-- Members previously had zero INSERT access to time_entries — only staff
-- could ("staff can clock in" above). This lets a member add a shift by
-- hand (e.g. one the property manager forgot to clock in for entirely).
-- stamp_time_entry_meta() (schema.sql, earlier) still runs regardless of who
-- inserts — it stamps rate_amount from staff.hourly_rate/emergency_rate the
-- same way either path, and still requires clock_in_lat/lng not null, so a
-- manual entry supplies the work site's own stored coordinates rather than
-- leaving them blank (see createManualTimeEntry() in src/lib/staff.js) —
-- there's no real GPS reading to attach to a shift nobody clocked into live,
-- and reusing the site's own point keeps distance_from_site_m/flagged
-- meaningful (0m, not flagged) instead of nonsensical for a fabricated
-- reading.
create policy "members can insert time entries"
  on time_entries for insert
  with check (is_member() and has_permission('staff'));

-- A member editing clock_in_at/clock_out_at is already covered by the
-- existing "members can update time entries" UPDATE policy above — no new
-- policy needed for that; src/lib/staff.js's updateTimeEntryTimes() is just
-- a new plain client update through it, same as approveTimeEntry()/
-- forceClockOutEntry() already are.

create type time_entry_request_status as enum ('open', 'resolved');

-- The request/notification trail, not the fix itself — a member still makes
-- the actual correction by hand (editing or inserting a real time_entries
-- row, both already covered above). Deliberately its own table rather than
-- a jsonb column on time_entries, unlike checklist/clarifications
-- elsewhere in this schema: those always have exactly one natural parent
-- row to live on, but a request about a shift that was never logged at all
-- has no time_entries row to attach to yet, so time_entry_id is nullable
-- rather than required.
create table time_entry_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff (id) on delete cascade,
  time_entry_id uuid references time_entries (id) on delete set null,
  -- Free text, not structured date/time fields — staff still can't write
  -- time_entries directly either way, so this is just context for whichever
  -- member makes the real correction, same "describe it, don't try to
  -- pre-structure it" reasoning cork_notes' comments already use.
  note text not null,
  status time_entry_request_status not null default 'open',
  resolved_by uuid references members (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index time_entry_requests_staff_id_idx on time_entry_requests (staff_id);
create index time_entry_requests_status_idx on time_entry_requests (status);

alter table time_entry_requests enable row level security;

create policy "members can read time entry requests"
  on time_entry_requests for select
  using (is_member() and has_permission('staff'));

create policy "members can update time entry requests"
  on time_entry_requests for update
  using (is_member() and has_permission('staff'))
  with check (is_member() and has_permission('staff'));

-- Staff can read and submit their own requests, never anyone else's, and
-- never resolve one themselves — there's no staff UPDATE policy on this
-- table at all, same RPC-only-elsewhere discipline time_entries/work_sites
-- already established, just satisfied here by "no write path exists" rather
-- than an RPC, since a plain INSERT of staff's own new row needs no
-- security-definer trust boundary to cross the way an UPDATE onto an
-- existing row (staff_clock_out(), staff_submit_location_capture()) did.
create policy "staff can read own time entry requests"
  on time_entry_requests for select
  using (staff_id = auth.uid());

create policy "staff can submit time entry requests"
  on time_entry_requests for insert
  with check (staff_id = auth.uid() and is_staff());

-- Run once, by hand, same as time_entries/work_sites above:
--   alter publication supabase_realtime add table time_entry_requests;
-- Learned from the work_sites live-update gap just above — building the
-- Realtime channel for both directions (StaffLogsView.jsx and
-- StaffClockView.jsx) from the start this time, not after a live report.

-- ---------------------------------------------------------------------------
-- Time entry deletion (incremental migration)
-- ---------------------------------------------------------------------------
-- Run this block once on an existing project, after the "Manual time
-- entries and correction requests" block above. Reported directly right
-- after that one shipped: a duplicate entry, a bogus manual add, or a
-- mistaken clock-in had no way to actually go away — approve/force-clock-
-- out/edit all mutate a row, nothing removes one. Members already hold
-- unrestricted SELECT/INSERT/UPDATE on time_entries; this is the one
-- missing verb, granted the same unconditional way as the others rather
-- than restricted to only-unapproved or only-own-created rows — the same
-- "mutual visibility, no per-row ownership" reasoning every other table in
-- this app already follows, and consistent with force-clock-out/approve
-- already being equally unrestricted, irreversible actions gated by a
-- plain confirm() on the client rather than a database-level restriction.
create policy "members can delete time entries"
  on time_entries for delete
  using (is_member() and has_permission('staff'));

-- ---------------------------------------------------------------------------
-- Shift reports and break/geofence-exit clock-out flow (incremental migration)
-- ---------------------------------------------------------------------------
-- Run this block once on an existing project, after every earlier staff
-- block above it. Requested directly: stopping the clock should offer a
-- choice between taking a break and actually ending the shift, a real
-- clock-out should be able to carry a report of what got done that
-- reaches Ada/Aaron, that report should be addable/editable later too (not
-- a one-shot prompt only at the exact moment of stopping), and Ada/Aaron
-- should be able to ask for one if it's missing. "Break" needs no schema
-- change at all — by product decision it's just an ordinary clock-out
-- followed by an ordinary clock-in later, tagged with a note so the gap in
-- the day reads as deliberate rather than unexplained; see
-- StaffClockView.jsx. Geofence-exit detection is entirely client-side
-- (continuous watchPosition against the active entry's own site while
-- clocked in) and only ever prompts, never auto-acts, so it needs no
-- server-side representation either — see that same file.

-- Lets a member flag "I want to know what happened on this shift" —
-- report_requested_by is nullable (not every request needs attribution
-- shown, but recorded anyway for the same reason approved_by/resolved_by
-- already are elsewhere in this schema) and both columns are plain member
-- UPDATE, already covered by the existing unrestricted "members can update
-- time entries" policy — no new RLS needed for the asking side.
alter table time_entries
  add column report_requested_at timestamptz,
  add column report_requested_by uuid references members (id);

-- The one write path staff gets for a shift's own report — mirrors
-- staff_clock_out()'s shape exactly: security definer, re-checks
-- staff_id = auth.uid() inline, and only ever touches notes (appending,
-- not overwriting — same "old body + a new --- separated chunk" pattern
-- upsert_eod_report() already uses, so a report added after the fact
-- doesn't erase whatever was captured at clock-in or an earlier report
-- submission) and report_requested_at (cleared unconditionally, so
-- answering a request — however it's answered — closes the loop; a
-- report submitted with nothing pending simply clears a column that was
-- already null). Deliberately not folded into staff_clock_out() itself:
-- a report needs to be addable long after a shift has already ended, not
-- only in the same breath as clocking out, so it has to be its own call
-- either way — reusing that same call for both moments avoids a second,
-- clock-out-only code path with slightly different rules.
create or replace function staff_submit_shift_report(
  p_entry_id uuid,
  p_note text
)
returns time_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  result time_entries;
begin
  if not is_staff() then
    raise exception 'not an active staff member';
  end if;

  update time_entries
  set notes = case
        when notes is null or notes = '' then p_note
        else notes || E'\n---\n' || p_note
      end,
      report_requested_at = null
  where id = p_entry_id
    and staff_id = auth.uid()
  returning * into result;

  if result.id is null then
    raise exception 'time entry not found or not yours';
  end if;

  return result;
end;
$$;

grant execute on function staff_submit_shift_report(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Archived tasks (incremental migration)
-- ---------------------------------------------------------------------------
-- Run this block once on an existing project. A reversible "not doing this,
-- but keep the record" state for a task — distinct from marking it done
-- (dishonest for something that was never actually completed) and from
-- deleting it (loses the record) — same "soft-disable, not delete"
-- reasoning cork_notes.archived/rental_properties.active/work_sites.active
-- already establish elsewhere in this schema. No RLS change needed —
-- already covered by the existing unrestricted is_member() policies on
-- tasks. Built for the Overdue pill's bulk-select flow (TaskBoard.jsx) —
-- see that feature for the client-side filtering this actually needs
-- (getOverdueTasks()/getTasksForDay()/groupTasksByDay() in tasks.js all
-- now exclude archived tasks, so an archived task disappears from every
-- planner view, not just Overdue).
alter table tasks add column archived boolean not null default false;

-- ---------------------------------------------------------------------------
-- Optional emergency rate + job description for staff (incremental migration)
-- ---------------------------------------------------------------------------
-- Run this block once on an existing project, after every earlier staff
-- block above it. Two independent, unrelated changes bundled together only
-- because they were requested in the same pass:
--
-- 1. emergency_rate becomes nullable, no default — not every property-
--    manager role actually works emergency shifts, and a nonzero rate that
--    nobody meant to set is worse than an explicit "this role doesn't have
--    one." StaffProfileForm.jsx exposes this as an on/off toggle around the
--    Emergency rate field; StaffClockView.jsx's/StaffTimeEntryForm.jsx's own
--    Standard/Emergency picker only shows the Emergency option when
--    profile.emergency_rate/selectedStaff.emergency_rate is not null.
--    stamp_time_entry_meta() (redefined below, same body as the version
--    above plus one new guard) refuses an 'emergency' clock-in server-side
--    when the staff row's emergency_rate is null — belt-and-suspenders
--    against a raw insert bypassing the UI's own gating.
-- 2. job_description, a free-text field with nowhere to live before this —
--    set by a member in StaffProfileForm.jsx, shown read-only to the
--    property manager themselves in StaffClockView.jsx.
alter table staff alter column emergency_rate drop not null;
alter table staff alter column emergency_rate drop default;
alter table staff add column job_description text;

-- ---------------------------------------------------------------------------
-- Short/midterm vs. long-term rentals (incremental migration)
-- ---------------------------------------------------------------------------
-- Run this block once on an existing project. Requested directly: a
-- long-term unit's rent is fixed for the life of the lease and doesn't need
-- the same day-to-day vacancy monitoring a short/midterm room does, so it
-- shouldn't share that room's calendar-first dashboard — see
-- RentalsView.jsx's Short/Midterm-vs-Long-Term pill toggle (default:
-- Short/Midterm) and the new RentalLongTermView.jsx. rental_bookings has no
-- company column of its own (it inherits company through property_id), and
-- the same is true here — term lives on rental_properties only, and every
-- booking for that unit is scoped by it automatically.
create type rental_term as enum ('short_midterm', 'long_term');

alter table rental_properties add column term rental_term not null default 'short_midterm';

-- Findlay is the one unit that prompted this feature — a fixed-rent,
-- year-long lease with known, static income, unlike the four short/midterm
-- rooms it used to sit alongside in one dashboard.
update rental_properties set term = 'long_term' where unit_name = '937 Findlay';

-- Long-term lease reminders (notify-reminders) — both one-shot, same
-- reasoning rent_reminder_sent_for already establishes, but a timestamp
-- rather than a date since each fires exactly once per booking, not once
-- per cycle the way a recurring monthly charge reminder does.
alter table rental_bookings add column last_month_reminder_sent_at timestamptz;
alter table rental_bookings add column turnover_reminder_sent_at timestamptz;

create or replace function stamp_time_entry_meta()
returns trigger as $$
declare
  v_site work_sites;
  v_staff staff;
begin
  select * into v_site from work_sites where id = new.work_site_id;
  if v_site.id is null then
    raise exception 'work site not found';
  end if;
  if not v_site.active or v_site.latitude is null or v_site.longitude is null then
    raise exception 'work site is not ready for clock-in';
  end if;

  select * into v_staff from staff where id = new.staff_id;
  if v_staff.id is null then
    raise exception 'staff not found';
  end if;
  if new.rate_type = 'emergency' and v_staff.emergency_rate is null then
    raise exception 'this role has no emergency rate';
  end if;

  new.rate_amount := case new.rate_type
    when 'emergency' then v_staff.emergency_rate
    else v_staff.hourly_rate
  end;

  new.distance_from_site_m := haversine_distance_m(
    new.clock_in_lat, new.clock_in_lng, v_site.latitude, v_site.longitude
  );
  new.flagged := new.distance_from_site_m > v_site.geofence_radius_m;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- Archive a task to the board (incremental migration)
-- ---------------------------------------------------------------------------
-- Run this block once on an existing project. Requested directly — closes
-- the exact gap tasks.archived's own migration comment flagged when it
-- shipped ("no view/restore archived tasks UI built alongside this... so
-- undoing an archive today means a direct database edit"). Rather than
-- building a separate "Archived tasks" screen, an archived task now also
-- gets a linked pin on the existing Cork Board, which already has a
-- discoverable list, a shared/private toggle, and its own archive/
-- unarchive mechanism — reusing all of it instead of a parallel one.
--
-- Nullable, not required — an ordinary pin (the overwhelming majority)
-- has no task behind it at all. on delete set null rather than cascade:
-- if the linked task is later hard-deleted outright (not just archived),
-- the pin should degrade into a plain note rather than vanishing with it
-- — it may still carry a comment thread or other context worth keeping.
-- No RLS change needed — already covered by cork_notes' existing
-- policies, same reasoning every other additive column on this table
-- needed none either.
alter table cork_notes add column archived_task_id uuid references tasks (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Roadmap pins (incremental migration)
-- ---------------------------------------------------------------------------
-- Run this block once on an existing project. Requested directly: pasting a
-- multi-step plan (e.g. a new project's roadmap) as a single pin meant
-- either one giant note with no way to track which steps had actually been
-- pulled into the timeline, or splitting it into N separate pins by hand.
-- Same "doesn't need a child table" reasoning as cork_notes.comments/
-- tasks.checklist — a flat jsonb array of { id, text, milestone, taskId }.
-- `milestone` groups consecutive steps under a "## Heading" line typed into
-- the compose form's roadmap textarea (parseRoadmapDraft() in
-- CorkBoardView.jsx); null for a step typed before any heading, which
-- renders with no milestone header/progress bar at all — the pre-milestone
-- shape. `taskId` is null until that step is added to the real timeline
-- (handleAddRoadmapItem(), with a modifiable deadline rather than always
-- today) and, once set, is also how "done" is determined — CorkBoardView.jsx
-- reads the linked task's own live `status` (via a `tasks` prop threaded
-- down the same way InboxView already receives it), not a second stored
-- flag on the item itself, so ticking the real task off is the only way a
-- milestone step shows as done, with nothing here to fall out of sync.
-- Nullable in spirit but not in SQL — every ordinary pin (still the
-- overwhelming majority) just gets the empty-array default and renders
-- exactly as it always has; CorkBoardView.jsx treats a pin as a roadmap pin
-- (routed to BoardView.jsx's Projects section rather than Pins — see
-- CorkBoardView.jsx's `mode` prop) purely by checking whether this array is
-- non-empty, no separate boolean to keep in sync. No RLS change needed —
-- already covered by cork_notes' existing policies, same reasoning
-- archived_task_id above already gives.
alter table cork_notes add column roadmap_items jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- N members with per-feature permissions (incremental migration — PHASE A)
-- ---------------------------------------------------------------------------
-- Run this block once on an existing project. Supersedes the older "Shared
-- ('both') tasks" block this replaced — if that one was already run, this
-- still works fine (every comparison below reads `who::text`, never a bare
-- enum literal, so it doesn't matter whether 'both' ever actually got added
-- to task_who). Requested directly: the team is growing past exactly Ada
-- and Aaron, and `tasks.who` (a fixed yours/assistant/both enum) has no
-- meaning once there's a third real person — replaced with
-- `tasks.assignee_ids`, a plain array of real member ids, any subset of
-- however many members exist. Separately, a new hire needs real feature
-- restrictions (no Rentals/Vault/Staff) that the old model had no way to
-- express at all (every member saw everything, always) — `members.
-- permissions` is a deny-list jsonb blob covering that, plus EOD/EOW/EOM
-- report submission (Ada never submits one — a role, not a hardcoded name
-- check), managed through a new admin-only screen in SettingsMenu.jsx.
--
-- This phase is purely additive — the old `who` column and `task_who` type
-- are left fully intact here (see the separate PHASE C block below, run
-- only once the new frontend/Edge Functions are confirmed live), so the
-- app keeps working exactly as before through this step regardless of
-- deploy timing on the frontend side.
alter table members add column if not exists color text not null default '#8a8a8a';
alter table members add column if not exists permissions jsonb not null default '{}'::jsonb;
alter table members add column if not exists is_admin boolean not null default false;
alter table tasks add column if not exists assignee_ids uuid[] not null default '{}';

do $$
declare
  ada_id uuid;
  aaron_id uuid;
begin
  select id into ada_id from members where lower(display_name) = 'ada' limit 1;
  select id into aaron_id from members where lower(display_name) = 'aaron' limit 1;

  update tasks set assignee_ids = case
    when who::text = 'both' then array[ada_id, aaron_id]
    when who::text = 'assistant' then array[aaron_id]
    else array[ada_id]
  end
  where assignee_ids = '{}';

  update members set color = '#a8567e' where id = ada_id;
  update members set color = '#4a7ba6' where id = aaron_id;
  update members set is_admin = true where id = aaron_id;
  update members set permissions = jsonb_set(permissions, '{reports}', 'false') where id = ada_id;
end $$;

-- Per-member feature gating, alongside is_member() (never instead of it) —
-- see the matching comment on the base definition above for the deny-list
-- reasoning.
create or replace function has_permission(feature text)
returns boolean as $$
  select exists (
    select 1 from members
    where id = auth.uid()
      and coalesce((permissions ->> feature)::boolean, true)
  );
$$ language sql security definer stable;

alter policy "members can read all rental properties" on rental_properties using (is_member() and has_permission('rentals'));
alter policy "members can insert rental properties" on rental_properties with check (is_member() and has_permission('rentals'));
alter policy "members can update rental properties" on rental_properties using (is_member() and has_permission('rentals'));
alter policy "members can delete rental properties" on rental_properties using (is_member() and has_permission('rentals'));

alter policy "members can read all rental bookings" on rental_bookings using (is_member() and has_permission('rentals'));
alter policy "members can insert rental bookings" on rental_bookings with check (is_member() and has_permission('rentals'));
alter policy "members can update rental bookings" on rental_bookings using (is_member() and has_permission('rentals'));
alter policy "members can delete rental bookings" on rental_bookings using (is_member() and has_permission('rentals'));

alter policy "members can read all rental expenses" on rental_expenses using (is_member() and has_permission('rentals'));
alter policy "members can insert rental expenses" on rental_expenses with check (is_member() and has_permission('rentals'));
alter policy "members can update rental expenses" on rental_expenses using (is_member() and has_permission('rentals'));
alter policy "members can delete rental expenses" on rental_expenses using (is_member() and has_permission('rentals'));

alter policy "members can read all rental savings goals" on rental_savings_goal using (is_member() and has_permission('rentals'));
alter policy "members can insert rental savings goals" on rental_savings_goal with check (is_member() and has_permission('rentals'));
alter policy "members can update rental savings goals" on rental_savings_goal using (is_member() and has_permission('rentals'));
alter policy "members can delete rental savings goals" on rental_savings_goal using (is_member() and has_permission('rentals'));

alter policy "members can read vault meta" on vault_meta using (is_member() and has_permission('vault'));
alter policy "members can insert vault meta" on vault_meta with check (is_member() and has_permission('vault'));
alter policy "members can delete vault meta" on vault_meta using (is_member() and has_permission('vault'));

alter policy "members can read all vault entries" on vault_entries using (is_member() and has_permission('vault'));
alter policy "members can insert vault entries" on vault_entries with check (is_member() and has_permission('vault'));
alter policy "members can update vault entries" on vault_entries using (is_member() and has_permission('vault'));
alter policy "members can delete vault entries" on vault_entries using (is_member() and has_permission('vault'));

alter policy "members can read all staff" on staff using (is_member() and has_permission('staff'));
alter policy "members can insert staff" on staff with check (is_member() and has_permission('staff'));
alter policy "members can update staff" on staff using (is_member() and has_permission('staff')) with check (is_member() and has_permission('staff'));

alter policy "members can read all work sites" on work_sites using (is_member() and has_permission('staff'));
alter policy "members can insert work sites" on work_sites with check (is_member() and has_permission('staff'));
alter policy "members can update work sites" on work_sites using (is_member() and has_permission('staff')) with check (is_member() and has_permission('staff'));
alter policy "members can delete work sites" on work_sites using (is_member() and has_permission('staff'));

alter policy "members and own staff can read time entries" on time_entries using ((is_member() and has_permission('staff')) or staff_id = auth.uid());
alter policy "members can update time entries" on time_entries using (is_member() and has_permission('staff')) with check (is_member() and has_permission('staff'));
alter policy "members can insert time entries" on time_entries with check (is_member() and has_permission('staff'));
alter policy "members can delete time entries" on time_entries using (is_member() and has_permission('staff'));

alter policy "members can read time entry requests" on time_entry_requests using (is_member() and has_permission('staff'));
alter policy "members can update time entry requests" on time_entry_requests using (is_member() and has_permission('staff')) with check (is_member() and has_permission('staff'));

create or replace function generate_month_occurrences(template_id uuid, target_month date)
returns void as $$
declare
  template tasks%rowtype;
  month_start date := date_trunc('month', target_month)::date;
  month_end date := (date_trunc('month', target_month) + interval '1 month - 1 day')::date;
  month_end_ts timestamptz;
  wall_time time;
  step interval;
begin
  select * into template from tasks where id = template_id;
  if not found or template.recurrence::text = 'none'
     or template.recurrence_series_id <> template.id or template.due_date is null then
    return;
  end if;

  wall_time := (template.due_date at time zone template.due_timezone)::time;

  if template.recurrence::text = 'selected_weekdays' then
    insert into tasks (
      title, assignee_ids, priority, icon, due_date, due_timezone, duration_minutes,
      source, source_note, notes, checklist, recurrence, recurrence_days,
      created_by, recurrence_series_id
    )
    select template.title, template.assignee_ids, template.priority, template.icon,
      (day_stamp::date + wall_time) at time zone template.due_timezone,
      template.due_timezone, template.duration_minutes, template.source,
      template.source_note, template.notes, template.checklist,
      template.recurrence, template.recurrence_days,
      template.created_by, template.id
    from generate_series(month_start::timestamp, month_end::timestamp, interval '1 day') as days(day_stamp)
    where extract(dow from day_stamp)::smallint = any(template.recurrence_days)
      and (day_stamp::date + wall_time) at time zone template.due_timezone <> template.due_date
      and not exists (
        select 1 from task_recurrence_exclusions e
        where e.recurrence_series_id = template.id
          and e.due_date = (day_stamp::date + wall_time) at time zone template.due_timezone
      )
    on conflict (recurrence_series_id, due_date)
      where recurrence_series_id is not null and due_date is not null do nothing;
    return;
  end if;

  step := case template.recurrence::text
    when 'daily' then interval '1 day'
    when 'weekly' then interval '7 days'
    when 'biweekly' then interval '14 days'
    when 'every_3_weeks' then interval '21 days'
    when 'monthly' then interval '1 month'
    when 'every_2_months' then interval '2 months'
    when 'quarterly' then interval '3 months'
    when 'every_6_months' then interval '6 months'
    when 'annually' then interval '1 year'
  end;
  if step is null then
    return;
  end if;

  month_end_ts := (month_end + 1)::timestamp at time zone template.due_timezone;

  insert into tasks (
    title, assignee_ids, priority, icon, due_date, due_timezone, duration_minutes,
    source, source_note, notes, checklist, recurrence, recurrence_days,
    created_by, recurrence_series_id
  )
  select template.title, template.assignee_ids, template.priority, template.icon,
    occurrence, template.due_timezone, template.duration_minutes, template.source,
    template.source_note, template.notes, template.checklist,
    template.recurrence, template.recurrence_days,
    template.created_by, template.id
  from generate_series(template.due_date, month_end_ts, step) as occ(occurrence)
  where (occurrence at time zone template.due_timezone)::date between month_start and month_end
    and occurrence <> template.due_date
    and not exists (
      select 1 from task_recurrence_exclusions e
      where e.recurrence_series_id = template.id and e.due_date = occurrence
    )
  on conflict (recurrence_series_id, due_date)
    where recurrence_series_id is not null and due_date is not null do nothing;
end;
$$ language plpgsql security definer;

create or replace function sync_rental_turnover_task()
returns trigger as $$
declare
  property_name text;
  cleaning_due timestamptz;
  aaron_id uuid;
begin
  if new.status <> 'confirmed' then
    delete from tasks where rental_turnover_booking_id = new.id;
    return new;
  end if;

  select unit_name into property_name
  from rental_properties
  where id = new.property_id;

  cleaning_due := ((new.check_out - 7) + time '10:00') at time zone 'America/Chicago';

  select id into aaron_id from members where lower(display_name) = 'aaron' limit 1;

  insert into tasks (
    title, assignee_ids, priority, due_date, due_timezone, source, notes, checklist,
    created_by, rental_turnover_booking_id
  ) values (
    'Schedule turnover cleaning for ' || property_name,
    array[aaron_id],
    'med',
    cleaning_due,
    'America/Chicago',
    'none',
    'Automatically created seven days before ' || new.guest_name || '''s move-out.',
    jsonb_build_array(jsonb_build_object(
      'id', 'add-cleaner-visit-task',
      'text', 'Add a task for when the cleaner will actually come.',
      'done', false,
      'blocked', false,
      'blockedReason', ''
    )),
    new.created_by,
    new.id
  )
  on conflict (rental_turnover_booking_id) do update set
    title = excluded.title,
    due_date = excluded.due_date,
    due_timezone = excluded.due_timezone,
    notes = excluded.notes,
    assignee_ids = array[aaron_id];

  return new;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------------
-- N members with per-feature permissions (incremental migration — PHASE C)
-- ---------------------------------------------------------------------------
-- Run this block only after the new frontend build and the redeployed
-- notify-task-events/notify-reminders/manual-notify Edge Functions are
-- confirmed live and working (they stop reading/writing `who` entirely —
-- see PHASE A above for what changed). Drops the now-unused legacy column
-- and type; nothing references either by this point.
alter table tasks drop column who;
drop type task_who;

-- ---------------------------------------------------------------------------
-- Per-member-pair task-access authorization (incremental migration — PHASE A)
-- ---------------------------------------------------------------------------
-- Run this block once on an existing project, any time. Purely additive —
-- the tasks SELECT/INSERT/UPDATE/DELETE policies stay exactly as they are
-- (flat is_member()-only, full mutual visibility) until the separate
-- PHASE B block below explicitly flips them, so nothing here changes what
-- anyone can currently see or do. Ada and Aaron are backfilled to full
-- mutual access at the end of this block, so their behavior is unchanged
-- even once PHASE B does flip the policies. See task_access's own comment
-- in the base schema above for the full reasoning.
do $$ begin
  create type task_access_level as enum ('view', 'update');
exception when duplicate_object then null;
end $$;

create table if not exists task_access (
  viewer_id uuid not null references members (id) on delete cascade,
  target_id uuid not null references members (id) on delete cascade,
  level task_access_level,
  can_create boolean not null default false,
  can_delete boolean not null default false,
  can_reassign boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references members (id) on delete set null,
  primary key (viewer_id, target_id),
  constraint task_access_no_self_grant check (viewer_id <> target_id),
  constraint task_access_actions_require_access check (
    level is not null or (not can_create and not can_delete and not can_reassign)
  )
);

alter table task_access enable row level security;

create or replace function stamp_task_access_meta()
returns trigger as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$ language plpgsql;

drop trigger if exists task_access_stamp_meta on task_access;
create trigger task_access_stamp_meta
before insert or update on task_access
for each row execute function stamp_task_access_meta();

create or replace function grant_admin_access_to_new_member()
returns trigger as $$
begin
  insert into task_access (viewer_id, target_id, level)
  select m.id, new.id, 'update'
  from members m
  where m.is_admin and m.id <> new.id
  on conflict (viewer_id, target_id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists members_grant_admin_access_to_new_member on members;
create trigger members_grant_admin_access_to_new_member
after insert on members
for each row execute function grant_admin_access_to_new_member();

-- Read-only visibility into the table itself (its own grants), same
-- shape as the base schema's copy of this policy — full admin CRUD is a
-- separate, not-yet-built access-management screen's security definer RPC.
drop policy if exists "members can read their own outgoing task access grants" on task_access;
create policy "members can read their own outgoing task access grants"
  on task_access for select
  using (is_member() and viewer_id = auth.uid());

-- These five are also created in PHASE B, but defining them here too
-- means anyone testing task_access grants against a real can_view_task()
-- call doesn't have to wait for PHASE B to try it — create or replace is
-- idempotent, so PHASE B's identical redeclaration is a safe no-op.
create or replace function can_view_task(assignees uuid[])
returns boolean as $$
  select auth.uid() = any(assignees)
    or exists (
      select 1 from task_access
      where viewer_id = auth.uid() and target_id = any(assignees)
        and level in ('view', 'update')
    );
$$ language sql security definer stable;

create or replace function can_update_task(assignees uuid[])
returns boolean as $$
  select auth.uid() = any(assignees)
    or exists (
      select 1 from task_access
      where viewer_id = auth.uid() and target_id = any(assignees) and level = 'update'
    );
$$ language sql security definer stable;

create or replace function can_delete_task(assignees uuid[])
returns boolean as $$
  select not exists (
    select 1 from unnest(assignees) as other(id)
    where other.id <> auth.uid()
      and not exists (
        select 1 from task_access
        where viewer_id = auth.uid() and target_id = other.id and can_delete
      )
  );
$$ language sql security definer stable;

create or replace function can_reassign_task(assignees uuid[])
returns boolean as $$
  select not exists (
    select 1 from unnest(assignees) as other(id)
    where other.id <> auth.uid()
      and not exists (
        select 1 from task_access
        where viewer_id = auth.uid() and target_id = other.id and can_reassign
      )
  );
$$ language sql security definer stable;

create or replace function can_create_task_for(assignees uuid[])
returns boolean as $$
  select not exists (
    select 1 from unnest(assignees) as other(id)
    where other.id <> auth.uid()
      and not exists (
        select 1 from task_access
        where viewer_id = auth.uid() and target_id = other.id and can_create
      )
  );
$$ language sql security definer stable;

do $$
declare
  ada_id uuid;
  aaron_id uuid;
begin
  select id into ada_id from members where lower(display_name) = 'ada' limit 1;
  select id into aaron_id from members where lower(display_name) = 'aaron' limit 1;

  insert into task_access (viewer_id, target_id, level, can_create, can_delete, can_reassign)
  values
    (ada_id, aaron_id, 'update', true, true, true),
    (aaron_id, ada_id, 'update', true, true, true)
  on conflict (viewer_id, target_id) do update set
    level = excluded.level, can_create = excluded.can_create,
    can_delete = excluded.can_delete, can_reassign = excluded.can_reassign;
end $$;

-- ---------------------------------------------------------------------------
-- Per-member-pair task-access authorization (incremental migration — PHASE B)
-- ---------------------------------------------------------------------------
-- Run this block only after PHASE A above has been run AND you've
-- confirmed (e.g. via the verification queries in the governing plan)
-- that Ada/Aaron's task_access rows are in place. This is the actual
-- cutover — task visibility stops being flat is_member()-only mutual
-- access and starts being governed by task_access grants. Bundle this
-- deploy with the frontend's deleteTask() fix (src/lib/tasks.js — adds
-- .select().single() so an RLS-denied delete throws instead of silently
-- affecting zero rows) since that bug only matters once denial is
-- actually possible.
create or replace function can_view_task(assignees uuid[])
returns boolean as $$
  select auth.uid() = any(assignees)
    or exists (
      select 1 from task_access
      where viewer_id = auth.uid() and target_id = any(assignees)
        and level in ('view', 'update')
    );
$$ language sql security definer stable;

create or replace function can_update_task(assignees uuid[])
returns boolean as $$
  select auth.uid() = any(assignees)
    or exists (
      select 1 from task_access
      where viewer_id = auth.uid() and target_id = any(assignees) and level = 'update'
    );
$$ language sql security definer stable;

create or replace function can_delete_task(assignees uuid[])
returns boolean as $$
  select not exists (
    select 1 from unnest(assignees) as other(id)
    where other.id <> auth.uid()
      and not exists (
        select 1 from task_access
        where viewer_id = auth.uid() and target_id = other.id and can_delete
      )
  );
$$ language sql security definer stable;

create or replace function can_reassign_task(assignees uuid[])
returns boolean as $$
  select not exists (
    select 1 from unnest(assignees) as other(id)
    where other.id <> auth.uid()
      and not exists (
        select 1 from task_access
        where viewer_id = auth.uid() and target_id = other.id and can_reassign
      )
  );
$$ language sql security definer stable;

create or replace function can_create_task_for(assignees uuid[])
returns boolean as $$
  select not exists (
    select 1 from unnest(assignees) as other(id)
    where other.id <> auth.uid()
      and not exists (
        select 1 from task_access
        where viewer_id = auth.uid() and target_id = other.id and can_create
      )
  );
$$ language sql security definer stable;

create or replace function enforce_task_reassignment_access()
returns trigger as $$
begin
  if new.assignee_ids is distinct from old.assignee_ids then
    if not can_reassign_task(old.assignee_ids) then
      raise exception 'Not authorized to reassign this task away from its current assignees';
    end if;
    if not can_create_task_for(new.assignee_ids) then
      raise exception 'Not authorized to assign this task to one or more of the new assignees';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists tasks_enforce_reassignment_access on tasks;
create trigger tasks_enforce_reassignment_access
before update of assignee_ids on tasks
for each row execute function enforce_task_reassignment_access();

-- Same authorization delete_recurring_task's base definition above now
-- has — redeclared here so an existing project's already-created copy of
-- this function (from before this migration) picks up the check too.
create or replace function delete_recurring_task(target_task_id uuid, delete_future boolean)
returns void as $$
declare
  target tasks%rowtype;
  series_id uuid;
  replacement_id uuid;
begin
  if not exists (select 1 from members where id = auth.uid()) then
    raise exception 'Not authorized';
  end if;

  select * into target from tasks where id = target_task_id;
  if not found then return; end if;
  if not can_delete_task(target.assignee_ids) then
    raise exception 'Not authorized';
  end if;
  series_id := coalesce(target.recurrence_series_id, target.id);

  if delete_future then
    update tasks set recurrence = 'none', recurrence_days = '{}',
      recurrence_series_id = null
    where recurrence_series_id = series_id
      and id <> series_id
      and due_date < target.due_date;
    delete from tasks where id = series_id;
    return;
  end if;

  if target.id <> series_id then
    delete from tasks where id = target.id;
    return;
  end if;

  select id into replacement_id from tasks
  where recurrence_series_id = series_id and id <> series_id
  order by due_date nulls last limit 1;

  if replacement_id is null then
    delete from tasks where id = target.id;
    return;
  end if;

  update tasks set recurrence_series_id = replacement_id where id = replacement_id;
  update tasks set recurrence_series_id = replacement_id
    where recurrence_series_id = series_id and id <> series_id;
  update task_recurrence_exclusions set recurrence_series_id = replacement_id
    where recurrence_series_id = series_id;
  insert into task_recurrence_exclusions (recurrence_series_id, due_date)
    values (replacement_id, target.due_date) on conflict do nothing;
  delete from tasks where id = target.id;
end;
$$ language plpgsql security definer;

drop policy "members can read all tasks" on tasks;
create policy "members can view accessible tasks"
  on tasks for select
  using (is_member() and can_view_task(assignee_ids));

drop policy "members can insert tasks" on tasks;
create policy "members can insert tasks they may create"
  on tasks for insert
  with check (is_member() and can_create_task_for(assignee_ids));

drop policy "members can update tasks" on tasks;
create policy "members can update accessible tasks"
  on tasks for update
  using (is_member() and can_update_task(assignee_ids))
  with check (is_member() and can_update_task(assignee_ids));

drop policy "members can delete tasks" on tasks;
create policy "members can delete accessible tasks"
  on tasks for delete
  using (is_member() and can_delete_task(assignee_ids));

-- ---------------------------------------------------------------------------
-- Admin-managed member access (incremental migration)
-- ---------------------------------------------------------------------------
-- Run this block once on an existing project, any time — fully additive,
-- no existing policy is touched. Backs ManageMemberAccessView.jsx /
-- MemberAccessForm.jsx (an admin-only screen editing another member's
-- permissions/task_access). Also closes a real hole: members' only
-- UPDATE policy ("members can update own working status") has no column
-- restriction, so before this, any member could self-grant admin status
-- or clear their own restrictions via a raw client update — see the
-- matching comment in the base schema above for the full reasoning.
create or replace function is_admin_member()
returns boolean as $$
  select exists (select 1 from members where id = auth.uid() and is_admin);
$$ language sql security definer stable;

create or replace function guard_member_privilege_columns()
returns trigger as $$
begin
  if (new.permissions is distinct from old.permissions or new.is_admin is distinct from old.is_admin)
     and coalesce(current_setting('app.member_privilege_write', true), '0') <> '1' then
    raise exception 'permissions/is_admin can only be changed via set_member_permissions()';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists members_guard_privilege_columns on members;
create trigger members_guard_privilege_columns
before update on members
for each row execute function guard_member_privilege_columns();

create or replace function set_member_permissions(target_id uuid, new_permissions jsonb)
returns members
language plpgsql
security definer
set search_path = public
as $$
declare
  updated members%rowtype;
begin
  if not is_admin_member() then
    raise exception 'Not authorized';
  end if;
  if jsonb_typeof(new_permissions) <> 'object' then
    raise exception 'permissions must be a JSON object';
  end if;

  perform set_config('app.member_privilege_write', '1', true);
  update members set permissions = new_permissions where id = target_id
  returning * into updated;
  perform set_config('app.member_privilege_write', '0', true);

  if not found then
    raise exception 'Member not found';
  end if;
  return updated;
end;
$$;

grant execute on function set_member_permissions(uuid, jsonb) to authenticated;

drop policy if exists "admins can read all task access grants" on task_access;
create policy "admins can read all task access grants"
  on task_access for select
  using (is_member() and is_admin_member());

create or replace function upsert_task_access(
  p_viewer_id uuid, p_target_id uuid, p_level task_access_level,
  p_can_create boolean, p_can_delete boolean, p_can_reassign boolean
)
returns task_access
language plpgsql
security definer
set search_path = public
as $$
declare
  result task_access%rowtype;
begin
  if not is_admin_member() then
    raise exception 'Not authorized';
  end if;
  if p_viewer_id = p_target_id then
    raise exception 'Cannot grant a member access to themselves';
  end if;

  insert into task_access (viewer_id, target_id, level, can_create, can_delete, can_reassign)
  values (p_viewer_id, p_target_id, p_level, p_can_create, p_can_delete, p_can_reassign)
  on conflict (viewer_id, target_id) do update set
    level = excluded.level, can_create = excluded.can_create,
    can_delete = excluded.can_delete, can_reassign = excluded.can_reassign
  returning * into result;
  return result;
end;
$$;

grant execute on function upsert_task_access(uuid, uuid, task_access_level, boolean, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Working status: availability states + expiry (incremental migration)
-- ---------------------------------------------------------------------------
-- Run this block once on an existing project, any time — purely additive
-- (two new nullable columns, one new enum), no existing policy touched.
-- The existing "members can update own working status" RLS policy
-- already covers these two new columns for free (a plain self-row check,
-- no column restriction) — see the matching comment on working_status in
-- the base schema above for why that's an accepted gap, not an oversight.
do $$ begin
  create type member_working_status as enum ('available', 'busy', 'in_meeting');
exception when duplicate_object then null;
end $$;

alter table members add column if not exists working_status member_working_status;
alter table members add column if not exists working_status_until timestamptz;

-- ---------------------------------------------------------------------------
-- Person-level nudge history (incremental migration)
-- ---------------------------------------------------------------------------
-- Run this block once on an existing project, any time — fully additive,
-- no existing policy touched. See the matching comment on member_nudges
-- in the base schema above for the full reasoning.
create table if not exists member_nudges (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references members (id) on delete cascade,
  target_id uuid not null references members (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table member_nudges enable row level security;

drop policy if exists "members can read all member nudges" on member_nudges;
create policy "members can read all member nudges"
  on member_nudges for select
  using (is_member());

-- The Inbox subscribes to this table; publication membership is not automatic.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'member_nudges'
  ) then
    alter publication supabase_realtime add table public.member_nudges;
  end if;
end $$;

-- Private task attachments: deploy the authenticated attachment UI first.
begin;

-- Casting t.id (uuid) to text to compare against a text prefix defeats
-- tasks_pkey's uuid-ops index — a seq scan on every RLS check, which runs
-- once per storage row evaluated. Casting the parsed prefix to uuid
-- instead (comparing directly against t.id) lets the index apply, but a
-- bare ::uuid cast throws on a malformed/foreign object name, and
-- Postgres doesn't guarantee AND-clause evaluation order, so a regex
-- guard placed before the cast isn't a reliable way to avoid that. This
-- wrapper just degrades a bad cast to "no match" instead.
create or replace function public.safe_uuid(v text)
returns uuid language plpgsql immutable as $$
begin
  return v::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.can_access_task_attachment(object_name text, writing boolean default false)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_member() and (
    exists (
      select 1 from public.tasks t
      where t.id = public.safe_uuid(left(object_name, 36))
        and substring(object_name from 37 for 1) = '-'
        and case when writing then public.can_update_task(t.assignee_ids)
                 else public.can_view_task(t.assignee_ids) end
    )
    -- An attachment a submitter chose to include in their report is
    -- exactly as disclosed as the report text sitting next to it — so a
    -- reader who can open the report (own report, or a report_access
    -- grant toward its submitter — see eod_reports' own SELECT policy)
    -- but has no task_access grant on the source task must still be able
    -- to open its attachment. Read-only: never applies while writing,
    -- since an eod_report attachment is never re-uploaded/edited/deleted
    -- through this path. This used to check only for the report's
    -- existence, back when eod_reports was unconditionally mutually
    -- visible (a plain is_member() policy) — now that report_access can
    -- restrict who reads a given report, the same restriction has to
    -- apply here too, or this carve-out would let someone open a
    -- report's attachment despite not being allowed to read the report
    -- itself.
    or (
      not writing
      and exists (
        select 1 from public.eod_reports r
        where r.attachments @> jsonb_build_array(jsonb_build_object('url', 'storage://task-attachments/' || object_name))
          and (r.submitted_by = auth.uid() or public.has_report_access(r.submitted_by))
      )
    )
  );
$$;

drop policy if exists "members can upload task attachments" on storage.objects;
drop policy if exists "members can update task attachments" on storage.objects;
drop policy if exists "members can view task attachments" on storage.objects;
drop policy if exists "members can delete task attachments" on storage.objects;
create policy "members can view task attachments" on storage.objects for select to authenticated
using (bucket_id = 'task-attachments' and public.can_access_task_attachment(name));
create policy "members can upload task attachments" on storage.objects for insert to authenticated
with check (bucket_id = 'task-attachments' and public.can_access_task_attachment(name, true));
create policy "members can update task attachments" on storage.objects for update to authenticated
using (bucket_id = 'task-attachments' and public.can_access_task_attachment(name, true))
with check (bucket_id = 'task-attachments' and public.can_access_task_attachment(name, true));
-- Delete additionally allows any member to remove an attachment whose
-- owning task row no longer exists at all (a hard delete, not just
-- tasks.archived) — without this, can_access_task_attachment's task
-- lookup unconditionally returns false once the task is gone, and the
-- object becomes permanently unreadable *and* undeletable by anyone,
-- including whoever uploaded it. There's no real per-task permission
-- left to check once the task itself is gone, so this is plain orphan
-- cleanup, not a privilege relaxation.
create policy "members can delete task attachments" on storage.objects for delete to authenticated
using (
  bucket_id = 'task-attachments'
  and public.is_member()
  and (
    public.can_access_task_attachment(name, true)
    or not exists (
      select 1 from public.tasks t
      where t.id = public.safe_uuid(left(name, 36)) and substring(name from 37 for 1) = '-'
    )
  )
);
update storage.buckets set public = false where id = 'task-attachments';
commit;

-- Targeted cork_notes sharing (incremental migration) — replaces the
-- original boolean `shared` (visible to literally every member) with a
-- per-member `shared_with uuid[]`, so sharing a pin means picking who,
-- consistent with task_access being the app's other real example of
-- non-mutual, per-member visibility. Existing shared pins are backfilled
-- to every *other* member that existed at migration time (preserving
-- exactly who could already see them), not to "everyone, present or
-- future" — a member added later needs an explicit (re-)share, same as
-- a brand-new member never inherits existing task_access grants either.
begin;

alter table cork_notes add column if not exists shared_with uuid[] not null default '{}'::uuid[];

update cork_notes n
set shared_with = coalesce(
  (select array_agg(m.id) from members m where m.id != n.author_id),
  '{}'::uuid[]
)
where shared and shared_with = '{}'::uuid[];

drop policy if exists "members can read own or shared cork notes" on cork_notes;
create policy "members can read own or shared cork notes"
  on cork_notes for select
  using (is_member() and (auth.uid() = any(shared_with) or author_id = auth.uid()));

create or replace function add_cork_note_comment(p_note_id uuid, p_body text)
returns cork_notes
language plpgsql
security definer
set search_path = public
as $$
declare
  result cork_notes;
begin
  if not is_member() then
    raise exception 'not a member';
  end if;

  update cork_notes
  set comments = comments || jsonb_build_object(
    'id', gen_random_uuid(),
    'authorId', auth.uid(),
    'body', p_body,
    'createdAt', now()
  )
  where id = p_note_id
    and (auth.uid() = any(shared_with) or author_id = auth.uid())
  returning * into result;

  if result.id is null then
    raise exception 'note not found or not visible';
  end if;

  return result;
end;
$$;

alter table cork_notes drop column if exists shared;

commit;

-- Second, healthcare-scoped vault (incremental migration) — splits the
-- single global vault into per-vault rows (vaults/vault_access, new),
-- adds vault_id to vault_meta/vault_entries, adds shared_with to
-- vault_entries, and rewrites every vault_meta/vault_entries policy to
-- key off vault_access instead of the old blanket has_permission('vault')
-- check. See the base vault_meta/vault_entries/vaults/vault_access
-- definitions above for the full reasoning — this block only exists to
-- bring an already-live database in line with that end state without
-- losing the existing household vault's data or access.
begin;

create table if not exists vaults (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  private_entries boolean not null default false,
  created_at timestamptz not null default now()
);
alter table vaults enable row level security;

create table if not exists vault_access (
  vault_id uuid not null references vaults (id) on delete cascade,
  member_id uuid not null references members (id) on delete cascade,
  primary key (vault_id, member_id)
);
alter table vault_access enable row level security;

-- security definer so vault_access's own select policy (below) doesn't
-- recurse into itself — same fix is_member() already applies to the
-- equivalent members-table problem.
create or replace function has_vault_access(check_vault_id uuid)
returns boolean as $$
  select exists (select 1 from vault_access where vault_id = check_vault_id and member_id = auth.uid());
$$ language sql security definer stable;

create or replace function vault_has_private_entries(check_vault_id uuid)
returns boolean as $$
  select coalesce((select private_entries from vaults where id = check_vault_id), false);
$$ language sql stable;

alter table vault_meta add column if not exists vault_id uuid references vaults (id) on delete cascade;
alter table vault_entries add column if not exists vault_id uuid references vaults (id) on delete cascade;
alter table vault_entries add column if not exists shared_with uuid[] not null default '{}'::uuid[];

-- One-time: create the two real vaults, point every existing vault_meta/
-- vault_entries row at the household one (there is at most one of each
-- today, per the old vault_meta_singleton index), and seed vault_access
-- for both — household from whichever members currently have
-- permissions.vault (deny-list: absent/true = allowed, matching the old
-- RLS check exactly, so this preserves today's real access rather than
-- hardcoding specific member ids), healthcare from every current member
-- (the whole point of this vault). A household vault that was never set
-- up (no vault_meta row yet) still gets its vaults row and vault_access
-- grants — there's simply nothing to backfill onto it.
do $$
declare
  household_id uuid;
  healthcare_id uuid;
begin
  select id into household_id from vaults where name = 'Household';
  if household_id is null then
    insert into vaults (name, private_entries) values ('Household', false) returning id into household_id;
  end if;

  select id into healthcare_id from vaults where name = 'Healthcare';
  if healthcare_id is null then
    insert into vaults (name, private_entries) values ('Healthcare', true) returning id into healthcare_id;
  end if;

  update vault_meta set vault_id = household_id where vault_id is null;
  update vault_entries set vault_id = household_id where vault_id is null;

  insert into vault_access (vault_id, member_id)
  select household_id, id from members where coalesce((permissions ->> 'vault')::boolean, true)
  on conflict do nothing;

  insert into vault_access (vault_id, member_id)
  select healthcare_id, id from members
  on conflict do nothing;
end $$;

alter table vault_meta alter column vault_id set not null;
alter table vault_entries alter column vault_id set not null;

drop index if exists vault_meta_singleton;
create unique index if not exists vault_meta_vault_id_unique on vault_meta (vault_id);

drop policy if exists "members can read accessible vaults" on vaults;
create policy "members can read accessible vaults"
  on vaults for select
  using (is_member() and has_vault_access(id));

drop policy if exists "members can read their own vault access" on vault_access;
drop policy if exists "members can read their vault's access roster" on vault_access;
create policy "members can read their vault's access roster"
  on vault_access for select
  using (is_member() and has_vault_access(vault_id));

drop policy if exists "members can read vault meta" on vault_meta;
drop policy if exists "members can insert vault meta" on vault_meta;
drop policy if exists "members can delete vault meta" on vault_meta;
create policy "members can read vault meta"
  on vault_meta for select
  using (is_member() and has_vault_access(vault_id));
create policy "members can insert vault meta"
  on vault_meta for insert
  with check (is_member() and has_vault_access(vault_id));
create policy "members can delete vault meta"
  on vault_meta for delete
  using (is_member() and has_vault_access(vault_id));

drop policy if exists "members can read all vault entries" on vault_entries;
drop policy if exists "members can insert vault entries" on vault_entries;
drop policy if exists "members can update vault entries" on vault_entries;
drop policy if exists "members can delete vault entries" on vault_entries;
create policy "members can read accessible vault entries"
  on vault_entries for select
  using (
    is_member()
    and has_vault_access(vault_id)
    and (not vault_has_private_entries(vault_id) or created_by = auth.uid() or auth.uid() = any(shared_with))
  );
create policy "members can insert vault entries"
  on vault_entries for insert
  with check (is_member() and has_vault_access(vault_id) and created_by = auth.uid());
create policy "members can update vault entries"
  on vault_entries for update
  using (
    is_member()
    and has_vault_access(vault_id)
    and (not vault_has_private_entries(vault_id) or created_by = auth.uid())
  );
create policy "members can delete vault entries"
  on vault_entries for delete
  using (
    is_member()
    and has_vault_access(vault_id)
    and (not vault_has_private_entries(vault_id) or created_by = auth.uid())
  );

-- permissions.vault is retired — vault_access now expresses "which
-- vault(s)" a member can see, which a single blanket boolean never could.
-- A raw update of `permissions` is blocked by members_guard_privilege_columns
-- (see that trigger's own comment above) from any role, SQL editor included
-- — set_member_permissions() is the only normal write path, but it's
-- admin-gated and per-member, so this one-time cleanup instead opens the
-- same session-scoped escape hatch that trigger's comment documents for
-- exactly this kind of SQL-editor maintenance.
select set_config('app.member_privilege_write', '1', true);
update members set permissions = permissions - 'vault';
select set_config('app.member_privilege_write', '0', true);

commit;

-- Collapse the healthcare vault back into one shared vault (incremental
-- migration) — a second vault meant a second master password, and that
-- turned out to be more to remember than it was worth once the actual
-- goal (letting a new member see only specific credentials, not
-- everything) was already exactly what private_entries/shared_with
-- already does *within* one vault. No table/column/RLS change needed —
-- that mechanism was already built generically, per-vault, not
-- specifically for a second vault — this block is pure data: flip the
-- flag, backfill today's access so nothing silently disappears, move
-- the new member's grant over, and drop the now-unused second vault.
begin;

-- Household goes from fully-mutual to the same private-by-default,
-- share-per-entry model the (now-removed) healthcare vault had. Every
-- *new* entry from here on defaults to visible only to its creator —
-- that's the real behavior change for Ada and Aaron, not just for the
-- new member; an explicit "Share with" click is now required to keep an
-- entry visible to each other, same as it would be for anyone else with
-- vault access.
update vaults set private_entries = true where name = 'Household';

-- Preserve today's full mutual access as the floor so flipping the flag
-- above doesn't silently hide anyone's own entries from the other
-- person: every existing Household entry gets explicitly shared with
-- every *other* member who has vault_access to it right now (computed
-- before the new member's own grant below, so she isn't retroactively
-- added to entries that predate her).
update vault_entries ve
set shared_with = (
  select coalesce(array_agg(va.member_id), '{}'::uuid[])
  from vault_access va
  where va.vault_id = ve.vault_id and va.member_id <> ve.created_by
)
where ve.vault_id = (select id from vaults where name = 'Household');

-- The new member gets access to the one shared vault instead of her own
-- separate one — she'll only actually see whatever gets explicitly
-- shared with her going forward, same mechanism everyone else now uses.
insert into vault_access (vault_id, member_id)
select (select id from vaults where name = 'Household'), id from members where display_name = 'RC Lina'
on conflict do nothing;

-- The healthcare vault was never actually set up (no vault_meta row, no
-- entries) — safe to drop outright; cascades to its own now-pointless
-- vault_access rows.
delete from vaults where name = 'Healthcare';

commit;

-- Re-apply grant_admin_access_to_new_member() and its trigger
-- (incremental migration) — discovered missing from production entirely
-- (neither the function nor the trigger existed) while debugging why
-- Aaron couldn't see RC Lina's tasks on the board after she was added
-- as a real member. Both are already defined in the base schema above
-- (see "Generalize from Ada/Aaron to N members" / task_access), so this
-- block is purely re-applying what should have already been part of an
-- earlier incremental migration and apparently never made it into the
-- SQL actually run against this database. Aaron's own missing grant
-- toward RC was backfilled by hand in production at the same time this
-- was found; this block only re-establishes the trigger so the same gap
-- can't happen again for the next member added.
begin;

create or replace function grant_admin_access_to_new_member()
returns trigger as $$
begin
  insert into task_access (viewer_id, target_id, level)
  select m.id, new.id, 'update'
  from members m
  where m.is_admin and m.id <> new.id
  on conflict (viewer_id, target_id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists members_grant_admin_access_to_new_member on members;
create trigger members_grant_admin_access_to_new_member
after insert on members
for each row execute function grant_admin_access_to_new_member();

commit;

-- Per-member report visibility (incremental migration) — eod_reports
-- used to be unconditionally mutually visible to every member
-- (is_member() alone); report_access makes who can read whose reports
-- an explicit, admin-managed grant instead, same "exists = allowed"
-- shape vault_access already established. Requested directly: with more
-- than two people submitting reports, a report is now as personal as a
-- work log, not something every member should default into reading.
-- See the base eod_reports/report_access definitions above for the full
-- reasoning — this block brings an already-live database in line with
-- that end state without losing anyone's current ability to read a
-- report they can already read today.
begin;

create table if not exists report_access (
  viewer_id uuid not null references members (id) on delete cascade,
  target_id uuid not null references members (id) on delete cascade,
  updated_at timestamptz not null default now(),
  updated_by uuid references members (id) on delete set null,
  primary key (viewer_id, target_id),
  constraint report_access_no_self_grant check (viewer_id <> target_id)
);
alter table report_access enable row level security;

drop trigger if exists report_access_stamp_meta on report_access;
create trigger report_access_stamp_meta
before insert or update on report_access
for each row execute function stamp_task_access_meta();

drop policy if exists "members can read their own outgoing report access grants" on report_access;
create policy "members can read their own outgoing report access grants"
  on report_access for select
  using (is_member() and viewer_id = auth.uid());

drop policy if exists "admins can read all report access grants" on report_access;
create policy "admins can read all report access grants"
  on report_access for select
  using (is_member() and is_admin_member());

create or replace function has_report_access(check_target_id uuid)
returns boolean as $$
  select exists (select 1 from report_access where viewer_id = auth.uid() and target_id = check_target_id);
$$ language sql security definer stable;

create or replace function set_report_access(p_viewer_id uuid, p_target_id uuid, p_can_view boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin_member() then
    raise exception 'Not authorized';
  end if;
  if p_viewer_id = p_target_id then
    raise exception 'Cannot grant a member access to themselves';
  end if;

  if p_can_view then
    insert into report_access (viewer_id, target_id, updated_by)
    values (p_viewer_id, p_target_id, auth.uid())
    on conflict (viewer_id, target_id) do nothing;
  else
    delete from report_access where viewer_id = p_viewer_id and target_id = p_target_id;
  end if;
end;
$$;

grant execute on function set_report_access(uuid, uuid, boolean) to authenticated;

-- Backfill is deliberately NOT "every current member grants every other
-- member" — unlike the vault/task_access backfills elsewhere in this
-- schema, preserving today's literal access here would defeat the point:
-- today's flat is_member() policy already lets everyone, including any
-- VA, read everyone else's reports, and that unrestricted-by-default
-- state is exactly what this feature exists to fix. Instead this seeds
-- only the one relationship meant to carry forward unchanged — Ada and
-- Aaron mutually reading each other's reports, the original two-person
-- household relationship this app started from — matched by name since
-- there's no "founding member" flag to key off instead. Any other
-- member, present or future, starts unable to read anyone else's
-- reports (and nobody can read theirs) until explicitly granted via
-- Manage member access.
insert into report_access (viewer_id, target_id)
select m1.id, m2.id
from members m1, members m2
where m1.id <> m2.id
  and m1.display_name in ('Ada', 'Aaron')
  and m2.display_name in ('Ada', 'Aaron')
on conflict do nothing;

drop policy if exists "members can read all eod reports" on eod_reports;
create policy "members can read accessible eod reports"
  on eod_reports for select
  using (is_member() and (submitted_by = auth.uid() or has_report_access(submitted_by)));

create or replace function public.can_access_task_attachment(object_name text, writing boolean default false)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_member() and (
    exists (
      select 1 from public.tasks t
      where t.id = public.safe_uuid(left(object_name, 36))
        and substring(object_name from 37 for 1) = '-'
        and case when writing then public.can_update_task(t.assignee_ids)
                 else public.can_view_task(t.assignee_ids) end
    )
    or (
      not writing
      and exists (
        select 1 from public.eod_reports r
        where r.attachments @> jsonb_build_array(jsonb_build_object('url', 'storage://task-attachments/' || object_name))
          and (r.submitted_by = auth.uid() or public.has_report_access(r.submitted_by))
      )
    )
  );
$$;

commit;

-- members_who_can_view_task() (incremental migration) — backs the new
-- post-completion "Notify" picker in TaskRow.jsx. See the base
-- definition above (right after can_view_task/can_update_task) for the
-- full reasoning; this is pure addition, no existing function/policy
-- touched.
begin;

create or replace function members_who_can_view_task(check_task_id uuid)
returns table(member_id uuid)
language sql
security definer
stable
as $$
  select m.id
  from members m
  join tasks t on t.id = check_task_id
  where is_member()
    and (
      m.id = any(t.assignee_ids)
      or exists (
        select 1 from task_access ta
        where ta.viewer_id = m.id and ta.target_id = any(t.assignee_ids) and ta.level in ('view', 'update')
      )
    );
$$;

grant execute on function members_who_can_view_task(uuid) to authenticated;

commit;

-- Per-member priorities visibility (incremental migration) — priorities
-- used to be a single shared note (is_member() alone, and the frontend
-- showed whoever saved most recently as "current" regardless of who
-- that was). Made genuinely per-person, same priorities_access model
-- report_access already established for eod_reports. See the base
-- priorities/priorities_access definitions above for the full
-- reasoning — this block brings an already-live database in line with
-- that end state.
begin;

create table if not exists priorities_access (
  viewer_id uuid not null references members (id) on delete cascade,
  target_id uuid not null references members (id) on delete cascade,
  updated_at timestamptz not null default now(),
  updated_by uuid references members (id) on delete set null,
  primary key (viewer_id, target_id),
  constraint priorities_access_no_self_grant check (viewer_id <> target_id)
);
alter table priorities_access enable row level security;

drop trigger if exists priorities_access_stamp_meta on priorities_access;
create trigger priorities_access_stamp_meta
before insert or update on priorities_access
for each row execute function stamp_task_access_meta();

drop policy if exists "members can read their own outgoing priorities access grants" on priorities_access;
create policy "members can read their own outgoing priorities access grants"
  on priorities_access for select
  using (is_member() and viewer_id = auth.uid());

drop policy if exists "admins can read all priorities access grants" on priorities_access;
create policy "admins can read all priorities access grants"
  on priorities_access for select
  using (is_member() and is_admin_member());

create or replace function has_priorities_access(check_target_id uuid)
returns boolean as $$
  select exists (select 1 from priorities_access where viewer_id = auth.uid() and target_id = check_target_id);
$$ language sql security definer stable;

create or replace function set_priorities_access(p_viewer_id uuid, p_target_id uuid, p_can_view boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin_member() then
    raise exception 'Not authorized';
  end if;
  if p_viewer_id = p_target_id then
    raise exception 'Cannot grant a member access to themselves';
  end if;

  if p_can_view then
    insert into priorities_access (viewer_id, target_id, updated_by)
    values (p_viewer_id, p_target_id, auth.uid())
    on conflict (viewer_id, target_id) do nothing;
  else
    delete from priorities_access where viewer_id = p_viewer_id and target_id = p_target_id;
  end if;
end;
$$;

grant execute on function set_priorities_access(uuid, uuid, boolean) to authenticated;

-- Backfill, same reasoning report_access's own migration already used:
-- only Ada and Aaron's existing mutual visibility carries forward
-- unchanged. Any other member, present or future, starts unable to
-- read anyone else's priorities (and nobody can read theirs) until
-- explicitly granted via Manage member access.
insert into priorities_access (viewer_id, target_id)
select m1.id, m2.id
from members m1, members m2
where m1.id <> m2.id
  and m1.display_name in ('Ada', 'Aaron')
  and m2.display_name in ('Ada', 'Aaron')
on conflict do nothing;

drop policy if exists "members can read all priorities" on priorities;
create policy "members can read accessible priorities"
  on priorities for select
  using (is_member() and (set_by = auth.uid() or has_priorities_access(set_by)));

commit;

-- ---------------------------------------------------------------------------
-- Recurrence generator fixes — see supabase/fix-recurrence-generation.sql
-- ---------------------------------------------------------------------------
-- generate_month_occurrences() above is the ORIGINAL version. Existing and new
-- projects should also run supabase/fix-recurrence-generation.sql, which
-- replaces it (no back-filling of past weekday copies, wall-clock time so a
-- clock change cannot shift tasks, monthly dates computed from the original
-- date), adds an hourly job that keeps this and next month ready, and adds
-- update_recurring_series_future() for "this and future tasks" edits.

-- ---------------------------------------------------------------------------
-- External tools (Settings) — see supabase/add-external-tools.sql
-- ---------------------------------------------------------------------------
-- Run that file once to create external_tools (rows readable only by the
-- members listed on each) and add the Dallas Property Finder row.

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

-- Atomic Board roadmap scheduling (incremental migration).
-- Run manually in the Supabase SQL editor before publishing the frontend.
-- Uses existing RLS; does not grant shared viewers project-edit permission.
begin;
create or replace function public.add_roadmap_item_task(
  p_note_id uuid, p_item_id text, p_due_date timestamptz, p_due_timezone text
)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  note public.cork_notes;
  item jsonb;
  item_index integer;
  task_id uuid;
begin
  if not public.is_member() then
    raise exception 'Members only';
  end if;
  if p_due_date is null or p_due_timezone is null then
    raise exception 'Choose a task date and timezone';
  end if;
  perform now() at time zone p_due_timezone;

  -- Serialize retries and different steps on this same project, so replacing
  -- its JSON array cannot discard another request's task link.
  select * into note from public.cork_notes
  where id = p_note_id and author_id = auth.uid() and not archived
  for update;
  if note.id is null then
    raise exception 'Only the owner can schedule steps from an active project';
  end if;
  select value, (ordinality - 1)::integer into item, item_index
  from jsonb_array_elements(note.roadmap_items) with ordinality
  where value ->> 'id' = p_item_id;
  if item is null then
    raise exception 'This project step no longer exists';
  end if;
  if nullif(item ->> 'taskId', '') is not null then
    return (item ->> 'taskId')::uuid;
  end if;
  if coalesce(btrim(item ->> 'text'), '') = '' then
    raise exception 'This project step needs a title';
  end if;

  insert into public.tasks(title, assignee_ids, due_date, due_timezone, created_by)
  values (item ->> 'text', array[auth.uid()], p_due_date, p_due_timezone, auth.uid())
  returning id into task_id;
  update public.cork_notes
  set roadmap_items = jsonb_set(note.roadmap_items,
    array[item_index::text, 'taskId'], to_jsonb(task_id::text), true)
  where id = note.id;
  if not found then
    raise exception 'Could not link this task to its project';
  end if;
  return task_id;
end;
$$;
revoke all on function public.add_roadmap_item_task(uuid,text,timestamptz,text) from public, anon;
grant execute on function public.add_roadmap_item_task(uuid,text,timestamptz,text) to authenticated;
commit;

-- ===========================================================================
-- Rental visits (incremental migration, Oct 2026) — mirrored from
-- supabase/add-rental-visits.sql, which is what an existing project runs.
-- ===========================================================================
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

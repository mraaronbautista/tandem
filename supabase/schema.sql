-- Tandem schema: shared task board for exactly two accounts (you + Ada).
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a fresh project.

create extension if not exists pgcrypto;

create type task_status as enum ('to_do', 'in_progress', 'done');
create type task_who as enum ('yours', 'assistant');
create type task_priority as enum ('low', 'med', 'high');
create type task_source as enum ('teams', 'email', 'none');
create type task_recurrence as enum (
  'none', 'daily', 'weekly', 'selected_weekdays', 'biweekly', 'every_3_weeks', 'monthly',
  'every_2_months', 'quarterly', 'every_6_months', 'annually'
);

-- Allowlist of the exactly-two accounts permitted to use the app.
-- Populate this manually after inviting each account via Supabase Auth.
create table members (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  -- Nullable timestamp rather than a plain boolean: doubles as the on/off
  -- flag (is/isn't null) and lets the UI show "working since 2:15 PM" for
  -- free, with no second column that could drift out of sync.
  working_since timestamptz,
  -- IANA zone this person's own tasks/schedules should default to (set via
  -- SettingsMenu.jsx) — null means "not set yet", falling back to
  -- timezone.js's device-detection/hardcoded default, same as before this
  -- column existed. Lives here rather than a per-device localStorage value
  -- (like theme) because it has to be mutually visible — the other person
  -- needs to see it too when bulk-adding *your* schedule for you.
  default_timezone text
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  who task_who not null default 'yours',
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
  -- server-side logic — spawn_next_recurrence() doesn't reference it, so
  -- a recurring task's next occurrence starts with an empty thread rather
  -- than carrying forward a past occurrence's Q&A.
  clarifications jsonb not null default '[]'::jsonb
);

create index tasks_status_idx on tasks (status);
create index tasks_due_date_idx on tasks (due_date);
create unique index tasks_recurrence_series_due_unique
  on tasks (recurrence_series_id, due_date)
  where recurrence_series_id is not null and due_date is not null;

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

-- Recurrence: when a recurring task is completed, spawn the next occurrence
-- with its due date rolled forward. Occurrences only appear once the prior
-- one is marked done, not generated ahead of time.
create or replace function spawn_next_recurrence()
returns trigger as $$
declare
  next_due timestamptz;
  reset_checklist jsonb;
  current_weekday integer;
  days_until_next integer;
begin
  if new.status = 'done' and old.status <> 'done'
     and new.recurrence <> 'none'
     and new.recurrence::text <> 'selected_weekdays' then
    next_due := case new.recurrence::text
      when 'daily' then coalesce(new.due_date, now()) + interval '1 day'
      when 'weekly' then coalesce(new.due_date, now()) + interval '7 days'
      when 'selected_weekdays' then null
      when 'biweekly' then coalesce(new.due_date, now()) + interval '14 days'
      when 'every_3_weeks' then coalesce(new.due_date, now()) + interval '21 days'
      when 'monthly' then coalesce(new.due_date, now()) + interval '1 month'
      when 'every_2_months' then coalesce(new.due_date, now()) + interval '2 months'
      when 'quarterly' then coalesce(new.due_date, now()) + interval '3 months'
      when 'every_6_months' then coalesce(new.due_date, now()) + interval '6 months'
      when 'annually' then coalesce(new.due_date, now()) + interval '1 year'
    end;

    if new.recurrence::text = 'selected_weekdays' then
      current_weekday := extract(dow from coalesce(new.due_date, now()) at time zone new.due_timezone)::integer;
      select min(((day_number::integer - current_weekday + 6) % 7) + 1)
        into days_until_next
        from unnest(new.recurrence_days) as selected_day(day_number);
      -- Add calendar days in the task's own zone so its selected wall time
      -- remains stable when daylight-saving time changes.
      next_due := (
        coalesce(new.due_date, now()) at time zone new.due_timezone
        + make_interval(days => days_until_next)
      ) at time zone new.due_timezone;
    end if;

    -- Carry over checklist item text to the next occurrence, but unchecked —
    -- it's a fresh instance of the recurring task, not a continuation.
    select coalesce(jsonb_agg(jsonb_set(item, '{done}', 'false')), '[]'::jsonb)
      into reset_checklist
      from jsonb_array_elements(new.checklist) as item;

    insert into tasks (
      title, who, priority, due_date, due_timezone, duration_minutes, source, source_note, notes, checklist, recurrence, recurrence_days, created_by
    ) values (
      new.title, new.who, new.priority, next_due, new.due_timezone, new.duration_minutes, new.source, new.source_note, new.notes, reset_checklist, new.recurrence, new.recurrence_days, new.created_by
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger tasks_spawn_recurrence
after update on tasks
for each row execute function spawn_next_recurrence();

-- Selected-weekday schedules are materialized for the current calendar
-- month so Month view can show the whole schedule in advance.
create or replace function prepare_recurrence_series()
returns trigger as $$
begin
  if new.recurrence::text = 'selected_weekdays' and new.recurrence_series_id is null then
    new.recurrence_series_id := new.id;
  elsif new.recurrence::text <> 'selected_weekdays' and new.recurrence_series_id = new.id then
    new.recurrence_series_id := null;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger tasks_prepare_recurrence_series
before insert or update of recurrence, recurrence_days on tasks
for each row execute function prepare_recurrence_series();

create or replace function generate_current_month_occurrences(template_id uuid)
returns void as $$
declare
  template tasks%rowtype;
  month_start date;
  month_end date;
  wall_time time;
  assignee_id uuid;
begin
  select * into template from tasks where id = template_id;
  if not found or template.recurrence::text <> 'selected_weekdays'
     or template.recurrence_series_id <> template.id or template.due_date is null then
    return;
  end if;
  month_start := date_trunc('month', now() at time zone template.due_timezone)::date;
  month_end := (month_start + interval '1 month - 1 day')::date;
  wall_time := (template.due_date at time zone template.due_timezone)::time;
  select id into assignee_id from members
  where lower(display_name) = case when template.who = 'assistant' then 'aaron' else 'ada' end
  limit 1;
  insert into tasks (
    title, who, priority, icon, due_date, due_timezone, duration_minutes,
    source, source_note, notes, checklist, recurrence, recurrence_days,
    created_by, recurrence_series_id
  )
  select template.title, template.who, template.priority, template.icon,
    (day_stamp::date + wall_time) at time zone template.due_timezone,
    template.due_timezone, template.duration_minutes, template.source,
    template.source_note, template.notes, template.checklist,
    template.recurrence, template.recurrence_days,
    coalesce(assignee_id, template.created_by), template.id
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
end;
$$ language plpgsql security definer;

create or replace function sync_current_month_recurrences()
returns trigger as $$
begin
  if tg_op = 'UPDATE' and old.recurrence_series_id = old.id and (
    new.recurrence::text <> 'selected_weekdays'
    or new.due_date is distinct from old.due_date
    or new.due_timezone is distinct from old.due_timezone
    or new.recurrence_days is distinct from old.recurrence_days
  ) then
    perform set_config('app.recurrence_sync', '1', true);
    delete from tasks where recurrence_series_id = old.id and id <> old.id and status <> 'done';
    perform set_config('app.recurrence_sync', '0', true);
  end if;
  if new.recurrence::text = 'selected_weekdays' and new.recurrence_series_id = new.id then
    perform generate_current_month_occurrences(new.id);
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger tasks_sync_current_month_recurrences
after insert or update of recurrence, recurrence_days, due_date, due_timezone on tasks
for each row execute function sync_current_month_recurrences();

create or replace function ensure_current_month_recurrences()
returns void as $$
declare template_id uuid;
begin
  if not exists (select 1 from members where id = auth.uid()) then
    raise exception 'Not authorized';
  end if;
  for template_id in select id from tasks
    where recurrence::text = 'selected_weekdays' and recurrence_series_id = id
  loop
    perform generate_current_month_occurrences(template_id);
  end loop;
end;
$$ language plpgsql security definer;

-- RLS: both allow-listed members get full read/write on the shared board.
-- Mutual visibility is the entire point of this app, so there is no
-- per-row ownership check beyond "is this one of our two accounts."
alter table members enable row level security;
alter table tasks enable row level security;

-- security definer so checking "is caller a member" doesn't recursively
-- re-trigger RLS on the members table it queries.
create or replace function is_member()
returns boolean as $$
  select exists (select 1 from members where id = auth.uid());
$$ language sql security definer stable;

-- Both members can see each other's display name — needed for the greeting
-- and task attribution features.
create policy "members can read all members"
  on members for select
  using (is_member());

create policy "members can read all tasks"
  on tasks for select
  using (is_member());

create policy "members can insert tasks"
  on tasks for insert
  with check (is_member());

create policy "members can update tasks"
  on tasks for update
  using (is_member());

create policy "members can delete tasks"
  on tasks for delete
  using (is_member());

-- Storage bucket for optional completion screenshots/photos. Public
-- (read) since these are casual task attachments, not sensitive
-- documents — a public bucket also means getPublicUrl() works directly
-- with no signed-URL/expiry logic needed client-side. Writes are still
-- restricted to the two allow-listed members.
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

create policy "members can read all eod reports"
  on eod_reports for select
  using (is_member());

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

-- Priorities for the upcoming day/week/month — a shared planning note,
-- not a personal log like eod_reports, so both members can set it (unlike
-- eod_reports which is Aaron's own work log). Append-only: each save is a
-- new row, most recent per period is "current"; querying history is free
-- rather than needing its own table later.
create table priorities (
  id uuid primary key default gen_random_uuid(),
  set_by uuid not null references members (id),
  period report_period not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table priorities enable row level security;

create policy "members can read all priorities"
  on priorities for select
  using (is_member());

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

create table rental_properties (
  id uuid primary key default gen_random_uuid(),
  company rental_company not null,
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

  insert into tasks (
    title, who, priority, due_date, due_timezone, source, notes, checklist,
    created_by, rental_turnover_booking_id
  ) values (
    'Schedule turnover cleaning for ' || property_name,
    'assistant',
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
    who = 'assistant';

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
  using (is_member());

create policy "members can insert rental properties"
  on rental_properties for insert
  with check (is_member());

create policy "members can update rental properties"
  on rental_properties for update
  using (is_member());

create policy "members can delete rental properties"
  on rental_properties for delete
  using (is_member());

create policy "members can read all rental bookings"
  on rental_bookings for select
  using (is_member());

create policy "members can insert rental bookings"
  on rental_bookings for insert
  with check (is_member());

create policy "members can update rental bookings"
  on rental_bookings for update
  using (is_member());

create policy "members can delete rental bookings"
  on rental_bookings for delete
  using (is_member());

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
  using (is_member());

create policy "members can insert rental expenses"
  on rental_expenses for insert
  with check (is_member());

create policy "members can update rental expenses"
  on rental_expenses for update
  using (is_member());

create policy "members can delete rental expenses"
  on rental_expenses for delete
  using (is_member());

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
  using (is_member());

create policy "members can insert rental savings goals"
  on rental_savings_goal for insert
  with check (is_member());

create policy "members can update rental savings goals"
  on rental_savings_goal for update
  using (is_member());

create policy "members can delete rental savings goals"
  on rental_savings_goal for delete
  using (is_member());

-- Shared password vault, encrypted client-side (AES-GCM, key derived from
-- a master password via PBKDF2) before anything ever reaches Supabase —
-- both members share one master password, consistent with everything
-- else in this app being mutually visible. RLS here only governs who can
-- read/write ciphertext; it is not the security boundary for the
-- passwords themselves, the encryption is. A single row: salt for key
-- derivation, plus a canary ciphertext that lets a later unlock attempt
-- verify the master password before any real entry exists to test
-- against. Delete policy exists for the forgot-password reset flow
-- (there is no recovery path by design, so resetting is the only way
-- out of a forgotten master password).
create table vault_meta (
  id uuid primary key default gen_random_uuid(),
  salt text not null,
  canary_ciphertext text not null,
  canary_iv text not null,
  created_at timestamptz not null default now()
);

-- Enforces "at most one row" at the database level. Without this, two
-- people opening the never-set-up vault at the same time and both
-- submitting "Set up vault" both succeed, leaving vault_meta with two
-- rows — the client's .maybeSingle() fetch then errors on ">1 row" and
-- the vault gets stuck on a permanent error screen with no way back in.
-- A constant expression in a unique index means every row collides with
-- every other row, so the second insert now fails cleanly instead.
create unique index vault_meta_singleton on vault_meta ((true));

alter table vault_meta enable row level security;

create policy "members can read vault meta"
  on vault_meta for select
  using (is_member());

create policy "members can insert vault meta"
  on vault_meta for insert
  with check (is_member());

create policy "members can delete vault meta"
  on vault_meta for delete
  using (is_member());

-- One row per credential. `ciphertext` decrypts (with the vault key) to
-- one JSON blob `{ label, username, loginMethod, password, url, notes }`
-- (loginMethod is set instead of password for accounts with no password
-- of their own, e.g. "Sign in with Google") — the label is encrypted too,
-- not just the password, since even knowing an entry called "Chase Bank"
-- exists is sensitive metadata worth not leaking to anyone with database
-- access.
create table vault_entries (
  id uuid primary key default gen_random_uuid(),
  ciphertext text not null,
  iv text not null,
  created_by uuid not null references members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table vault_entries enable row level security;

create policy "members can read all vault entries"
  on vault_entries for select
  using (is_member());

create policy "members can insert vault entries"
  on vault_entries for insert
  with check (is_member());

create policy "members can update vault entries"
  on vault_entries for update
  using (is_member());

create policy "members can delete vault entries"
  on vault_entries for delete
  using (is_member());

-- Cork Board: quick pins with no due date, no timeline — the opposite of
-- a task, which is deliberately scheduled. This is the one place in the
-- app where visibility is NOT automatically mutual: `shared` decides
-- whether the other member can see a given pin at all, not just whether
-- they can edit it, so the select policy (not just insert/update/delete)
-- checks it. Only the author can edit or delete their own pin, even once
-- shared — the other person can see it, not manage it.
create table cork_notes (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references members (id),
  body text not null,
  shared boolean not null default false,
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
  using (is_member() and (shared or author_id = auth.uid()));

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
-- rule (own or shared) so a member still can't comment on a pin they
-- can't see. Only ever touches the comments column, never body/shared,
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
    and (shared or author_id = auth.uid())
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
-- staff tab / StaffLogsView.jsx). staff/work_sites don't need this —
-- they change rarely enough that an explicit reload after an admin
-- edit, same pattern archiveRentalProperty already uses, is enough.

create type staff_rate_type as enum ('standard', 'emergency');
create type time_entry_status as enum ('pending', 'approved');

-- Mirrors members' shape (id -> auth.users, display_name) but is its
-- own table — populate manually after inviting the account via
-- Supabase Auth, same as members itself.
create table staff (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  hourly_rate numeric(10, 2) not null default 20,
  emergency_rate numeric(10, 2) not null default 25,
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
  using (is_member());

create policy "staff can read own row"
  on staff for select
  using (id = auth.uid());

create policy "members can insert staff"
  on staff for insert
  with check (is_member());

create policy "members can update staff"
  on staff for update
  using (is_member())
  with check (is_member());

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
  using (is_member());

-- Staff only ever needs active sites to clock in at — an archived
-- site shouldn't appear in their nearest-site picker.
create policy "staff can read active work sites"
  on work_sites for select
  using (is_staff() and active);

create policy "members can insert work sites"
  on work_sites for insert
  with check (is_member());

create policy "members can update work sites"
  on work_sites for update
  using (is_member())
  with check (is_member());

create policy "members can delete work sites"
  on work_sites for delete
  using (is_member());

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
  using (is_member() or staff_id = auth.uid());

create policy "staff can clock in"
  on time_entries for insert
  with check (staff_id = auth.uid() and is_staff());

-- No UPDATE policy for staff at all — clock-out goes exclusively
-- through staff_clock_out() below. A raw UPDATE grant to staff would
-- let them rewrite status/approved_by/rate_type after the fact; this
-- way that's structurally impossible, not just discouraged by the UI.
create policy "members can update time entries"
  on time_entries for update
  using (is_member())
  with check (is_member());

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

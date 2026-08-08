-- Tandem schema: shared task board for exactly two accounts (you + Ada).
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a fresh project.

create extension if not exists pgcrypto;

create type task_status as enum ('to_do', 'in_progress', 'done');
create type task_who as enum ('yours', 'assistant');
create type task_priority as enum ('low', 'med', 'high');
create type task_source as enum ('teams', 'email', 'none');
create type task_recurrence as enum ('none', 'daily', 'weekly', 'monthly');

-- Allowlist of the exactly-two accounts permitted to use the app.
-- Populate this manually after inviting each account via Supabase Auth.
create table members (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  -- Nullable timestamp rather than a plain boolean: doubles as the on/off
  -- flag (is/isn't null) and lets the UI show "working since 2:15 PM" for
  -- free, with no second column that could drift out of sync.
  working_since timestamptz
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  who task_who not null default 'yours',
  status task_status not null default 'to_do',
  priority task_priority not null default 'med',
  due_date timestamptz,
  -- IANA zone the due_date's wall-clock time was set in (e.g. picking
  -- "3:00 PM" while this is 'America/New_York' means 3pm Eastern, not 3pm
  -- in whichever timezone the browser that created it happened to be in).
  -- Needed to redisplay the same intended time consistently for both of you.
  due_timezone text not null default 'America/New_York',
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
  reminder_sent_at timestamptz
);

create index tasks_status_idx on tasks (status);
create index tasks_due_date_idx on tasks (due_date);

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
begin
  if new.status = 'done' and old.status <> 'done' and new.recurrence <> 'none' then
    next_due := case new.recurrence
      when 'daily' then coalesce(new.due_date, now()) + interval '1 day'
      when 'weekly' then coalesce(new.due_date, now()) + interval '7 days'
      when 'monthly' then coalesce(new.due_date, now()) + interval '1 month'
    end;

    -- Carry over checklist item text to the next occurrence, but unchecked —
    -- it's a fresh instance of the recurring task, not a continuation.
    select coalesce(jsonb_agg(jsonb_set(item, '{done}', 'false')), '[]'::jsonb)
      into reset_checklist
      from jsonb_array_elements(new.checklist) as item;

    insert into tasks (
      title, who, priority, due_date, due_timezone, duration_minutes, source, source_note, notes, checklist, recurrence, created_by
    ) values (
      new.title, new.who, new.priority, next_due, new.due_timezone, new.duration_minutes, new.source, new.source_note, new.notes, reset_checklist, new.recurrence, new.created_by
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger tasks_spawn_recurrence
after update on tasks
for each row execute function spawn_next_recurrence();

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

-- End-of-day/week/month reports: manually submitted, auto-tallied from
-- that period's completed tasks but editable before sending. Persisted
-- (not just a fire-and-forget push) since push delivery is best-effort —
-- losing the report entirely if the notification doesn't land defeats
-- the point, especially once it's tracking logged minutes. One row per
-- (submitted_by, period, report_date) — a work day rarely happens in one
-- sitting, so later submissions the same day append to the existing
-- row's body (see upsert_eod_report below) rather than creating a new,
-- disconnected row per session.
create type report_period as enum ('day', 'week', 'month');

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
  p_minutes_logged integer
) returns eod_reports
language plpgsql
security invoker
as $$
declare
  result eod_reports;
begin
  insert into eod_reports (submitted_by, period, report_date, minutes_logged, body, updated_at)
  values (auth.uid(), p_period, p_report_date, p_minutes_logged, coalesce(p_body_chunk, ''), now())
  on conflict (submitted_by, period, report_date)
  do update set
    body = case
      when p_body_chunk is null or btrim(p_body_chunk) = '' then eod_reports.body
      else eod_reports.body || E'\n\n---\n' || p_body_chunk
    end,
    minutes_logged = coalesce(p_minutes_logged, eod_reports.minutes_logged),
    updated_at = now()
  returning * into result;
  return result;
end;
$$;

grant execute on function upsert_eod_report(report_period, date, text, integer) to authenticated;

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
  created_by uuid not null references members (id),
  created_at timestamptz not null default now(),
  constraint rental_bookings_dates_check check (check_out >= check_in)
);

create index rental_bookings_property_id_idx on rental_bookings (property_id);
create index rental_bookings_range_idx on rental_bookings (check_in, check_out);

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

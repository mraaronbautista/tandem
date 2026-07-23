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
  display_name text not null
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

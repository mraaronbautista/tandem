-- ---------------------------------------------------------------------------
-- External tools (incremental migration) — Oct 2026
-- ---------------------------------------------------------------------------
-- Run once in the Supabase SQL Editor. NOT applied by the assistant.
-- Idempotent: safe to re-run.
--
-- A short list of outside tools (today: Dallas Property Finder) that appear
-- as rows in Tandem's Settings and open full screen inside the app. The
-- address of each tool lives ONLY in this table, never in the app's code, so
-- it is not sitting in a public JavaScript file: a row can be read only by
-- the members listed in its member_ids. Nobody can add, change or remove rows
-- from the app — there are deliberately no insert/update/delete policies — so
-- rows are managed here, in the SQL editor.

create table if not exists external_tools (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  -- One short line shown under the title in Settings.
  description text,
  -- https only: a frame served over plain http is blocked inside the https app.
  url text not null check (url ~ '^https://'),
  sort_order integer not null default 0,
  -- An allow-list, unlike members.permissions (a deny-list): only these
  -- members get the row at all. Staff accounts are not members, so they never do.
  member_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table external_tools enable row level security;

drop policy if exists "listed members can read external tools" on external_tools;
create policy "listed members can read external tools"
  on external_tools for select
  using (is_member() and auth.uid() = any(member_ids));

revoke all on external_tools from anon;

-- ---------------------------------------------------------------------------
-- Add Dallas Property Finder. EDIT THE URL FIRST, then run this statement.
-- It is limited to Ada and Aaron by display name. Re-running it does nothing
-- once a row with this title exists.
-- ---------------------------------------------------------------------------
insert into external_tools (title, description, url, member_ids)
select 'Dallas Property Finder',
       'Search Dallas listings and share picks',
       'https://REPLACE-WITH-THE-SITE-ADDRESS',
       array(select id from members where lower(display_name) in ('ada', 'aaron'))
where not exists (select 1 from external_tools where title = 'Dallas Property Finder');

-- ---------------------------------------------------------------------------
-- Check it (read-only): you should see one row, with 2 people and your real
-- address. If the address still says REPLACE-WITH-THE-SITE-ADDRESS, fix it with:
--   update external_tools set url = 'https://your-real-address'
--   where title = 'Dallas Property Finder';
-- ---------------------------------------------------------------------------
select title, url, cardinality(member_ids) as people_who_can_see_it
from external_tools
order by sort_order, title;

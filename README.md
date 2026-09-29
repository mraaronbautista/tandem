# Tandem

Shared task board for Ada's team — one place to drop requests, see status, and know what's in motion without checking in. Started as exactly Ada and Aaron; the schema and frontend now support any number of member accounts, each with their own feature permissions (Rentals/Vault/Staff/Reports) and per-pair task visibility — see `CLAUDE.md`'s "Members, permissions, and task access" section for how that actually works.

## Stack

- **Frontend:** React + Vite, deployed to Netlify
- **Backend:** Supabase (Postgres + Auth + Realtime), free tier
- No public sign-up — accounts are invite-only. The very first admin account still has to be created by hand (see setup below), but once one exists, adding any account after that can be done in-app (Settings → Manage member access → Add member) instead of the SQL editor.

## First-time setup

### 1. Create the Supabase project

1. Create a new project at [supabase.com](https://supabase.com).
2. In the SQL editor, run [`supabase/schema.sql`](supabase/schema.sql). This creates the `tasks` table, the `members` allowlist, `task_access`, and the RLS policies that restrict the whole app to allow-listed member accounts.
3. Under **Authentication → Providers**, make sure **Email** is enabled and **Confirm email** / magic link (OTP) is on.
4. Under **Authentication → Settings**, turn **off** "Allow new users to sign up" — accounts are invite-only.
5. Under **Authentication → Users**, click **Invite user** for the first account or two you're setting up (you and Ada, at minimum — at least one needs to end up `is_admin`). This sends a magic link and creates the `auth.users` row. **Anyone joining after that** doesn't need this manual step at all — once an `is_admin` account exists, sign in and use Settings → Manage member access → Add member in the app itself, which handles both the Auth account and the `members` row together. The steps below are only for bootstrapping the first account(s) on a brand-new project, before any admin exists to use that screen.
6. Back in the SQL editor, add each account to the allowlist (swap in the real UUID from `auth.users`, a display name, and a badge color — a few unused ones: `#7d6ab8` purple, `#4a9d6f` green, `#c17a3a` orange). `permissions` defaults to `{}` (full access) when omitted — only set it to restrict a member from Rentals/Vault/Staff/EOD-report submission. `is_admin` controls who can manage other members' access; make at least one account `true`:

   ```sql
   insert into members (id, display_name, color, is_admin) values
     ('00000000-0000-0000-0000-000000000001', 'Aaron', '#4a7ba6', true),
     ('00000000-0000-0000-0000-000000000002', 'Ada', '#a8567e', false);

   -- A restricted member (e.g. a healthcare VA who shouldn't see Ada's
   -- rental business or the shared vault) instead sets permissions:
   -- insert into members (id, display_name, color, permissions) values
   --   ('00000000-0000-0000-0000-000000000003', 'New hire', '#7d6ab8',
   --    '{"rentals": false, "vault": false, "staff": false}'::jsonb);
   ```

7. A new member starts with **no visibility into anyone else's tasks, and no one has visibility into hers** — except every existing `is_admin` account automatically gets view & update access to her tasks the moment her row is inserted (no extra step). To grant visibility in the other direction (e.g. let her see an existing member's tasks too), insert a row into `task_access` by hand:

   ```sql
   insert into task_access (viewer_id, target_id, level) values
     ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'view');
   ```

   See `CLAUDE.md`'s "Members, permissions, and task access" section for the full model (view vs. update, and the separate create/delete/reassign grants). This step is only needed for the manual-bootstrap path above — the in-app Add Member flow already prompts for a new member's task visibility toward each existing member as its second step, right after the account itself is created.
8. Copy the **Project URL** and **anon public key** from **Settings → API** — you'll need them next.

### 2. Configure the frontend

```bash
cp .env.example .env
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from step 1.8.

```bash
npm install
npm run dev
```

### 3. Deploy to Netlify

1. Push this project to a git repo and connect it in Netlify, **or** run `netlify deploy` from the CLI.
2. Build command: `npm run build`. Publish directory: `dist`.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Netlify environment variables (Site settings → Environment variables) — the `.env` file itself is never deployed.

### 4. Add to home screen

Once deployed, open the Netlify URL in Safari (iOS) → Share → **Add to Home Screen**. The app opens standalone, without Safari's browser chrome, using the icon and name from `public/manifest.json`.

## Notes on scope

- **Attachments:** no file upload — tasks carry an optional "sent via Teams/Email" tag plus a free-text note (filename, message context) so you know where to look.
- **Recurrence:** the next occurrence of a repeating task is only created once the current one is marked Done (not pre-generated ahead of time). Recurrence can use a fixed interval or selected weekdays such as Tuesday and Thursday.
- **Calendar:** intentionally out of scope for now — coordinate scheduling manually via Teams.

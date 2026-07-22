# PsyberScribe

Shared task board for Ada and Aaron — one place to drop requests, see status, and know what's in motion without checking in.

## Stack

- **Frontend:** React + Vite, deployed to Netlify
- **Backend:** Supabase (Postgres + Auth + Realtime), free tier
- Exactly two accounts allowed — no public sign-up

## First-time setup

### 1. Create the Supabase project

1. Create a new project at [supabase.com](https://supabase.com).
2. In the SQL editor, run [`supabase/schema.sql`](supabase/schema.sql). This creates the `tasks` table, the `members` allowlist, and the RLS policies that restrict the whole app to your two accounts.
3. Under **Authentication → Providers**, make sure **Email** is enabled and **Confirm email** / magic link (OTP) is on.
4. Under **Authentication → Settings**, turn **off** "Allow new users to sign up" — accounts are invite-only.
5. Under **Authentication → Users**, click **Invite user** for both your email and Ada's. This sends each of you a magic link and creates the `auth.users` row.
6. Back in the SQL editor, add both accounts to the allowlist (swap in the real UUIDs from `auth.users` and display names):

   ```sql
   insert into members (id, display_name) values
     ('00000000-0000-0000-0000-000000000001', 'Aaron'),
     ('00000000-0000-0000-0000-000000000002', 'Ada');
   ```

7. Copy the **Project URL** and **anon public key** from **Settings → API** — you'll need them next.

### 2. Configure the frontend

```bash
cp .env.example .env
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from step 1.7.

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
- **Recurrence:** the next occurrence of a repeating task is only created once the current one is marked Done (not pre-generated ahead of time).
- **Calendar:** intentionally out of scope for now — coordinate scheduling manually via Teams.

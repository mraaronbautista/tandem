# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # install deps
npm run dev        # Vite dev server (http://localhost:5173)
npm run build       # production build to dist/
npm run preview      # preview the production build
npm run lint        # oxlint (react + oxc rule sets, config in .oxlintrc.json)
```

There is no test suite in this repo.

Local dev needs `.env` (copy from `.env.example`) with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` pointing at a Supabase project that has `supabase/schema.sql` applied — see README.md for the full first-time setup (creating the project, inviting the two accounts, seeding `members`, deploying to Netlify).

## What this app is

A shared task board for exactly two named people — Ada and Aaron — not a generic multi-user product. That two-person assumption is baked into the schema (no signup flow, a hardcoded `members` allowlist) and into the frontend (`src/lib/whoLabels.js` hardcodes the `who` ↔ display-name mapping). Don't generalize this to arbitrary users without deliberately revisiting both layers.

## Architecture

**Stack:** React 19 + Vite, no router (despite `react-router-dom` being a listed dependency — it's unused; `App.jsx` just conditionally renders `Login` or `TaskBoard` based on session state). Backend is Supabase (Postgres + Auth + Realtime) on the free tier, accessed directly from the client via `src/lib/supabaseClient.js` — there is no separate API server.

**Auth:** Password sign-in (`supabase.auth.signInWithPassword`) is the default in `Login.jsx`, with magic link (`signInWithOtp`) available as a fallback via a toggle — magic link requires bouncing through the device's default browser to click the email link, which can't complete at all inside an iOS "Add to Home Screen" install (isolated storage, no address bar to land the redirect in), so password is the one that reliably works everywhere. Invite-only either way — public signup is disabled at the Supabase project level, not in this code. `src/lib/AuthContext.jsx` wraps the app and exposes `session`/`loading`/`signOut`.

**The two-account model:** `supabase/schema.sql` has a `members` table (id references `auth.users`, plus `display_name`) that acts as the allowlist — RLS on both `members` and `tasks` checks membership via the `is_member()` SQL function (a `security definer` function, needed so checking "is caller a member" against the `members` table doesn't recursively re-trigger RLS on that same table). Both members get full read/write on everything; there's no per-row ownership check, because mutual visibility of each other's tasks is the entire point of the app.

The `tasks.who` column is a `yours`/`assistant` enum tied to a fixed correspondence (`yours` = Ada, `assistant` = Aaron) defined once in `src/lib/whoLabels.js` (`WHO_LABEL`, `WHO_COLOR`, `whoKeyForName`) — this mapping is not stored in the database, so if either person's name ever changes, this file is the only place to update.

**Status is simpler than the schema suggests:** `tasks.status` is still a 3-value enum (`to_do` / `in_progress` / `done`) in Postgres, but the UI only exposes a done/not-done checkbox (`TaskRow.jsx`) — `in_progress` is vestigial and not reachable from the current UI. Don't be surprised to see it in the schema with no corresponding UI control.

**Checklist:** subtasks are a `jsonb` array column (`tasks.checklist`, shape `[{ id, text, done }]`) rather than a child table — deliberately, since a handful of checklist items per task didn't justify its own relation, RLS policies, and join logic.

**Recurrence:** handled entirely in Postgres (`spawn_next_recurrence()` trigger in `schema.sql`), not in the client. It fires on the transition into `status = 'done'` and inserts the next occurrence with the due date rolled forward and the checklist reset to unchecked. The next occurrence only appears once the current one is completed — it is not pre-generated ahead of time.

**Daily-planner grouping:** `groupByDueDate()` in `src/lib/tasks.js` buckets the active (not-done) tasks into `allDay` / `overdue` / `today` / `upcoming`. `TaskBoard.jsx` renders these as, respectively: compact chips (`AllDayRow.jsx`), a Structured-app-style vertical timeline with time labels and connecting lines (`TimelineRow.jsx`), the same timeline again, and a plain list (`TaskRow.jsx`). Overdue is intentionally its own bucket, never folded into "today."

**Realtime:** `TaskBoard.jsx` subscribes to a Supabase Postgres-changes channel on the `tasks` table and just refetches the entire task list on any change — no granular client-side diffing/merging.

**Forms:** `TaskForm.jsx` is shared between creating a task (`NewTaskForm.jsx`, opened from the floating "+" button via `Modal.jsx`) and editing one (rendered inline in place of the row inside `TaskRow.jsx`). Due date/time are edited as separate `due_date` (date) + `due_time` (30-minute-increment select) fields and combined into one ISO timestamp on submit (`splitDueDate`/`TIME_OPTIONS` in `TaskForm.jsx`) — the database only ever sees a single `due_date` timestamptz.

**Modal:** `Modal.jsx` is a generic overlay (centered on desktop, slides up as a bottom sheet on mobile via a CSS media query, no JS breakpoint logic) reused for both the new-task form and for "peeking" at a task from an All Day chip (`TaskRow` rendered with `defaultOpen` inside the modal).

**Theming:** CSS custom properties in `src/index.css`, switched via a `data-theme` attribute on `<html>` (`src/lib/useTheme.js`, persisted to `localStorage`). The explicit theme choice must also set the CSS `color-scheme` property (already done in the `:root[data-theme=...]` blocks) — otherwise native form controls (checkboxes, date/time inputs) render using the OS-level theme instead of the app's, regardless of what colors the rest of the page uses.

**Deployment:** Netlify (static frontend, env vars set in Netlify's dashboard) + Supabase (schema applied by hand via the SQL editor, not a migration tool). See README.md for the step-by-step.

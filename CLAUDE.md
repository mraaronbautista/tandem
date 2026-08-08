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

Local dev needs `.env` (copy from `.env.example`) with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_VAPID_PUBLIC_KEY` pointing at a Supabase project that has `supabase/schema.sql` applied — see README.md for the full first-time setup (creating the project, inviting the two accounts, seeding `members`, deploying to Netlify).

Supabase Edge Functions (`supabase/functions/`) are deployed independently of the frontend — `supabase functions deploy <name>` — and are **not** part of the Vite build or a Netlify deploy. All three are deployed with `--no-verify-jwt` (see Push notifications below for why `manual-notify` needs it too, despite being the one function that actually cares who's calling).

## What this app is

A shared task board for exactly two named people — Ada and Aaron — not a generic multi-user product. That two-person assumption is baked into the schema (no signup flow, a hardcoded `members` allowlist) and into the frontend (`src/lib/whoLabels.js` hardcodes the `who` ↔ display-name mapping). Don't generalize this to arbitrary users without deliberately revisiting both layers — several later features (priorities, working status, notification rules) are explicitly asymmetric between the two people by design, not an oversight.

## Architecture

**Stack:** React 19 + Vite, no router (despite `react-router-dom` being a listed dependency — it's unused; `App.jsx` just conditionally renders `Login` or `TaskBoard` based on session state). Backend is Supabase (Postgres + Auth + Realtime + Storage + Edge Functions) on the free tier, accessed directly from the client via `src/lib/supabaseClient.js` — there is no separate API server, except for the Edge Functions described below.

**Auth:** Password sign-in (`supabase.auth.signInWithPassword`) is the default in `Login.jsx`, with magic link (`signInWithOtp`) available as a fallback via a toggle — magic link requires bouncing through the device's default browser to click the email link, which can't complete at all inside an iOS "Add to Home Screen" install (isolated storage, no address bar to land the redirect in), so password is the one that reliably works everywhere. Invite-only either way — public signup is disabled at the Supabase project level, not in this code. `src/lib/AuthContext.jsx` wraps the app and exposes `session`/`loading`/`signOut`.

**The two-account model:** `supabase/schema.sql` has a `members` table (id references `auth.users`, plus `display_name`) that acts as the allowlist — RLS on `members`/`tasks`/most other tables checks membership via the `is_member()` SQL function (`security definer`, needed so checking "is caller a member" against `members` doesn't recursively re-trigger RLS on that same table). Both members get full read/write on shared data; there's no per-row ownership check on `tasks`, because mutual visibility is the entire point of the app. A few newer tables (`eod_reports`) *do* restrict writes to your own `submitted_by` — see End-of-day reports below.

The `tasks.who` column is a `yours`/`assistant` enum tied to a fixed correspondence (`yours` = Ada, `assistant` = Aaron) defined once in `src/lib/whoLabels.js` (`WHO_LABEL`, `WHO_COLOR`, `whoKeyForName`) — this mapping is not stored in the database, so if either person's name ever changes, this file is the only place to update. Several server-side Edge Functions independently re-derive this same mapping via `resolveMemberIds()` (see Push notifications) since they can't import frontend code.

**Status is simpler than the schema suggests:** `tasks.status` is still a 3-value enum (`to_do` / `in_progress` / `done`) in Postgres, but the UI only exposes a done/not-done checkbox (`TaskRow.jsx`) — `in_progress` is vestigial and not reachable from the current UI.

**Checklist:** subtasks are a `jsonb` array column (`tasks.checklist`, shape `[{ id, text, done, blocked, blockedReason }]`) rather than a child table. `blocked`/`blockedReason` mark an item as not accomplishable (e.g. a requirement that turned out to be impossible), with an optional reason; blocked and done are mutually exclusive (setting one clears the other) in both `ChecklistEditor.jsx` (create/edit form, purely local state) and `ChecklistView.jsx` (task detail, writes straight to Supabase on every change). The reason `<input>` in `ChecklistView.jsx` keeps local draft state and only persists `onBlur`, not per-keystroke — wiring it directly to the per-change Supabase write made fast typing feel laggy/dropped, since every keystroke was round-tripping over the network before the input reflected it.

**All Day tasks:** `due_date IS NULL`. Created via an explicit "All day" checkbox in `TaskForm.jsx`, not just by leaving the date field blank — the form tracks a separate `allDay` boolean, because a blank date *string* and "deliberately no date" needed to be distinguishable to fix a real bug where editing an existing All Day task and saving without touching the date field would silently give it today's date.

**Task duration:** `duration_minutes` (nullable) + `due_date` = start; the end time is always derived (`due_date + duration_minutes`), never stored separately, so it can't drift out of sync. Shown as a range, e.g. "5:30–6:10 PM (40 min)". `getOverlappingTaskIds()` in `tasks.js` flags two of the *same* person's timed tasks that intersect — cross-person overlaps are never flagged, since Ada and Aaron having tasks at the same time isn't a real conflict.

**Recurrence:** handled entirely in Postgres (`spawn_next_recurrence()` trigger in `schema.sql`), not in the client. Fires on the transition into `status = 'done'` and inserts the next occurrence with the due date rolled forward and the checklist reset to unchecked (including clearing any `blocked` state). The next occurrence only appears once the current one is completed — it is not pre-generated ahead of time.

**Daily-planner grouping:** inline in `TaskBoard.jsx`, using `getOverdueTasks()` and `getTasksForDay()` (both in `src/lib/tasks.js`) plus a simple `!due_date` filter for the All-Day bucket — rendered as, respectively, a plain list (`AllDayRow.jsx`), a Structured-app-style vertical timeline (`TimelineRow.jsx`) for Overdue, and the same timeline again for the selected day. A completed task is bucketed and positioned by `completed_at`, not its original `due_date` — this was deliberate and revisited more than once: Ada (Eastern) assigning a task at 3pm her time can land on what's already "yesterday" on Aaron's (Philippines, UTC+8) calendar, and if completed tasks stayed pinned to that original due day, finishing something today would make today's list look empty. The visible time *label* still always shows the original due time (`TaskRow.jsx`'s `dueLabel`) plus a small muted "Completed" tag — only which day's *list* it appears in follows completion time.

**Realtime:** `TaskBoard.jsx` subscribes to two Postgres-changes channels — `tasks-changes` and `members-changes` (the latter exists specifically so Ada's "Aaron is working" badge updates live) — each just refetches its whole table on any change, no granular diffing. A table must be explicitly added to the `supabase_realtime` publication (`alter publication supabase_realtime add table <name>`) before Realtime emits anything for it — this is not automatic on table creation and has been missed before.

**Forms:** `TaskForm.jsx` is shared between creating a task (`NewTaskForm.jsx`) and editing one (rendered inline in place of the row inside `TaskRow.jsx`). Due date/time are edited as separate `due_date` + `due_time` fields (plus an end-time/duration pair) and combined into one ISO timestamp on submit (`zonedTimeToUtcIso` in `src/lib/timezone.js`) — the database only ever sees a single `due_date` timestamptz plus `duration_minutes`.

**Modal:** `Modal.jsx` renders via a React portal straight onto `document.body`, not in place. This matters because a modal opened from *inside* another modal (e.g. the `ScrollSelect` time picker used inside the edit-task form) would otherwise sit nested deep in the outer modal's own DOM subtree — a `transform` on any ancestor (the mobile slide-up animation, for one) creates a new stacking context that traps `position:fixed` descendants regardless of z-index, so the inner modal could render behind sibling content instead of on top. The portal sidesteps this class of bug entirely rather than fighting it with z-index.

**ScrollSelect:** `src/components/ScrollSelect.jsx` is a `<select>` replacement for option lists too long for a native popover to handle reasonably (e.g. the task end-time picker, which lists every 15/30-minute mark up to 48 hours ahead) — opens through `Modal.jsx` (see above) rather than a custom absolutely-positioned panel, which broke down inside the task form's cramped multi-column flex-wrap layout.

**Theming:** CSS custom properties in `src/index.css`, switched via a `data-theme` attribute on `<html>` (`src/lib/useTheme.js`, persisted to `localStorage`). The explicit theme choice must also set the CSS `color-scheme` property — otherwise native form controls render using the OS-level theme regardless of the rest of the page.

## Push notifications

Web Push (VAPID), fully custom — no third-party push service. Three pieces shared across everything:
- `public/service-worker.js` — receives push events, shows the notification, handles tap-to-focus/open.
- `src/lib/pushNotifications.js` — client-side subscribe/unsubscribe; writes directly to the `push_subscriptions` table.
- `supabase/functions/_shared/notify.ts` — `resolveMemberIds()` (maps 'Ada'/'Aaron' `display_name` to member id via a service-role query) and `notifyMember(memberId, payload)` (sends via the `web-push` npm package, prunes dead subscriptions on a 404/410 response).

Three Edge Functions, two different trigger mechanisms, all deployed with `--no-verify-jwt`:
- `notify-task-events` — Database Webhook on `tasks` INSERT/UPDATE (assignment + completion pings). Only ever called server-to-server by Supabase's own webhook system, never a browser — `--no-verify-jwt` because there's no user session in that call at all.
- `notify-reminders` — pg_cron scheduled, checks for tasks due within 15 minutes (`tasks.reminder_sent_at` prevents re-notifying on later cron ticks). Same reasoning.
- `manual-notify` — the only one invoked **directly from the browser** (`supabase.functions.invoke()`, used by the end-of-day report form and the "nudge" button), and the only one that actually cares who's calling — but it still needs `--no-verify-jwt`. The platform's own JWT check runs on the CORS preflight (`OPTIONS`) request too, and preflights never carry an `Authorization` header, so with verification *on* the platform rejected the preflight before the real request ever went out, surfacing to the client as a generic "failed to send a request" with no useful error. `manual-notify` verifies the caller itself instead — a per-request Supabase client built from the forwarded `Authorization` header, `auth.getUser()` — and derives the notification target as "whoever isn't the caller," never trusting a client-supplied target. This is also the only function with a CORS concern (`_shared/cors.ts`), since it's the only one a browser ever preflights.

Notification rules are deliberately asymmetric (see `notify-task-events/index.ts`), not a general preference system: Aaron gets pinged immediately when Ada assigns him something; Ada does **not** get pinged at assignment time (only later, via the reminder) — specifically so Aaron queuing up a lot of tasks for her doesn't spam her. Completion pings are symmetric in both directions.

iOS specifics: web push only works from an installed Home Screen PWA (`manifest.json` + `apple-touch-icon`), iOS 16.4+ — a regular Safari tab can't receive push at all, and this is a hard platform limit, not something fixable in code.

## End-of-day / week / month reports

`eod_reports`: one row per `(submitted_by, period, report_date)` — **not** one row per submission. `report_date` is always computed client-side in the submitter's own local timezone (`reportDateForPeriod()` in `src/lib/tasks.js`) and passed explicitly; the column has no database-side default, deliberately, since a UTC-based default would silently bucket under the wrong calendar day for a meaningful part of every day for Aaron.

A later submission within the same bucket doesn't insert a new row — it upserts via the `upsert_eod_report()` Postgres function (`security invoker`, `insert ... on conflict ... do update`), called through `supabase.rpc()` rather than the client SDK's `.upsert()`, because the two data columns have different update semantics `.upsert()` can't express:
- `body` **appends** (old body + a `---`-separated new chunk) — a running log across multiple work sessions in the same day.
- `minutes_logged` **overwrites**, never summed — this mirrors an external time tracker's running total, which the submitter corrects to match, not something this app tallies from sessions itself. Leaving it blank on a given submission keeps whatever total was last set.

`EndOfDayReportForm.jsx` fetches the caller's own existing row for the selected bucket on open (`fetchOwnEodReport`) and, if one exists, shows it read-only above a fresh "add to this" textarea, seeding the auto-tally via `getCompletedSince(tasks, whoKey, existing.updated_at)` — only completions *since the last submission*, not the whole period again, so a second session's draft doesn't duplicate what an earlier session already reported. The push notification still fires on every submission, not just the first one for a bucket — the point is Ada seeing progress after each session.

## Priorities

`priorities` table — a shared planning note, unlike `eod_reports`: both Ada and Aaron can set it, since it's household planning rather than a personal log. Append-only: every save is a new row scoped to a `period` ('day'/'week'/'month'); "current" priorities for a period is just the most recent row for it (`fetchLatestPriorities()` in `src/lib/priorities.js`).

Saving also creates a real task per bullet item (`PrioritiesForm.jsx` → `createTask()`), not just the note — the point is that priorities stop being easy to set and forget. Day-period items get `due_date` set to today (so an unfinished one can go overdue like any other task); week/month items become All Day tasks (`due_date: null`), sticking around until done. The previous save's items are shown read-only and are never pre-filled into the editable list you're about to submit — otherwise reopening the form and saving again would recreate a task for every old item, not just anything new.

## Rentals (Awa Rentalz)

A side-feature bolted onto the task board: `RentalsView.jsx` (off the "+" speed-dial) tracks occupancy and finances for Ada's furnished-rental business. Hardcoded to `company: 'awa'` throughout the frontend even though the `rental_company` enum also has `'azu'` (Ada's mom's separate, unrelated rental business) — `azu` was added to the schema so it wouldn't require a migration later, but no UI exists for it yet; it's deliberately out of scope. All the `rental_*` tables use the same `is_member()` RLS as everything else — mutual visibility, no per-row ownership.

**Calendar** (`RentalCalendar.jsx`): shows one unit at a time via a dropdown, rendering a standard 7-column month grid — not a multi-unit Gantt-style timeline, which an earlier version tried and had to be scrapped (it needed a wider modal, which fought the mobile CSS reset and broke the layout on phones). `check_out` on `rental_bookings` is the *last occupied day, inclusive* — not a hotel-style departure day — so a single-day booking has `check_out = check_in`.

Bookings carry a `status` (`pending`/`confirmed`): a pending request (e.g. an inbound Airbnb inquiry) still blocks the unit's dates against a double-booking and renders as a diagonal-striped cell instead of a solid one, but never counts toward revenue until explicitly confirmed.

**Financials** (`RentalFinancials.jsx`): revenue is recognized by upfront charge cycle, not by calendar-day occupancy. `chargeDatesForBooking()` in `src/lib/rentals.js` models rent as paid roughly every 30 days starting at check-in (security-deposit/Airbnb-style upfront payment), so a guest who checked in Aug 15 doesn't generate a second month of "revenue" just for still being there in September. A later cycle only counts if there's an actual day of stay left beyond it — this fixes a real off-by-one where a 31-day stay could get billed twice (the next 30-day boundary landing exactly on `check_out`).

**Savings goals** (`rental_savings_goal`): `saved_amount` is a plain, manually-edited number — not derived from bookings. Two earlier attempts at auto-computing it from booking revenue (a raw cumulative sum, then a full per-month approve/edit reconciliation flow) both turned out to be more machinery than a two-person household actually wants; editing the total directly, in the goal's own edit form, replaced both.

## Password vault

`VaultView.jsx` (also off the "+" speed-dial) stores credentials encrypted client-side — AES-GCM, key derived via PBKDF2 from a **shared** master password (known to both Ada and Aaron, consistent with everything else in this app being mutually visible) — before anything reaches Supabase. RLS on `vault_meta`/`vault_entries` governs who can read/write ciphertext, but it is *not* the security boundary for the passwords themselves; the encryption is, so a leaked service-role key or an RLS mistake only exposes unreadable ciphertext. The derived key lives only in React component state, never persisted to localStorage/sessionStorage, so it has to be re-entered every time the vault is reopened.

There is no password-reset path by design — if the master password is forgotten, the only way out is "Reset vault" (wipes `vault_meta` and all `vault_entries`), gated behind typing a confirmation word rather than a plain `window.confirm`. That's the first typed-confirmation pattern in this codebase; the only other place it's used is the CSV export, since that's the one action that undoes the vault's whole security guarantee (it downloads every password as an unencrypted file).

An entry's `loginMethod` field (e.g. "Google") is set instead of a password for accounts with no password of their own ("Sign in with Google") — `VaultEntryDetail.jsx` shows "Sign in via {loginMethod}" instead of a blank, confusing password row when it's set.

## Working status

`members.working_since` — nullable `timestamptz`, doubling as the on/off flag (`is`/`is not` null) and giving "working since 2:15 PM" for free with no separate boolean that could drift out of sync. Aaron gets an actual toggle (`WorkingStatusToggle.jsx`); Ada only ever gets a read-only badge reflecting it, never the reverse — "I'm working" is inherently self-reported.

## Completion submissions

Optional per-task proof-of-completion: `completion_note` (text) + `completion_attachments` (`jsonb` array of `{url, name}`, same "doesn't need a child table" reasoning as `checklist`). Any file type is accepted, not just images — `isImageAttachment()` in `src/lib/attachments.js` checks the filename extension to decide between an inline `<img>` preview and a plain download link. Files go to the public `task-attachments` Storage bucket; `storage.objects` RLS needs INSERT + UPDATE + **SELECT** policies for members — the SELECT policy is easy to miss, since `.upload(..., { upsert: true })` needs to check whether the object already exists first, and its absence surfaces as a generic RLS error on upload rather than an obviously-missing-SELECT one.

## UI structure

The header holds only the working-status indicator and a single ⚙️ settings button (`SettingsMenu.jsx`: notifications toggle, theme, sign out) — deliberately minimal. Every other action (priorities, vault, submit report, view reports, nudge, rentals) lives behind the floating "+" button (`NewTaskForm.jsx`), which doubles as a speed-dial menu whenever an `extraActions` array is passed to it. That array is built, ordered, and scoped per-viewer in `TaskBoard.jsx`'s `quickActions` (e.g. "Submit report" only appears for Aaron, "Nudge" only for Ada) — grouped so related actions stay adjacent (the two reporting actions) and the most tangential one (Rentals, a side business unrelated to daily task-board use) sits last. `NewTaskForm.jsx` itself has no opinion on who sees what or in what order.

## Deployment

Netlify (static frontend, env vars in Netlify's dashboard) + Supabase (schema and Edge Functions both applied by hand — schema via the SQL editor, functions via `supabase functions deploy` — neither is wired into the Netlify build). See README.md for the step-by-step.

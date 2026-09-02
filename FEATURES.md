# Tandem — Feature Documentation

Tandem is a shared task board and household operations app built for exactly two people, Ada and Aaron, plus an optional third role for a property manager who needs GPS-confirmed time tracking. It isn't a generic multi-user product — the two-person assumption is intentional and built into both the database and the UI.

This document describes every feature and how it behaves. For build commands and technical/architectural notes aimed at a developer (or an AI coding assistant) working in the codebase, see [CLAUDE.md](CLAUDE.md). For first-time project setup (creating the Supabase project, deploying to Netlify), see [README.md](README.md).

## Table of contents

1. [Who uses this app](#who-uses-this-app)
2. [Tech stack](#tech-stack)
3. [Signing in](#signing-in)
4. [Tasks](#tasks)
5. [The Today tab: Day / Week / Month views](#the-today-tab-day--week--month-views)
6. [Push notifications](#push-notifications)
7. [End-of-day / week / month / biweekly reports](#end-of-day--week--month--biweekly-reports)
8. [Priorities](#priorities)
9. [Rentals (Awa Rentalz & Azu Rentals)](#rentals-awa-rentalz--azu-rentals)
10. [Password vault](#password-vault)
11. [Working status](#working-status)
12. [Cork Board](#cork-board)
13. [Inbox](#inbox)
14. [Property manager / staff time tracking & payroll](#property-manager--staff-time-tracking--payroll)
15. [Navigation & app structure](#navigation--app-structure)
16. [Deployment](#deployment)

---

## Who uses this app

There are three kinds of accounts:

- **Ada and Aaron** — the two "members." They see everything: every task, every rental, the shared vault, the shared cork board. Nothing is private between them except cork board pins, which default to private and are only visible to the other person once explicitly shared.
- **A property manager ("staff")** — an account for someone who clocks in and out of physical work sites for pay, with no access to tasks, rentals, or the vault. Ada and Aaron manage this person's profile, pay rate, and approve their hours.

Which screen an account lands on is decided automatically at sign-in based on which of these roles the account belongs to. An account recognized as neither sees a plain "this account isn't set up yet" screen.

## Tech stack

- **Frontend:** React 19 + Vite, deployed as a static site on Netlify.
- **Backend:** Supabase — Postgres database, Auth, Realtime (live updates), Storage (file uploads), and a handful of Edge Functions for push notifications. No separate API server; the frontend talks to Supabase directly.
- **Push notifications:** Web Push (VAPID), fully custom — no third-party push service.
- **Styling:** hand-written CSS with theme tokens (light/dark mode) for most of the app; newer staff/payroll screens use Tailwind CSS utility classes.
- **Installable app:** works as an installable Progressive Web App (PWA) — "Add to Home Screen" on iOS gives it a standalone icon with no browser chrome, which is also required for push notifications to work on iOS.

## Signing in

Both Ada and Aaron (and any staff account) sign in with a short username (e.g. `aaron`) rather than a full email address — under the hood this is translated into a fake placeholder email (`aaron@tandem.local`) before being sent to Supabase, since Supabase's password auth is built around email as the identifier. Typing a real email address still works too.

There's no sign-up flow anywhere in the app — accounts are invite-only, created directly in the Supabase dashboard. This is deliberate: allowing arbitrary sign-ups would break the entire mutual-visibility model the app is built around.

## Tasks

Tasks are the core object in the app, assigned to either Ada or Aaron. Both people can see and edit every task regardless of who it's assigned to — there's no privacy between the two of them on tasks.

**Status:** a task is either not-done or done — a simple checkbox. (The database technically supports an "in progress" state too, but nothing in the app currently exposes it.)

**Checklist:** any task can carry a list of subtasks. Each checklist item can be checked off, or marked as "blocked" with an optional reason if it turns out to be genuinely not achievable — a blocked item and a done item are mutually exclusive; setting one clears the other.

**Due date & time:** a task can have a specific date and time, or be marked "All day," which means it has no specific time and simply persists on the board until done (there's a dedicated checkbox for this rather than just leaving the date blank, so "no date was ever set" and "the date field is blank right now" can't be confused).

**Duration & scheduling conflicts:** a task can carry a duration in minutes; its end time is always calculated from the start (never stored separately), and shown as a range like "5:30–6:10 PM (40 min)." If one person has two of their own tasks that overlap in time, the app visually flags them as conflicting — this only applies within one person's own schedule, since Ada and Aaron having simultaneous tasks isn't actually a conflict.

**Recurrence:** a task can repeat. The next occurrence is only created the moment the current one is marked done (not generated ahead of time), with the checklist reset back to unchecked.

**Task icons:** tasks can show a small icon next to their title, either picked manually or automatically guessed from the task's title (e.g. a task titled "Gym" gets a dumbbell icon). A manual pick always wins over the automatic guess.

**Overdue detection & nudges:** an overdue task belonging to the other person shows a small nudge button that sends them a push notification ("Still on your plate?"). The app also automatically nudges about a task that's been overdue for 3+ days, once, so a manual nudge and the automatic one don't double up.

**Task clarifications (comments):** any task can carry a lightweight comment/question thread — despite the name, this covers plain comments and suggestions too, not just literal questions (e.g. "hey, did you mean to assign this to yourself?"). Whoever didn't post the comment gets a push notification. A comment can be answered, or dismissed as "no reply needed" if it doesn't need one. An unanswered comment aimed at you shows a small 💬 badge on the task.

**Completion submissions:** when marking a task done, you can optionally attach a note and/or file(s) as proof of completion — any file type, not just images. This is entirely optional.

**Task duplication, editing, deletion:** standard actions available from each task's row.

**Bulk add & bulk edit:** a paste-in tool for adding many tasks at once from plain text (e.g. pasting a work schedule), supporting per-line time, timezone, and priority overrides, plus indented sub-lines that become checklist items. A separate bulk-edit mode can retitle, reassign, re-timezone, or reschedule (shift by an offset, or set to an exact date) a whole batch of already-created tasks at once.

**Task export:** a read-only, plain-text dump of every task's title/date/time/timezone, meant to be copied out of the app and reviewed elsewhere (or sanity-checked by an AI) — not a re-importable format.

## The Today tab: Day / Week / Month views

The main tab shows a Day/Week/Month toggle:

- **Day** — a genuinely time-scaled timeline for the selected day, tasks positioned by their real start time and sized by real duration, plus separate sections for All Day tasks and anything overdue.
- **Week** — the same task-list style grouped into a section per day of the current week.
- **Month** — a full calendar grid, each day cell previewing up to 3 task chips (color-coded by priority) plus a "N more" overflow line; tapping a day drills into Day view for that date.

A persistent "Month Year" header lets you jump to any date via a date picker. On mobile, swiping left/right on the Day or Month view steps to the next/previous day or month.

**"Completed today"** is a small tappable pill showing how many tasks were finished today (by completion time, not by original due date) — tapping it opens the full list. This exists specifically because Ada and Aaron are in different timezones, so a task due "today" on one person's clock might already read as "yesterday" on the other's; completed tasks always stay listed under the day they were originally due, so this pill is the way to see "what actually got done today" regardless of when it was originally scheduled.

## Push notifications

The app sends real push notifications (to an installed home-screen app on iOS, or any browser that supports it) for:

- **Task assignment** — whoever gets assigned a task by the other person is notified, unless they assigned it to themselves.
- **Task completion** — the other person is notified whenever a task is marked done.
- **Reminders** — a task due within 15 minutes, and a one-time nudge for anything overdue 3+ days.
- **Manual nudges** — the 🔔 button on an overdue task, and a person-level 👋 "nudge" icon in the header (Ada-only) for general "hey, look at the app" pings.
- **Task comments** — asking or answering a clarification.
- **Rental charges** — a reminder on the day a rental charge is due.
- **Report submissions** — the other person is notified whenever an end-of-day/week/month report is submitted.

Push only works from the app installed to the home screen on iOS (Safari tabs can't receive push at all — this is an iOS platform limitation, not something the app controls).

## End-of-day / week / month / biweekly reports

A place to log what got done, primarily used by Aaron reporting to Ada. Reports come in four flavors — Day, Week, Month, and Biweekly (aligned to the household's actual real payroll cutoff, not just any two-week span) — and can be submitted multiple times within the same period: a later submission in the same bucket appends to the existing report rather than creating a new one, so it reads as a running log across multiple work sessions in a day.

Each report auto-suggests a draft based on what's actually been completed since the last submission in that period, which can be edited before sending. A "minutes logged" field mirrors an external time-tracking total (it's overwritten on each submission, not summed). You can also step backward to submit a report for a bucket that was missed entirely (e.g. it's September and August's report never got sent).

## Priorities

A simple shared planning note — "what matters this day/week/month" — that both Ada and Aaron can set. Saving priorities also creates a real task for each item, so priorities don't just sit as a note that gets forgotten; day-scoped items get today's due date (so they can go overdue like anything else), while week/month items become All Day tasks that stick around until done.

## Rentals (Awa Rentalz & Azu Rentals)

A side feature tracking occupancy and finances for two separate furnished-rental businesses — Awa Rentalz (Ada's own) and Azu Rentals (her mom's, unrelated business) — switchable from a picker in the header. Both companies use the exact same feature set.

- **Calendar** — a month grid per rental unit showing bookings, colored by unit, with multi-day bookings drawn as a continuous connected bar across the days they span. A booking can have `pending` (an inbound inquiry, blocks the dates but isn't counted as revenue yet) or `confirmed` status, and can list multiple tenant names under one reservation.
- **Financials** — revenue is recognized by the guest's actual monthly charge cycle (based on their check-in day-of-month), not by raw day-count occupancy — matching how these rentals are actually billed, upfront each cycle. Shows each unit's next charge date/amount, and lets a charge be manually marked paid in advance.
- **Overview** — an at-a-glance list of every unit: who's in it and through when, or when it's vacant and who's booked in next. Each unit also shows how far out it's genuinely bookable for a new tenant, accounting for the household's 30-day minimum stay rule and any already-queued tenant.
- **"In talks" marker** — a quick toggle for flagging a unit that has an active prospective-tenant conversation going, independent of any actual booking existing yet.
- **Savings goals** — a simple manually-tracked savings target per company, not auto-derived from booking revenue.

Desktop shows a full two-column dashboard (calendar + financials always visible side by side); mobile shows the same information stacked into one scrollable column instead of separate tabs, so nothing is ever out of view while looking at something else.

## Password vault

A shared password manager, reached from the "+" menu. Every entry is encrypted client-side (AES-GCM, derived from a shared master password known to both Ada and Aaron) before it's ever sent to Supabase — the server only ever holds unreadable ciphertext, so even a leaked database credential wouldn't expose real passwords. The decryption key lives only in memory and has to be re-entered every time the vault is reopened.

Entries can be grouped into folders (a free-text tag on the entry, not a separate stored structure) and support an account that signs in via another service ("Sign in with Google") instead of a password. There's no password-reset flow by design — if the master password is forgotten, the only recovery path is wiping the vault entirely, which requires typing a confirmation phrase. A CSV export of every entry exists for backup purposes, gated behind the same typed-confirmation pattern since it downloads everything as plain, unencrypted text.

## Working status

Aaron can toggle an "I'm working" status on/off from the header; Ada sees a live read-only badge reflecting it ("🟢 Aaron" while on, greyed out while off), visible from every tab. It's inherently one-directional — Aaron self-reports his own status; Ada doesn't have (or need) the reverse.

## Cork Board

A quick-pin scratchpad — the opposite of a task, which is always scheduled. A pin has no due date and no timeline; it's just a thought, dropped for later. Pins default to **private** (only the author sees them) and can be explicitly shared to the other person's board. Only the author can edit or delete their own pin, even once shared.

Pins can be commented on once shared (by either person), archived once no longer active (recoverable, doesn't delete anything), or promoted straight into a real task ("Focus today") — any comments already on the pin carry over as checklist items on the new task, so nothing gets lost in the handoff from scratch note to actual scheduled work.

## Inbox

A single place to catch anything that might otherwise go unnoticed if you happen not to be looking at the specific task/pin it lives on:

- **New** — unanswered questions/comments directed at you.
- **Resolved** — your own questions that got answered or dismissed.
- **Submissions** — completed tasks that included a completion note or attachment.
- **Nudges** — a history of every overdue-task nudge sent, for either person.

## Property manager / staff time tracking & payroll

A separate role for someone (a house/property manager) who needs to clock in and out of physical locations for pay — entirely separate from the Ada/Aaron task-board world; a staff account never sees tasks, rentals, or the vault.

**Clocking in/out:** the staff account's whole screen is built around one simple flow — pick a work site (auto-suggested from GPS proximity, with a manual override), pick a pay rate (standard or emergency), optionally add notes, and clock in. A live elapsed-time timer runs while clocked in; clocking out captures a GPS reading too where possible, but a bad/missing GPS reading at clock-out won't block ending the shift (only clock-in requires a successful location reading).

**Work sites & the geofence:** each work site is a physical location with GPS coordinates and a configurable radius (default 100m). A clock-in outside that radius is flagged (but not blocked) so Ada/Aaron can review it. A work site can group multiple rental units under one physical location (useful when several rental units share the same building/address).

**Setting up a clock-in location:** a member searches a US street address (backed by OpenStreetMap) to place a new work site's map point — technical latitude/longitude fields exist too, but are tucked behind an "Advanced" toggle so the everyday setup flow never needs them. If address search can't place a site accurately, the property manager can instead stand at the actual location and capture their own current GPS reading, submitting it as a proposed point that a member reviews and approves (or discards) before it becomes the site's real clock-in coordinates.

**Pay rate & payroll cadence:** each staff member has a standard hourly rate and a separate emergency rate, edited by a member. The rate actually paid on a shift is locked in at the moment of clock-in — changing someone's rate later never retroactively changes past shifts. Each staff member also has a configurable payroll cadence (weekly, biweekly, twice-monthly, or monthly), used to scope the admin dashboard to "this pay period."

**Admin dashboard (the "Hours" tab):** Ada and Aaron review every shift here — approve or reject, filter by approval status, and step back and forth through pay periods (matching the staff member's own configured cadence) to see exactly what's owed for a given period, with a running summary of total pay, total hours, and pending/approved counts. A CSV export downloads whatever's currently on screen (matching both the active status filter and the active pay period) for external payroll use.

**Stranded shifts:** if a staff account is deactivated while still clocked in, a member can force-close that shift from the dashboard (since the deactivated account itself can no longer do it).

**Location management:** members manage the roster of active work sites, review pending on-site captures, and see which rental units are/aren't yet linked to a physical clock-in location — all from a dedicated locations screen reached off the Hours dashboard.

## Navigation & app structure

Five persistent tabs for Ada/Aaron: **Today**, **Rentals**, **Reports**, **Board** (which folds together Cork Board and Inbox as two switchable sections), and — when staff exist — the Hours/staff admin screen. A floating "+" button opens a speed-dial menu for one-shot actions that aren't worth their own persistent tab: new task, bulk add/edit, priorities, submit report (Aaron only), and the vault. The header (present on every tab) holds the working-status indicator, the nudge icon, and a settings menu (theme, notifications, default timezone, sign out, and an in-app "How to use this app" guide).

On mobile, navigation sits in a bottom tab bar; on desktop, the same nav buttons fold into the header row instead of a sidebar. Everything responsive is handled with plain CSS media queries except two genuinely different component trees for mobile vs. desktop (Rentals' stacked-vs-dashboard layout, and the mobile/desktop nav mount point) — those are the only places the app renders structurally different markup rather than just repositioning the same one.

## Deployment

- **Frontend:** a static build (`npm run build`) deployed to Netlify.
- **Backend:** Supabase — schema changes (`supabase/schema.sql`) and Edge Function deploys are both applied by hand (SQL editor / `supabase functions deploy`), not part of the Netlify build.
- See [README.md](README.md) for the full first-time setup walkthrough.

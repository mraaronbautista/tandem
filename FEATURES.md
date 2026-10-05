# Tandem — Feature Documentation

Tandem is a shared task board and household operations app. It started out built for exactly two people, Ada and Aaron, but has since been generalized to support any number of members — a healthcare VA has since joined as a real third member — plus an optional separate role for a property manager who needs GPS-confirmed time tracking. There's still no public sign-up (every account is hand-created, invite-only), but the two-person assumption itself is gone from both the database and the UI: who can see which tasks, reports, or passwords is now controlled per person rather than automatic between everyone.

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
15. [Managing the team](#managing-the-team)
16. [Navigation & app structure](#navigation--app-structure)
17. [Deployment](#deployment)

---

## Who uses this app

There are three kinds of accounts:

- **Members** — anyone doing real work on the task board, not just Ada and Aaron any more. Every member can see every other member's display name, but what else they can see is controlled individually: one member's visibility into another's tasks, reports, and vault access are each a separate, admin-managed setting (see [Managing the team](#managing-the-team)) rather than automatic. Cork Board pins work the same way — private by default, shared with specific people you pick, not an all-or-nothing toggle. One member is the admin (today, Aaron) — the only one who can grant or revoke other members' access, and the one who's automatically notified whenever any task gets completed (see [Push notifications](#push-notifications)).
- **A property manager ("staff")** — an account for someone who clocks in and out of physical work sites for pay, with no access to tasks, rentals, or the vault. Members manage this person's profile, pay rate, and approve their hours.

Which screen an account lands on is decided automatically at sign-in based on which of these roles the account belongs to. An account recognized as neither sees a plain "this account isn't set up yet" screen.

## Tech stack

- **Frontend:** React 19 + Vite, deployed as a static site on Netlify.
- **Backend:** Supabase — Postgres database, Auth, Realtime (live updates), Storage (file uploads), and a handful of Edge Functions for push notifications. No separate API server; the frontend talks to Supabase directly.
- **Push notifications:** Web Push (VAPID), fully custom — no third-party push service.
- **Styling:** hand-written CSS with theme tokens (light/dark mode) for most of the app; newer staff/payroll screens use Tailwind CSS utility classes.
- **Installable app:** works as an installable Progressive Web App (PWA) — "Add to Home Screen" on iOS gives it a standalone icon with no browser chrome, which is also required for push notifications to work on iOS.

## Signing in

Every real account — each member and any staff account — signs in with a short username (e.g. `aaron`) rather than a full email address — under the hood this is translated into a fake placeholder email (`aaron@tandem.local`) before being sent to Supabase, since Supabase's password auth is built around email as the identifier. Typing a real email address still works too.

There's no sign-up flow anywhere in the app — accounts are invite-only. A member can be created directly from the app by an admin (see [Managing the team](#managing-the-team)), or by hand in the Supabase dashboard.

## Tasks

Tasks are the core object in the app, assigned to any one member or several at once — not locked to exactly two people any more. Whether you can see or edit a task you're not personally assigned to depends on whether the task's assignee(s) have granted you access (Hidden, View only, or View & update, set per pair of members by an admin — see [Managing the team](#managing-the-team)). An admin automatically gets View & update on every new member's tasks the moment that member joins, so there's no gap where nobody can oversee a new hire's work.

**Status:** a task is either not-done or done — a simple checkbox. (The database technically supports an "in progress" state too, but nothing in the app currently exposes it.)

**Checklist:** any task can carry a list of subtasks. Each checklist item can be checked off, or marked as "blocked" with an optional reason if it turns out to be genuinely not achievable — a blocked item and a done item are mutually exclusive; setting one clears the other.

**Due date & time:** a task can have a specific date and time, or be marked "All day," which means it has no specific time and simply persists on the board until done (there's a dedicated checkbox for this rather than just leaving the date blank, so "no date was ever set" and "the date field is blank right now" can't be confused).

**Duration & scheduling conflicts:** a task can carry a duration in minutes; its end time is always calculated from the start (never stored separately), and shown as a range like "5:30–6:10 PM (40 min)." If one person has two of their own tasks that overlap in time, the app visually flags them as conflicting — this only applies within one person's own schedule, since two different people having simultaneous tasks isn't actually a conflict.

**Recurrence:** a task can repeat. Every upcoming occurrence for the current and viewed months is generated ahead of time (not spawned one at a time on completion), so picking a repeat schedule shows its future occurrences on the calendar right away. Copies are also created ahead of time by an hourly background job, weekday schedules never back-fill days before the task's own date, times stay put across daylight-saving changes, and a monthly task on the 31st lands on the last day of shorter months without drifting. Editing a repeating task asks whether the change applies to only that task or to it and all future ones. Bulk Add can create repeating tasks too: add a marker such as `~weekly` or `~mon,wed,fri` to a line, or use the Repeats dropdown in Guided mode.

**Task icons:** tasks can show a small icon next to their title, either picked manually or automatically guessed from the task's title (e.g. a task titled "Gym" gets a dumbbell icon). A manual pick always wins over the automatic guess.

**Overdue detection & nudges:** an overdue task you're not assigned to shows a small nudge button that sends its assignee(s) a push notification ("Still on your plate?"). The app also automatically nudges about a task that's been overdue for 3+ days, once, so a manual nudge and the automatic one don't double up.

**Task clarifications (comments):** any task you can view can carry a lightweight comment/question thread — despite the name, this covers plain comments and suggestions too, not just literal questions (e.g. "hey, did you mean to assign this to yourself?"). A "Notify" picker next to Send lets you choose exactly who gets pushed about it — it defaults to the task's other assignees, not a blanket "everyone." A comment can be answered, or dismissed as "no reply needed" if it doesn't need one. An unanswered comment aimed at you shows a small 💬 badge on the task.

**Completion submissions:** when marking a task done, you can optionally attach a note and/or file(s) as proof of completion — any file type, not just images. This is entirely optional. Attachments are private, following the same access rules as the task itself — nobody can open a file through a direct link if they couldn't already see the task.

**Completion notifications:** finishing a task automatically notifies the admin, quietly, so there's no gap in oversight — but it no longer pings every other member about routine work that doesn't concern them. Right after checking a task off, an optional "Notify someone?" prompt briefly appears, letting you pick anyone who can already see that task (it suggests whoever created it, if they're eligible) to loop in directly. Ignore it and nothing extra happens.

**Task duplication, editing, deletion, reassignment:** standard actions available from each task's row, each gated by the same per-pair access settings as viewing/editing.

**Bulk add & bulk edit:** a paste-in tool for adding many tasks at once from plain text (e.g. pasting a work schedule), supporting per-line time, timezone, and priority overrides, plus indented sub-lines that become checklist items. A separate bulk-edit mode can retitle, reassign, re-timezone, or reschedule (shift by an offset, or set to an exact date) a whole batch of already-created tasks at once.

**Task export:** a read-only, plain-text dump of every task's title/date/time/timezone, meant to be copied out of the app and reviewed elsewhere (or sanity-checked by an AI) — not a re-importable format.

## The Today tab: Day / Week / Month views

The main tab shows a Day/Week/Month toggle:

- **Day** — a genuinely time-scaled timeline for the selected day, tasks positioned by their real start time and sized by real duration, plus separate sections for All Day tasks and anything overdue.
- **Week** — the same task-list style grouped into a section per day of the current week.
- **Month** — a full calendar grid, each day cell previewing up to 3 task chips (color-coded by priority) plus a "N more" overflow line; tapping a day drills into Day view for that date.

A persistent "Month Year" header lets you jump to any date via a date picker. On mobile, swiping left/right on the Day or Month view steps to the next/previous day or month. A who-filter dropdown (All, plus one option per teammate you have) narrows the list to one person's tasks at a time.

**"Completed today"** is a small tappable pill showing how many tasks were finished today (by completion time, not by original due date) — tapping it opens the full list. This exists specifically because teammates can be in different timezones, so a task due "today" on one person's clock might already read as "yesterday" on another's; completed tasks always stay listed under the day they were originally due, so this pill is the way to see "what actually got done today" regardless of when it was originally scheduled.

## Push notifications

The app sends real push notifications (to an installed home-screen app on iOS, or any browser that supports it) for:

- **Task assignment** — whoever gets assigned a task by someone else is notified, unless they assigned it to themselves.
- **Task completion** — the admin is notified whenever a task is marked done, quietly and automatically. Anyone else is only notified if the person completing it explicitly chooses to tell them, via the optional "Notify someone?" prompt.
- **Reminders** — a task due within 15 minutes, and a one-time nudge for anything overdue 3+ days.
- **Manual nudges** — the 🔔 button on an overdue task, and a person-level 👋 "nudge" icon in the header, open to every member, with a picker for who it's aimed at.
- **Task comments** — asking or answering a clarification, sent to whoever's picked in the Notify picker.
- **Rental charges** — a reminder on the day a rental charge is due, plus two one-time reminders for a long-term lease (final month starting, and turnover a week out).
- **Report submissions** — sent only to whoever has specifically been granted access to read that member's reports, not every other member automatically.

Push only works from the app installed to the home screen on iOS (Safari tabs can't receive push at all — this is an iOS platform limitation, not something the app controls).

## End-of-day / week / month / biweekly reports

A place to log what got done. Reports come in four flavors — Day, Week, Month, and Biweekly (aligned to the household's actual real payroll cutoff, not just any two-week span) — and can be submitted multiple times within the same period: a later submission in the same bucket appends to the existing report rather than creating a new one, so it reads as a running log across multiple work sessions in a day. Whether a given member even sees the "Submit report" option is set individually by an admin, since not every role involves reporting.

**Who can read a report is also set individually, not automatic.** An admin decides which members can read which other members' reports — a report is no longer visible to the whole team by default, since with more than two people it can be as personal as a private work log.

Each report auto-suggests a draft based on what's actually been completed since the last submission in that period, which can be edited before sending. A "minutes logged" field (entered as hours + minutes) mirrors an external time-tracking total — it's overwritten on each submission, not summed. You can also step backward to submit a report for a bucket that was missed entirely (e.g. it's September and August's report never got sent), and edit an already-submitted report afterward to fix a typo or a wrong number.

## Priorities

A simple planning note — "what matters this day/week/month" — that any member can set for themselves. Saving priorities also creates a real task for each item, so priorities don't just sit as a note that gets forgotten; day-scoped items get today's due date (so they can go overdue like anything else), while week/month items become All Day tasks that stick around until done. Who can read a given person's priorities is set individually by an admin, the same as reports — it's no longer automatically shared with the whole team.

## Rentals (Awa Rentalz & Azu Rentals)

A side feature tracking occupancy and finances for two separate furnished-rental businesses — Awa Rentalz (Ada's own) and Azu Rentals (her mom's, unrelated business) — switchable from a picker in the header. Both companies use the exact same feature set, gated behind a Rentals permission any member either has or doesn't.

Units are further split into **Short/Midterm** (the day-to-day, calendar-driven dashboard below) and **Long Term** (fixed-rent leases, which get their own simpler lease-progress view instead of a booking calendar, plus two reminders: one when the lease enters its final month, and another a week before turnover).

- **Calendar** — a month grid per rental unit showing bookings, colored by unit, with multi-day bookings drawn as a continuous connected bar across the days they span. A booking can have `pending` (an inbound inquiry, blocks the dates but isn't counted as revenue yet) or `confirmed` status, and can list multiple tenant names under one reservation.
- **Financials** — revenue is recognized by the guest's actual monthly charge cycle (based on their check-in day-of-month), not by raw day-count occupancy — matching how these rentals are actually billed, upfront each cycle. Shows each unit's next charge date/amount, and lets a charge be manually marked paid in advance.
- **Overview** — an at-a-glance list of every unit: who's in it and through when, or when it's vacant and who's booked in next. Each unit also shows how far out it's genuinely bookable for a new tenant, accounting for the household's 30-day minimum stay rule and any already-queued tenant.
- **"In talks" marker** — a quick toggle for flagging a unit that has an active prospective-tenant conversation going, independent of any actual booking existing yet.
- **Savings goals** — a simple manually-tracked savings target per company, not auto-derived from booking revenue.
- **Automatic turnover-cleaning tasks** — a confirmed booking automatically gets a real task ("Schedule turnover cleaning for [unit]"), due a week before the guest's last day, so lining up a cleaner never gets discovered at the last minute.

Desktop shows a full two-column dashboard (calendar + financials always visible side by side); mobile shows the same information stacked into one scrollable column instead of separate tabs, so nothing is ever out of view while looking at something else.

## Password vault

A shared password manager, reached from Settings. Every entry is encrypted client-side (AES-GCM, derived from a master password known to everyone with access to that vault) before it's ever sent to Supabase — the server only ever holds unreadable ciphertext, so even a leaked database credential wouldn't expose real passwords. The decryption key lives only in memory and has to be re-entered every time the vault is reopened.

**Who can see a given entry is set per entry, not just per vault.** A new entry defaults to visible only to whoever added it; an explicit "Share with" picker in the entry form extends visibility to specific other people with vault access. Already-saved entries keep working exactly as before — a one-time migration backfilled their sharing to match who could already see them. Who an existing entry is shared with can also be changed later, from a quick control right on the entry itself, without reopening the full edit form.

Entries can be grouped into folders (a free-text tag on the entry, not a separate stored structure) and support an account that signs in via another service ("Sign in with Google") instead of a password. There's no password-reset flow by design — if the master password is forgotten, the only recovery path is wiping the vault entirely, which requires typing a confirmation phrase. A CSV export of every entry exists for backup purposes, gated behind the same typed-confirmation pattern since it downloads everything as plain, unencrypted text.

## Working status

A member with this turned on can toggle an "I'm working" status (plus Available / Busy / In a meeting, with an optional expiry) from the header; everyone else sees a live read-only summary of who's currently on, visible from every tab. It's inherently one-directional per person — you self-report your own status; nobody can set it on your behalf.

## Cork Board

A quick-pin scratchpad — the opposite of a task, which is always scheduled. A pin has no due date and no timeline; it's just a thought, dropped for later. Pins default to **private** (only the author sees them); sharing means explicitly picking which specific teammates can also see it, not a single "share with everyone" toggle. Only the author can edit, archive, or delete their own pin, even once shared.

Pins can be commented on once shared (by anyone it's shared with), archived once no longer active (recoverable, doesn't delete anything), or promoted straight into a real task ("Focus today") — any comments already on the pin carry over as checklist items on the new task, so nothing gets lost in the handoff from scratch note to actual scheduled work. A task you archive from the board the other direction gets a linked pin too, with a "Restore to Today" action to bring the exact same task back later.

**Projects** is a second mode on the same board for anything with real milestones rather than a flat note — `##`-style headings group steps, each with a progress bar, and a step can be scheduled onto the real timeline on a picked date. A step's done-state reads live off its linked task, so checking the task off on the timeline is what marks the milestone step done.

## Inbox

A single place to catch anything that might otherwise go unnoticed if you happen not to be looking at the specific task/pin it lives on, scoped to things that actually concern you (tasks you're assigned to, not everything you merely have view access to):

- **New** — unanswered questions/comments directed at you.
- **Resolved** — your own questions that got answered or dismissed.
- **Submissions** — completed tasks that included a completion note or attachment.
- **Nudges** — a history of every overdue-task nudge and person-level nudge sent, for or by you.

## Property manager / staff time tracking & payroll

A separate role for someone (a house/property manager) who needs to clock in and out of physical locations for pay — entirely separate from the member task-board world; a staff account never sees tasks, rentals, or the vault.

**Clocking in/out:** the staff account's whole screen is built around one simple flow — pick a work site (auto-suggested from GPS proximity, with a manual override), pick a pay rate (standard or emergency), optionally add notes, and clock in. A live elapsed-time timer runs while clocked in; clocking out captures a GPS reading too where possible, but a bad/missing GPS reading at clock-out won't block ending the shift (only clock-in requires a successful location reading). Stopping a shift offers a quick "taking a break" choice (just an ordinary clock-out/back-in pair, tagged so the timer reads as one continuous session) versus clocking out for the day, with an optional shift report either way.

**Work sites & the geofence:** each work site is a physical location with GPS coordinates and a configurable radius (default 150m). A clock-in outside that radius is flagged (but not blocked) so members can review it. A work site can group multiple rental units under one physical location (useful when several rental units share the same building/address). If the property manager drifts outside the radius for a sustained stretch while clocked in, the app prompts (never auto-clocks-out) with the same break/clock-out choice.

**Setting up a clock-in location:** a member searches a US street address (backed by OpenStreetMap) to place a new work site's map point — technical latitude/longitude fields exist too, but are tucked behind an "Advanced" toggle so the everyday setup flow never needs them. If address search can't place a site accurately, the property manager can instead stand at the actual location and capture their own current GPS reading, submitting it as a proposed point that a member reviews and approves (or discards) before it becomes the site's real clock-in coordinates.

**Pay rate & payroll cadence:** each staff member has a standard hourly rate and an optional separate emergency rate (left unset entirely for a role that never works emergency shifts), edited by a member. The rate actually paid on a shift is locked in at the moment of clock-in — changing someone's rate later never retroactively changes past shifts. Each staff member also has a configurable payroll cadence (weekly, biweekly, twice-monthly, or monthly), used to scope the admin dashboard to "this pay period."

**Admin dashboard (the "Hours" tab):** members with Staff access review every shift here — approve or reject, filter by approval status, and step back and forth through pay periods (matching the staff member's own configured cadence) to see exactly what's owed for a given period, with a running summary of total pay, total hours, and pending/approved counts. A CSV export downloads whatever's currently on screen (matching both the active status filter and the active pay period) for external payroll use. Members can also add a shift manually or correct an existing one directly, and staff can flag a shift for correction if something looks wrong.

**Stranded shifts:** if a staff account is deactivated while still clocked in, a member can force-close that shift from the dashboard (since the deactivated account itself can no longer do it).

**Location management:** members manage the roster of active work sites, review pending on-site captures, and see which rental units are/aren't yet linked to a physical clock-in location — all from a dedicated locations screen reached off the Hours dashboard.

## Managing the team

Reached from Settings → "Manage member access" (admin only). Lists every other member with controls for:

- **Feature access** — whole-app toggles for Rentals, Staff, Reports, and setting your own working status.
- **Task visibility** — Hidden / View only / View & update toward that member's own tasks, plus separate Create/Delete/Reassign permissions layered on top.
- **Report visibility** — a simple checkbox per teammate for whether they can read this member's reports.

An entry can also hold a **one-time code (authenticator) key**: paste the setup key a site shows when you turn on an authenticator app, and the entry shows the live 6-digit code with a countdown and a Copy button, like Google Authenticator. The key is stored encrypted inside the entry, so anyone the entry is shared with can generate its codes; keep your most sensitive accounts in your own authenticator app. If the device's clock is off by 10+ seconds, a warning appears (a wrong clock is the usual reason a code is rejected). The CSV export includes an authenticator link so a key is never stranded.

A separate "Add member" flow creates a brand-new account end to end — username, a generated password shown once, display name, badge color, and a starting feature template — without needing a deployment or a manual database edit; it hands straight into the access screen above so the new member's task visibility can be set immediately. Every member can also edit their own display name, badge color, and password from a self-service "My Profile" screen, and an admin can reset another member's username or password directly for easy account handoff.

## Navigation & app structure

Five persistent tabs: **Today**, **Rentals**, **Reports**, **Board** (which folds together Cork Board/Projects and Inbox as switchable sections), and — when staff exist — the Hours/staff admin screen. The floating "+" is contextual: Today opens a tabbed Task Tools modal (New task / Bulk / Priorities), Rentals opens Add booking, Reports opens Submit report (if you have that permission), and Board focuses the new-pin composer; Staff has no ambiguous add action. The header holds the working-status indicator, the nudge icon, and Settings. Vault has a dedicated row in Settings alongside theme, notifications, default timezone, sign out, "Manage member access" (admin only), "My profile," and the in-app guide.

**Outside tools (Settings):** Settings can list outside tools, today the Dallas Property Finder, which open full screen inside Tandem without interrupting the board. They are shown only to the members named on that tool's row; its address is stored in the database, never in the app's code.

On mobile, navigation sits in a bottom tab bar; on desktop, the same nav buttons fold into the header row instead of a sidebar. Everything responsive is handled with plain CSS media queries except two genuinely different component trees for mobile vs. desktop (Rentals' stacked-vs-dashboard layout, and the mobile/desktop nav mount point) — those are the only places the app renders structurally different markup rather than just repositioning the same one.

## Deployment

- **Frontend:** a static build (`npm run build`) deployed to Netlify.
- **Backend:** Supabase — schema changes (`supabase/schema.sql`) and Edge Function deploys are both applied by hand (SQL editor / `supabase functions deploy`), not part of the Netlify build.
- See [README.md](README.md) for the full first-time setup walkthrough.

## Property contacts — prepared, awaiting setup

Each rental unit can show tenant, vendor and other contacts. All contacts searches names, organizations and phone numbers. A single contact can link to several units, with a role at each; Copy number supports pasting into your preferred calling app. Archive keeps details and links, and Include archived exposes Restore. Rentals permission governs viewing and editing. Door codes/passwords belong in the Vault. The contacts SQL migration and signed-in verification are pending; this feature is not confirmed live.

### Location service contacts — prepared, awaiting setup

Link a handyman, cleaner or other service contact to a whole location so they appear for every unit there, including new units. Choose specific units for narrower coverage; tenants remain unit-specific. All contacts filters by Location and Service. Edit unit can set its location. Location names come from existing Staff locations; no GPS/payroll details are shown to Rentals-only members. A new manual SQL step and live checks are pending.

### Long-term lease controls — prepared, publication pending

Long Term unit cards have Add lease; existing/upcoming leases have Edit lease. The main + opens Add lease in Long Term. Uses the existing tenant/date form and overlap validation. Upcoming leases show tenant names/date range.

## Dated lease notes — prepared, awaiting setup

Long-term lease cards show the latest dated note. Add note records an update; View notes opens history with author names and edited timestamps. Everyone with Rentals access can read/add; only the author can edit/archive/restore a note. Original tenancy history remains available under the lease picker when a new tenancy begins. Existing booking notes stay separate. Manual SQL and real signed-in verification remain pending.

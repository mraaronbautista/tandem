# Tandem — Project Journey (Single Source of Truth)

Last updated: October 6, 2026, by Codex. The latest Current state addendum and Active handoff below supersede historical checkpoints.

## What this document is

This is the one document meant to give any AI assistant — Claude, ChatGPT, Codex, whoever picks this up next — the full shape of this project cold: what Tandem is, how it got to its current state, what's true right now, and exactly where to pick up if a session ends mid-thread. It is the **narrative spine**; it deliberately does not duplicate the deep technical detail that already lives elsewhere. Read this first, then follow its pointers.

**If you only read one section before doing anything, read "Active handoff — read this first" near the bottom.** That's the actual resume point.

## How to use this if you're picking this up cold

1. Read this whole document once, start to finish — it's written to be read in order, not skimmed.
2. Read `CLAUDE.md` next for the real technical architecture (it's long — ~220KB — because it documents the *why* behind nearly every decision in the codebase, not just the *what*). Treat it as the authoritative technical reference.
3. Check `AUDIT_HANDOFF.md` for the detailed, line-by-line operational log of the current collaborative effort between Claude and Codex sessions (if you are not Claude or Codex, read it anyway — it's the most current tactical state).
4. Check `git log` and `git status` yourself before assuming anything — this document and the others are kept honestly updated, but always verify independently rather than trusting a stale claim. That norm (distinguish "prepared" from "tested" from "committed" from "pushed" from "confirmed live in production") is the single most important working convention on this project — see "Established conventions" below.
5. If you're about to touch the database or deploy something, read the relevant parts of CLAUDE.md first — this schema has real production data (a real household's real task board, a real property-management business, a real household VA's onboarded account) and several past incidents in this project were caused by assuming committed code was actually deployed, or assuming a migration had actually been run. Don't repeat those.

## The journey (chronological)

### Chapter 1 — PsyberScribe becomes Tandem (July 23, 2026)

The app started life as "PsyberScribe," then was renamed to **Tandem** and flattened from a nested project structure to the repo root. From the very first commits it was a two-person task board: **Ada** (the client) and **Aaron** (her virtual assistant and, eventually, the app's administrator). Early work established the core loop — task creation, due dates/times with overlap detection, a submission/completion flow, push notifications (Web Push/VAPID), pull-to-refresh, and login.

### Chapter 2 — The first real feature set: Rentals, Vault, Priorities, Cork Board (Aug 4–13)

This is where Tandem grew past "just a task list." In roughly ten days: End-of-day reports matured; a full **Rentals** module shipped (calendar, financials recognized by upfront charge cycle rather than calendar occupancy, savings goals, booking status); a **shared password vault**, encrypted client-side; **Priorities** became a checklist that spawns real tasks on save, not just a note; **task clarifications** (ask-a-question threads with push notifications) were added; and **Cork Board** (quick pins with no due date) appeared, along with a How-to guide and the first responsive Today/Rentals/Reports navigation.

### Chapter 3 — UI/UX iteration and the "a2" redesign (Aug 17–31)

A long stretch of pure interaction polish: modal focus trapping, accessibility labels, inline errors instead of `alert()`, a desktop 3-column Rentals dashboard, Month view with real task previews, a merged desktop header/nav. Then a deliberate redesign spike against a reference design ("a2"): a floating mobile nav capsule + FAB, Cork Board and Inbox merged into one Board destination, and the start of a **CSS-to-Tailwind migration** (component by component, tracked in `MIGRATION_PLAN.md`), which completed on Aug 31 as "a deliberate hybrid architecture" — Tailwind utilities for new/migrated components, the older hand-written `App.css`/`index.css` custom-property system still governing what hadn't been touched yet.

### Chapter 4 — Property-manager Staff: a third kind of account (Aug 31 onward)

Also landing Aug 31: a wholly new account type, **staff** (a house/property manager), deliberately *not* a `members` row — GPS-confirmed clock-in/out, geofencing against configured work sites, an admin dashboard for Ada/Aaron. This was the first time the app had to reason about more than two trust levels. Over the following two weeks this matured substantially: physical-location grouping (one location, many rental units, either company), address-based clock-in setup via OpenStreetMap geocoding, on-site GPS capture with member approval as a fallback, break/geofence-exit clock-out flow with shift reports, configurable payroll cadence, CSV export, and a member-side credential-reset flow for easy staff turnover.

### Chapter 5 — The big day: task icons, timeline polish, recurrence unification (Sep 1–3)

A single enormous push (54 commits on Sep 2 alone) that: added keyword-guessed task icons with manual override; reworked the Day timeline's clustering/stacking math multiple times to stop false "overlapping" flags; unified *every* recurrence type (daily through annual) onto one pre-materialize-ahead-of-time model, retiring the old one-step-at-a-time `spawn_next_recurrence()` approach (this retirement wasn't fully cleaned up — see Chapter 9); and shipped `FEATURES.md`, the first user-facing documentation of the whole app.

### Chapter 6 — Staff feature maturation (Sep 3–13)

Continued hardening of the property-manager feature: multiple tenants per rental booking, a genuine adversarial RLS pass that found and fixed a real staff-timekeeping security gap, live-Realtime-sync fixes for work-site capture/approval (caught via a real report: a capture succeeding on the property manager's phone wasn't showing as pending on the member's side), and markdown-rendered job descriptions.

### Chapter 7 — The N-member pivot (Sep 29–30)

The single biggest architectural turn in the project: **generalizing from a hardcoded two-person (Ada/Aaron) model to a real N-member model**, driven by the need to onboard a healthcare virtual assistant who needed the task board without Ada's Rentals/Vault/Staff data. `tasks.who` (a fixed Ada/Aaron/both enum) was replaced by `tasks.assignee_ids`, a real array; `task_access` (per-ordered-pair Hidden/View/Update + create/delete/reassign grants) replaced the old implicit "both members see everything"; `members.permissions` became a real deny-list jsonb blob; an admin UI (`ManageMemberAccessView.jsx`/`MemberAccessForm.jsx`) and an in-app **Add Member** flow shipped so a new hire needs no SQL/deployment; **My Profile** closed the self-service gap; task attachments moved from a public Storage bucket to a genuinely private one; Inbox was scoped to assignment rather than mere visibility; Cork Board pins moved from an all-or-nothing `shared` boolean to real per-member `shared_with` targeting; and a *second*, healthcare-scoped password vault was built with its own separate master password for real key separation.

### Chapter 8 — The real VA, a vault reversal, and the first deployment-cohesion crack (Oct 1)

**RC Lina**, the healthcare VA, became a real onboarded production account — no longer a test account. Almost immediately, real use surfaced two things:

1. The two-vault design from Chapter 7, while architecturally sound, asked Ada to remember a *second* master password just for Lina's benefit — more cost than the actual requirement needed. Aaron: *"i think setting up a new master password for the vault for healthcare will be too much for ada to remember, i think we can just pick who we can share the passwords to inside vault right."* Correct — the real requirement (Lina sees only specific credentials) was already exactly what per-entry `shared_with` sharing does *within* one vault. The second vault was **collapsed back into one shared vault with per-entry privacy**, the same day it had shipped. The `vaults`/`vault_access` infrastructure stayed (a future vault that genuinely needs its own separate password is a one-row insert away) — there's just one vault in active use.
2. Completing one's own task was incorrectly notifying the *other* member that "Ada finished that task," regardless of who actually completed it. Root cause: **Edge Function deployment drift** — `notify-task-events` and `notify-reminders` had been correctly rewritten for the N-member model since Sep 30, committed to the repo the whole time, but **never actually redeployed**. Production was silently still running the original hardcoded two-person version, reading a `task.who` column that no longer existed, which made every single completion hardcode to "Ada completed a task." This is the project's sharpest lesson so far: *Supabase Edge Functions deploy independently of the Netlify frontend build — a function can be correctly committed for a long time while production silently runs an old version, with no error, only wrong behavior.*

That bug also triggered a direct product conversation about what completion notifications *should* do with more than two people in the mix, landing on: automatic completion pings go to admins only now, plus a new opt-in "Notify someone this is done?" prompt (eligible recipients computed from real task-visibility rules) for the rare case someone specific should know.

### Chapter 9 — The full deployment-cohesion audit, and a new multi-agent collaboration pattern (Oct 1–2)

The notification bug above prompted Aaron to ask for something broader: *"lets go over every single thing... I dont want to see anything arise like how my completion of a task notify me, aaron, and the notification state it as ada completed a task."* A 6-phase audit followed (deployment integrity, Realtime publication coverage, notification pathways, frontend data freshness, access-model cohesion, a scoped feature walkthrough), finding and fixing several more real, dormant issues: a **zombie recurrence trigger** (the old `spawn_next_recurrence()` model's trigger was still installed and still referencing dropped columns, silently doing the wrong thing if it had ever fired again), a missing rental-turnover-task trigger that had *never actually worked* despite being documented as live, an undocumented notification trigger, and a missing member-only guard on the task-nudge notification path.

This stretch also introduced something new to the project: **a second AI agent (Codex/ChatGPT) working the same repository concurrently with Claude**, which required building an actual shared-handoff convention — `AUDIT_HANDOFF.md` plus `.claude/skills/shared-handoff/SKILL.md`, with explicit rules (distinguish prepared/tested/committed/pushed/confirmed-live; never overwrite another agent's entries or claim their work; re-read before resuming). Codex independently caught a real gap in Claude's in-flight work (a newly-added per-person Priorities access grant had no UI for the grantee to actually view what they'd been granted) — a genuine example of the cross-agent review paying off. **This document you're reading now is the next step in that same spirit: a source of truth written so that *any* AI tool, not just Claude or Codex, can pick this project up correctly.**

The rest of Oct 1–2 was spent making Priorities genuinely per-person (it had been a global "most recent wins" view with no real per-setter concept, which would have silently shown stale data to a restricted viewer once read-restrictions were layered on) with its own `priorities_access` grant table mirroring the existing `report_access` pattern, then **systematically verifying everything that shipped** — not just reading the code, but actually running it: read-only schema checks, rolled-back impersonation transactions proving both the restriction and the grant work, a real production browser session (on Ada's own device) confirming the UI renders correctly, and a real admin-UI grant/revoke click-through confirmed against the live database on both the insert and delete path.

### Chapter 10 — Where we are now (Oct 2, 2026)

A deliberate pause, mid-way through a longer list of "shipped but never actually clicked through in a browser" items. Five of seven were verified this way (My Profile, the admin member-credentials form, Projects' quick-add/collapse/undo, Cork Board's targeted sharing, and attachment privacy); two remain, both needing the real VA's own login rather than Aaron's or Ada's — Inbox scoping and task-comment notification targeting. Rather than continue synchronously, Aaron asked for a plain-language checklist to hand to RC Lina directly so she can self-check both on her own device. See "Active handoff" below for the exact state.

Also decided, the same day: **Working Hours (profile schedules) — deliberately skipped, not deferred by accident.** This was the one remaining unbuilt item from the original `multi-member-permissions.md` plan (alongside the later-phase "Recorded online patterns," which depends on it and is correspondingly also on hold). Walked through *why* before touching design: the app already has a *live*, manual Online/Busy/In-a-meeting status with expiry, which answers "is this person actually around right now" better than a static recurring weekly schedule would — a schedule goes stale, can't capture a day off, and the original design doc had already scoped it to never automate anything (no auto-toggling status, purely informational team-sheet context). Asked directly whether there'd been a real recurring annoyance a schedule would have fixed (an off-hours ping, a task set at a bad time for the assignee, genuine uncertainty about when someone's starting) — there wasn't one; it was more "a natural next item from the old plan" than a felt problem. Aaron: *"it's probably not worth it, skip it for now."* If this comes up again later, don't rebuild the case from scratch — re-ask the same question (is there now a concrete recurring annoyance?) before resuming design, since the reasoning above, not just the conclusion, is what should carry forward.

### Chapter 11 — UI/UX overhaul finished, Vault codes, recurrence rebuild, Dallas Property Finder (Oct 2–6, 2026)

Chapter 10's pause ended with the UI/UX overhaul (plan copied into the repo at `docs/ui-ux-overhaul-plan.md`; its Phase 0–5 status blocks are the detail). All five phases are built and pushed: first-login primer and labelled buttons (1), a simpler New Task form and plain-language Staff screens (2), one in-app confirm dialog replacing 15 native `confirm()`s plus Bulk Add Guided mode (3), measured contrast/touch-target/error-message fixes (4), and empty/loading states (5). Rules that came out of it live in `CLAUDE.md` ("Accessibility rules", "Empty and loading states", "Confirming destructive actions") — follow them for any new UI.

Other work in this window, all committed and pushed to `origin/main`:

- **Vault one-time codes (TOTP)** — an entry can hold an authenticator secret and show live 6-digit codes (`src/lib/totp.js`, checked against the RFC 6238 vectors; `TotpCode.jsx`). Secret lives inside the encrypted entry payload, so no schema change. A device-clock check (`src/lib/clockCheck.js`) warns when the phone's clock is 10+ seconds off, since that is the usual reason a code is rejected. (`45854d7`, `20dbe14`)
- **Staff tab filter** — All/Pending/Approved is a dropdown on phones (`58e5dbd`, `8a89668`). This is also where Aaron set the working rule now saved in memory: **show him options/a mockup and wait for his pick before implementing, committing or pushing any design or behaviour choice.** Obvious single-fix bugs can be fixed directly.
- **Repeating tasks rebuilt (seven defects)** — Aaron reported "selected weekday is buggy" and "repeats is buggy". Reproduced against a real Postgres (PGlite) and fixed: weekday schedules back-filled overdue copies before the template's date; a 3 PM task slid to 2 PM after a clock change; monthly tasks drifted (Jan 31 → Feb 28 → Mar 28); copies were only created when someone opened the app; editing a repeating task changed only one copy; plus form fixes. `supabase/fix-recurrence-generation.sql` was **run by Aaron in the Supabase SQL editor and he reported it worked** (it also schedules the hourly `ensure-upcoming-recurrences` pg_cron job). The new rules and the "edit this task or this and future?" dialog are in `CLAUDE.md` under Recurrence. (`0264dec`, `2d449d6`)
- **Bulk Add repeats** — a `~weekly` / `~mon,wed,fri` / `~monthly` marker in the paste format plus a Repeats dropdown in Guided mode, sharing one token table with the task form (`6dbe088`).
- **Dallas Property Finder (NOT yet committed)** — Ada wants the separate `db2re-preferred-zone` site (at `https://dallas-properties.netlify.app`) reachable from inside Tandem without interrupting the board. Built as a Settings row that opens the site full screen in a sandboxed iframe (`ExternalToolView.jsx`, `lib/externalTools.js`, edits to `SettingsMenu.jsx`/`HowToGuide.jsx`). Aaron's requirements: only Ada and Aaron see it, and "I don't want any exposure" — so the address is **not in the JavaScript bundle**; it lives in a new `external_tools` table readable only by the members listed on the row. `supabase/add-external-tools.sql` creates the table and inserts the row; the file keeps a placeholder URL on purpose (so the real address isn't committed), and Aaron was given the full SQL with the real address in chat to paste. Details in `CLAUDE.md` ("External tools (Settings)").

## Current state addendum (Oct 6, 2026)

| Area | Status |
| --- | --- |
| UI/UX overhaul Phases 0–5 | Built and pushed; **never seen inside the real signed-in app** (see verification debt) |
| Vault TOTP codes + clock warning | Pushed; verified on mounted components and RFC test vectors, not in the signed-in vault |
| Recurrence fixes + hourly job | Pushed; SQL run by Aaron (reported working); not independently re-checked against production by an AI |
| Bulk Add repeats | Pushed; verified on mounted component, not signed-in |
| Dallas Property Finder | **Uncommitted** in the working tree; SQL given to Aaron but he has not yet said he ran it; nothing pushed or live |
| Rental contacts and location coverage | Published (`57f8c82`, `deb69c9`); SQL user-reported applied; signed-in directory and location mapping checked |
| Long-term Add/Edit lease controls | Published (`0b5ab92`); both signed-in entry points checked without creating records |
| Dated lease notes | Published (`9125b9b`); SQL user-reported applied; signed-in reads/editor verified, live writes/author access/Realtime outstanding |
| All-record Excel / CSV export | Published (`4801425`), public bundle confirmed; local checks passed. Tasks excluded; optional Vault |
| October 6 bug-fix phases 1–3B | Published (`67bb76b`); public new-batch code and roadmap SQL verified; real phone/signed-in writes pending |
| Overdue timezone / contact catch-up fixes | Pushed (`4c8e2a1`, `7343015`); Aaron confirms both contacts visible on phone after refresh/reopen; missed-change automatic catch-up still unverified |
| Call/text logging | Deferred |

## Current state (as of Oct 2, 2026 — see the Oct 6 addendum above for newer rows)

A quick status map — for *how* each of these works, read the matching CLAUDE.md section, not this list.

| Area | Status |
| --- | --- |
| Core task board (assignees, recurrence, timeline, overlap detection) | Live, mature, N-member since Sep 30 |
| Members, permissions, task_access | Live; admin UI exists; `is_admin` promotion is still SQL-editor-only by design |
| Rentals (Awa Rentalz / Azu Rentals) | Live, mature; short/midterm and long-term unit views |
| Password vault | Live; one shared vault, per-entry privacy (see Chapter 8) |
| Reports (EOD/EOW/EOM/biweekly) | Live; `report_access` per-member read grants shipped Oct 1 |
| Priorities | Live, genuinely per-person as of Oct 1–2, fully verified (schema + impersonation + live browser + admin UI) |
| Cork Board (pins + Projects/milestones) | Live; targeted per-member sharing; Projects has quick-add/collapse/undo |
| Inbox | Live; scoped to actual assignment, not mere visibility |
| Property-manager Staff (GPS clock-in/out, payroll) | Live, mature; a separate account type from `members` |
| Push notifications | Live; completion pings now admin-only + explicit opt-in (see Chapter 8) |
| Real accounts in production | Ada, Aaron (admin), RC Lina (healthcare VA, onboarded Oct 1) |
| Deployment-cohesion bug audit | Complete — see Chapter 9, `AUDIT_HANDOFF.md` for the full phase-by-phase record |
| Real-browser click-through verification pass | 5 of 7 done; 2 remain, delegated to RC Lina via a self-check checklist (see below) |

## Where to look for what (document map)

- **`CLAUDE.md`** — the real technical reference. Exhaustively documents *why* the code is the way it is, not just what it does. Start here for implementation work.
- **`FEATURES.md`** — user-facing description of what the app does, written for a person (e.g. onboarding a new member), not a developer.
- **`README.md`** — first-time setup: creating the Supabase project, inviting accounts, deploying.
- **`AUDIT_HANDOFF.md`** — the live, detailed operational log for the current Claude/Codex collaborative effort. More granular and more current than this document for "what exactly happened in the last session." Has its own activity log with dated entries; read it before resuming any audit-adjacent work.
- **`ONGOING_PLANS.md`** — narrow, specific in-flight feature plans (currently: Staff timekeeping/payroll redesign details, Rentals multi-tenant booking details). Not a general-purpose planning doc.
- **`MIGRATION_PLAN.md`** — the (completed) CSS-to-Tailwind migration's technical plan. Historical reference now, not active.
- **`.claude/skills/shared-handoff/SKILL.md`** — the actual rules the Claude/Codex handoff convention runs on. Read this if you are about to update `AUDIT_HANDOFF.md`.
- **This document (`PROJECT_JOURNEY.md`)** — the narrative spine and the one place that should always accurately say where things stand right now, suitable for an AI tool with zero prior context on this project.

**Keep this document and `AUDIT_HANDOFF.md` in their separate lanes.** This one is the whole project's history and current-state overview, meant to be read occasionally and kept broadly accurate. `AUDIT_HANDOFF.md` is the tactical, frequently-updated log for the specific ongoing audit/verification effort. When the audit effort eventually fully closes out, fold its lasting lessons into this document's "Established conventions" section below and let the detailed log become historical.

## Established conventions and hard-won lessons

These are real incidents or deliberate decisions from this project's history. Know them before you repeat a mistake this project already paid for once.

- **Committed code is not deployed code.** Supabase Edge Functions (`supabase/functions/`) deploy independently of the Netlify frontend build — `supabase functions deploy <name>`. A function can be correctly rewritten and committed for days while production silently runs the old version, with no error, just wrong behavior (see Chapter 8's notification bug). The same risk applies to `schema.sql`: it's applied once to a fresh project, not tracked as ongoing migrations — an *existing* database needs its own incremental migration (either an appended block in `schema.sql` or a standalone file) run by hand in the Supabase SQL editor. Code existing in the repo is never, by itself, evidence that production reflects it.
- **A table isn't live on Realtime just because a channel subscription exists for it in the frontend.** It must be explicitly added to the `supabase_realtime` publication (`alter publication supabase_realtime add table <name>;`). This has been missed more than once (`members`, `task_access`, `eod_reports`/`report_access`) with no error — just a feature that silently never pushes live updates. Confirm with `select tablename from pg_publication_tables where pubname = 'supabase_realtime';` rather than assuming.
- **RLS impersonation testing must be one single-transaction batch**, not multiple separate tool calls — session-local settings (`set local role`, `set local request.jwt.claims`) don't persist across separate `supabase db query` invocations. The reliable pattern: `begin; set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'; <the actual query>; rollback;` as one file/call.
- **Schema/data-changing SQL goes through the human, not direct agent execution**, for anything that creates real rows or alters structure — present the SQL, have Aaron (or whoever's driving) run it in the Supabase SQL editor, then verify read-only afterward. This project's own tooling has in practice refused direct destructive/structural writes from an agent more than once; don't fight that, work with it.
- **Native browser `confirm()` dialogs can't be driven by scripted automation clicks** in at least one browser-automation setup used on this project — a delete action gated behind `confirm()` will appear to do nothing when clicked via script. Verify the underlying effect via a direct, precisely-scoped SQL query/cleanup instead of assuming the UI click worked.
- **Verification rigor**: when running `npm run lint`/`npm run build` as a check, capture the actual exit code explicitly (`; echo "EXIT CODE: $?"`, output to a file) rather than piping through `tail`, which obscures the real exit status.
- **Attribution**: commits from Claude end with exactly `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` and nothing else in that trailer — another agent's contribution (e.g. Codex) gets credited in the commit body's prose, never as a second `Co-Authored-By` line.
- **Multi-agent handoff discipline**: when more than one AI session may be working this repo, always distinguish *prepared* (code written) from *tested* (checks run) from *committed* from *pushed* from *confirmed live in production* — never collapse these into a single "done." Re-read the shared handoff log before resuming, and never overwrite or silently reattribute another agent's logged work.
- **Deny-list vs. presence-grant access models, used deliberately differently depending on intent.** `members.permissions` is a deny-list (`{}` means full access) specifically so an existing member needs zero data to keep working unchanged when a new feature gate is added. `task_access`/`report_access`/`priorities_access`/`vault_access` are the opposite — a *present* row is required for access, because those exist specifically to *restrict* something that used to be automatic. Don't confuse the two shapes when adding a new gated feature; pick deliberately based on whether you're adding a restriction or a preservable default.

## Codex takeover checkpoint — October 6, 2026

Aaron deferred call/text logging, then selected property contacts and approved the screen preview. Property contacts are now prepared locally for both rental terms, with a searchable shared directory, multi-unit role links, archive/restore and copy number. Migration `supabase/add-rental-contacts.sql` is prepared for Aaron to run manually. Local PostgreSQL access/atomicity checks and mounted phone/desktop UI checks passed; no live migration, commit, push or deploy. Next: Aaron applies SQL, then signed-in live verification. Other rental improvements remain proposals.

Correction to the older handoff: Dallas Property Finder is already committed in `622859c` and present on locally recorded `origin/main`; its production SQL and phone verification are still unconfirmed. Do not repeat the stale commit/push step below.

## Active handoff — read this first

### October 6 approved follow-up — unified completion composer

Aaron approved reusing the task comment box with Comment / Completion details toggles. Implemented locally in TaskClarifications/TaskRow: done defaults to completion mode, separate drafts and file lists, one save for note+attachments, retained draft/error on failure, repeat-save guard, inline saved details/Edit details, old Submit editor removed. Existing View submission preserved. No SQL or notification changes. Actual components mounted with fake data at 390px/1100px; draft isolation, failure/retry, edit/cancel, double-click and TaskRow integration verified. Attachment routing/save payload checked with extracted actual handlers. Lint/build verification recorded in AUDIT_HANDOFF. Not committed, pushed or live; no real task/attachment writes. Existing bug-hunt verification debts below remain open.

### October 6 bug fixes — published checkpoint

Ten bugs fixed in this round. Counts describe separate affected flows; rapid double-click guards are part of the save fixes, not additional numbered bugs.

| # | Bug | Resulting behavior | Publication |
| --- | --- | --- | --- |
| 1 | Moving overdue tasks used the original timezone and left them on yesterday in the viewed timeline | Timed tasks use displayed-zone today/time; original zone metadata and all-day date semantics retained | `4c8e2a1`, pushed |
| 2 | New contacts stayed stale after phone resume or missed live events | Refetch on visible resume, focus, online and subscription reconnect | `7343015`, pushed |
| 3 | Converting comment steps to a checklist cleared the draft before saving succeeded | Await save; retain draft/show error on failure; block concurrent conversion | `67bb76b`, pushed |
| 4 | Report save succeeded but notification failure invited duplicate append on retry | Close after successful save; push is best-effort; concurrent submit guarded | `67bb76b`, pushed |
| 5 | Day priorities combined device calendar date with a different chosen timezone | Today’s date and 23:59 use the same chosen zone | `67bb76b`, pushed |
| 6 | Board Focus Today and roadmap default dates had the same calendar-zone mismatch | Defaults use chosen-zone today; explicit picked dates retained | `67bb76b`, pushed |
| 7 | Lease notes missed updates while the phone app was suspended | Catch-up refetch on resume/focus/online/reconnect | `67bb76b`, pushed |
| 8 | Moving a Vault entry’s folder dropped creator/sharing metadata from its open detail | Retain row metadata and owner controls; late response respects closed/switched detail | `67bb76b`, pushed |
| 9 | An old Staff filter request could overwrite newer results | Ignore outdated results/errors and responses after unmount | `67bb76b`, pushed |
| 10 | Project task creation succeeded but linking failed; retry created duplicates | Atomic owner-only create/link RPC; successful retry reuses existing task ID | `67bb76b`, pushed |

**Verification:** actual handler/effect tests exercised failure, retry, missed-event, clock-boundary and out-of-order-response cases. Local PostgreSQL tested roadmap rollback, retry and RLS denial. Lint/build passed with existing warnings. Roadmap migration was run by Aaron and independently checked read-only: exact function body matches, security invoker, authenticated execution allowed, anonymous denied. Public Netlify bundle `/assets/index-CsENemu9.js` confirmed the new batch at asset level; this does not certify every signed-in workflow.

**Publication records:** `53b8733` (overdue), `cac58ea` (contacts), `0b7bf97` (phased fixes). Application and publication records are pushed to origin/main. Unrelated `.agents/` remains untracked and untouched.

**Next checks, in order:**

**October 6 signed-in verification:** production loaded `/assets/index-CsENemu9.js`. At 390×844, Timeline header, Rentals contacts/search and lease-note editor, Staff dropdown/location list, Reports list/compose entry, Board Projects, Settings/export options and Vault locked entry were inspected. Checked page widths did not overflow. Staff All/Pending/Approved selected states and total labels changed correctly; there are no shifts to validate populated results. Correct lease selected in note editor; no note saved. Aaron confirms Fred and John both appear on his actual phone after refresh/reopen. This proves current visibility, not automatic missed-event recovery. Desktop override reset; Timeline/Staff entry checked. Vault was locked; no export downloaded, credentials entered, records changed or notifications sent. No app-origin errors in captured logs; unrelated Chrome-extension warnings present. This is a scoped read/layout pass, not completion of the full UI/UX or write/access audit.

1. Verify contacts/lease notes catch up automatically after another device adds data while the phone is suspended; refreshed current contact visibility is already confirmed by Aaron.
2. Check Vault folder move preserves Edit/Share, Staff quick-filter switching stays correct, and an owner’s project step produces exactly one linked task.
3. Verify checklist/report save failure handling in a safe test environment; no intentional live duplicate reports or test credentials.
4. Resolve the shared-project “Add to timeline” affordance: viewers still see it but existing owner-only permissions reject scheduling. Atomic RPC prevents orphan creation; it does not grant viewers project editing.
5. Continue scoped access, notification delivery, cross-device and phone checks. Real Vault unlock, actual staff clock-in and Lina’s remaining Inbox/comment checks are not certified by this round.

**Limitations:** report fix addresses notification-induced retry, not every ambiguous save response; no production multi-session concurrency test was run for roadmap locking. Signed-in read/layout and user-reported phone contact visibility checked; live writes and missed-change phone recovery remain unverified. Earlier SQL/data changes have their own recorded verification debt.

### Latest Export checkpoint — October 6, 2026

Export is committed/pushed as `4801425` and confirmed in the public Netlify bundle after Aaron approved publication. Settings → Export records offers one Excel file with separate sheets plus individual exports; Tasks excluded, Vault optional with unlock/confirmation. No SQL needed. Local checks and signed-in preparation passed; production download and actual Vault unlock remain unverified. Next: Aaron checks the published download in his browser. Call/text logging remains deferred. `.agents/` stays untouched.

### Export continuation — October 6, 2026, Codex

Aaron approved the preview for all app records except Tasks and a single multi-sheet Excel workbook. Settings → Export records is implemented locally, with section tabs, individual CSVs and optional Vault unlock/confirmation. No SQL needed. Build/lint and isolated workbook/pagination checks passed; signed-in All records preparation and phone layout checked without unlocking Vault. Export and the preceding documentation refresh remain uncommitted/unpublished. Next: review the local screen, then explicit commit/publish approval for Export. Call/text logging remains deferred.

### Latest checkpoint — October 6, 2026, Codex

Contacts, location service coverage, long-term lease controls and dated lease notes are committed, pushed and confirmed in public Netlify bundles. Lease notes shipped in `9125b9b`; publication records followed in `927e2fd`. Aaron ran the incremental SQL himself (user-reported). The signed-in local app successfully reads lease notes and opens the editor for the correct original lease. Live saves, author restrictions and Realtime delivery remain unverified; local database and phone/desktop UI checks passed. No production test notes were created.

The application working tree was clean after publication; `.agents/` is unrelated and untracked. This documentation refresh is local and uncommitted. Re-check git status on resume.

Next: present the Rentals CSV export scope/preview for approval before implementing. Call/text logging stays deferred. Amarillo still needs real location/lease setup; John and Martin were examples, not seeded contacts. Preserve remaining whole-app and RC Lina verification debt in the historical handoff.

Aaron authorizes publication phase by phase; earlier blanket “don't push” notes were superseded for the delivered features by explicit approvals. He runs production SQL and enters credentials himself. Do not send messages to others. No new export implementation or publication is authorized by this documentation request.

### Historical checkpoint — earlier October 6 (superseded for rental delivery and working-tree state)



**Working tree is NOT clean.** Everything through Bulk Add repeats is committed and pushed (last commit `2d449d6`). Uncommitted and unpushed:
- The Dallas Property Finder work: new `src/components/ExternalToolView.jsx`, `src/lib/externalTools.js`, `supabase/add-external-tools.sql`; modified `src/components/SettingsMenu.jsx`, `src/components/HowToGuide.jsx`, `supabase/schema.sql`, `CLAUDE.md`. Lint and build passed; behaviour verified by mounting the real component and Settings in the browser pane (listed person sees the row and it opens full screen with the right sandbox/referrer/link; unlisted person sees nothing; title wraps on phones).
- `ONGOING_PLANS.md` — a new, **unapproved** plan section "Rental contacts, call logging, lease notes, unit files, reply templates and export".
- `.agents/` — an untracked folder from another tool; leave it alone.
- `docs/ui-ux-overhaul-plan.md` — a copy of the previously external UI/UX plan so it travels with the repo.

**Next concrete steps, in order:**
1. Aaron runs the Dallas SQL in the Supabase SQL editor (the full text with the real address was given in chat; the repo file has a placeholder). The final query should show one row with `people_who_can_see_it` = 2. If it shows 0 or 1, a member display name isn't matching `ada`/`aaron`. To fix a wrong address: `update external_tools set url = 'https://…' where title = 'Dallas Property Finder';`.
2. After he confirms, commit and push the Dallas work (only with his go-ahead; leave `ONGOING_PLANS.md` and `.agents/` out unless he says otherwise). Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
3. Aaron checks on a real phone: Settings → Dallas Property Finder → map gestures work, and Excel/PDF exports download inside the frame. Not tested by any AI session. The finder has no login of its own, so its address is its only protection.
4. Rental contacts plan: Aaron is becoming Ada's point of contact for tenants and vendors via a shared Google Voice number. His constraints: phone-first; door/lockbox codes only in the Vault; same access as Rentals (hidden from members without Rentals permission and from staff); no SSNs or bank details; he later asked for lease-notes context and a major CSV export. **"Don't push or deploy. Give me any SQL I need to run in Supabase by hand."** The plan has 17 open questions and is waiting for his approval — do not implement before he approves it.

**Verification debt (honest list):** an AI session cannot sign in, so none of the following has been seen in the real signed-in app: UI/UX Phases 1–5, Vault codes, recurrence changes, Bulk Add repeats, the Settings tool row. Also open: the Today-header density check at 375px; RC Lina's two self-check items (Inbox scoping, comment-notification targeting); Netlify's build status for the pushed commits has not been confirmed. The Phase 4 contrast sweep did not cover Vault, Reports, Staff, Inbox or Settings.

**Working rules from Aaron:** show options/mockups and wait for his pick before implementing or committing design/behaviour choices (memory: `feedback_show_before_building`); an AI never runs SQL against Supabase, never enters credentials, and sends nothing to other people — he does those. Multiple Claude sessions may touch this repo; re-check `git status` first. Edge Functions deploy separately from the frontend; nothing in this window changed an Edge Function.

### Earlier handoff text (Oct 2, 2026 — partly historical)


**(Oct 2 text:) the project was in a deliberate, clean pause.** The working tree was clean and everything was committed and pushed to `origin/main` (no feature branches; this whole project has been developed via direct commits to `main`).

**What's fully done, verified, and not waiting on anything:**
- The 6-phase deployment-cohesion bug audit (Chapter 9) — complete, see `AUDIT_HANDOFF.md`'s phase table.
- Per-person Priorities — schema, impersonation (both directions), live production browser viewing, and admin grant/revoke UI, all independently verified.
- The vault's per-entry-sharing migration — confirmed live in production (this corrected a stale "unconfirmed" flag that had been sitting in `AUDIT_HANDOFF.md`).
- 5 of 7 "real browser click-through" verifications from the broader `multi-member-permissions.md` feature-delivery plan (an external, non-repo planning doc at `/Users/aaron/.claude/plans/multi-member-permissions.md` — not reliable as a shared handoff by itself, per `AUDIT_HANDOFF.md`'s own note, but useful background): My Profile, the admin member-credentials form, Projects quick-add/collapse/undo, Cork Board targeted sharing, and attachment privacy.

**What's genuinely open right now:**
- Two remaining click-throughs — **Inbox scoping** (does RC Lina's Inbox only show activity from tasks actually assigned to her?) and **task-comment notification targeting** (does the "Notify" picker on a task comment show up and default sensibly for her?) — both need RC Lina's own real login to test properly, not Aaron's or Ada's.
- Rather than continue those synchronously, Aaron asked for (and received) a plain-language, non-technical checklist to hand directly to RC Lina so she can self-check both on her own device and report back. **That checklist was given to Aaron in-chat, not sent to Lina by any AI session — sending it is his to do.** If you're picking this up and don't know whether she's replied yet, ask Aaron rather than assuming either way.
- Once her reply comes back (either "all good" or a specific flag), that closes out the click-through list entirely. If something's flagged, treat it as a new, real bug report — investigate it the way Chapter 8/9's bugs were investigated (read-only first, confirm root cause before changing anything, verify the fix the same rigorous way).

**Nothing beyond the above is blocked, half-finished, or silently waiting.** If you arrive here and the state above doesn't match what you observe (e.g. `git log`/`git status` show more recent activity than this document reflects), trust what you observe over this document, and please update this document's "Chapter 10" / "Current state" / "Active handoff" sections to bring it back in sync — that upkeep is the whole point of this file existing.

**What's next, started Oct 2, 2026:** a UI/UX overhaul, scoped and phased at `/Users/aaron/.claude/plans/ui-ux-overhaul.md` (external, non-repo planning doc — same caveat as `multi-member-permissions.md` above: useful background, not a reliable shared-handoff record by itself). Explicit goal, in Aaron's own words: make the app "very easy to learn and used by someone who is never used any apps before." The plan grounds itself in named, established UX principles (Nielsen's heuristics, Norman, Krug, Fitts's/Hick's/Jakob's Law, progressive disclosure, recognition-over-recall), audits Tandem's actual current state against them (including a real mobile title-truncation bug found live during the audit, and a genuine example of a task's comment thread being used as an ad-hoc support-ticket log because the UI doesn't bridge to the checklist feature it should be using instead), and lays out six phases: 0 (fix what's actively broken), 1 (first-time learnability foundations), 2 (simplify the core daily loop), 3 (consistency/recognition-over-recall), 4 (accessibility/forgiveness hardening), 5 (final polish). **As of this writing: Phase 0's bug is fixed, and both open decisions are resolved.** The mobile title-truncation bug (a task title crushed to 1.5px wide by an uncapped time column) is fixed, verified with real before/after measurements, committed (`5208dc1`), and pushed — root cause was `.day-timeline-block-time` having no width ceiling, now capped at 45% with a 100px floor guaranteed to the title and the zone badge wrapping as a fallback. Aaron confirmed: Staff (property-manager) screens **are** in scope for the "never used an app before" bar (not exempted just because they were already designed with a less-technical user in mind — the plan's Phase 2/3 sections were updated to name specific Staff-flow items), and the phase order (0→1→2→3→4→5) stays as written, no reordering. **Phase 1's audit pass is done and its first two items are built, verified, and pushed (`769e3ed`).** The audit (live browser inspection + source reads) found: no first-login experience anywhere in the app; icon-only task-action buttons (Edit/Duplicate/Send to board/Delete etc.) already had correct `title`/`aria-label` attributes but relied on hover-only tooltips, which mobile — this app's primary surface — structurally never triggers; and `StaffClockView.jsx` already does icon+visible-label correctly everywhere, making it the literal template to copy rather than a gap itself. Built against a mockup shown and approved first: `WelcomePrimer.jsx` (a one-screen, dismissible welcome card on first login, tracked in localStorage per member id — no schema change) and `TaskRow.jsx`'s action row now showing icon+text on every button (verified at both 375px mobile, where up to 6 buttons wrap cleanly to 3 rows, and desktop). **Phase 1's remaining two items are now built too (`050fa18`, `9c751c5`, Oct 2, 2026).** Header icons: `IconButton` gained a `headerLabeled` size, so Nudge and Settings now show icon + visible text (side by side on wide screens; icon stacked over a small label on phones, with a 44px touch target, same shape as the bottom nav). The status chevron was deliberately left icon-only — it sits directly beside the Online/Offline pill and reads as that pill's dropdown, and a third labeled button would not fit a 360px phone's header (a first attempt did wrap at 360px; spacing was tightened until it fit on one row). Contextual help: a new `HelpHint.jsx` — a closed-by-default, always-text-labeled "What's this?" link that opens a one-sentence plain-language note in place — placed at four spots where the How-to FAQ already records real confusion: the Overdue and Completed-today modals ("did my checked-off task vanish?"), the pin/project "Share with" row, and the status sheet for members who cannot set their own status. A stale FAQ answer (it still said a recurring task's next copy is only created once the current one is done) was corrected at the same time. **Verification caveat, honestly stated:** the preview browser was not signed in and no credentials were entered, so the header was verified against a replica built from the real class strings (at 375px, 360px, and desktop) and `HelpHint` was mounted and exercised directly at 375px, not seen inside the real signed-in modals — worth a glance on a real phone. **Phase 1 is complete.** **Phase 2 (simplify the core daily loop) is in progress, Oct 2, 2026 — four of five items built and pushed** (`fb3d5fa` plus the Staff commit): the New Task form now shows only title/who/when with the rest behind "More options"; the weekday picker only appears for "Selected weekdays" (and no longer silently turns a task recurring); a drafted comment that reads like steps offers "Add as checklist"; and the Staff clock-in screen got plain-language fixes (Stop choices explained, rate hint, "Far from site" instead of "flagged… radius", "Waiting for approval", a location-setup hint). **Still open: the Today-header density check at 375px** — it needs a signed-in view of the real Today tab, and the preview browser has no session (credentials are never entered by an AI session here). `StaffClockView`'s changes are lint/build-checked only, not rendered. Full detail in the plan file's Phase 2 status block.

**Phase 3 (consistency and recognition-over-recall) was built Oct 2, 2026** (`3d2f6f7`, `fc7f3b4`, plus the copy-pass commit): (1) every native `window.confirm()` (15 call sites) now goes through one in-app `ConfirmProvider`/`useConfirm()` with labelled buttons and a four-tier rule documented in `CLAUDE.md` ("Confirming destructive actions") — do not add a new `window.confirm()`; (2) Bulk Add has a Guided mode (default; remembered per device) that builds the same paste text from plain fields, with "Paste a list" kept for people who know the format; (3) the admin access form and staff profile form copy was rewritten in plain language; (4) Staff-facing copy was largely covered in Phase 2. Verified by mounting the real components in the browser at 375px; the preview browser still has no signed-in session, so nothing was seen inside the real signed-in app. **Phase 4 (accessibility and forgiveness hardening) was built Oct 2-3, 2026** (`891b1be`, `5798570`, and the errors commit): measured contrast failures fixed with new colour tokens (gold buttons were 2.3:1; field outlines ~1.3:1; muted text 3.2-3.9:1), priority no longer colour-only (dot shapes plus a High/Low badge), the done-checkbox redrawn as a 40px tap target with other small controls enlarged on phones, and ~100 raw `err.message` displays replaced by `friendlyError()` (plus the account Edge Functions' own messages finally reaching the screen). The rules for new UI are in `CLAUDE.md` under "Accessibility rules" — notably: never `text-white` on `bg-accent`, never opacity on a container that holds controls, never show `err.message` raw. Verified by mounting real components at 375px in light and dark (0 contrast failures on the screens swept); NOT seen in the signed-in app, and several screens (Vault, Reports, Staff, Inbox, Settings) were not swept. **Phase 5 (final polish) was partly built Oct 3, 2026:** ~25 empty states now say what belongs there and what to do next (Today's empty day names the period/person and points at +; Pins, Projects, Inbox tabs, Reports, Vault, Rentals, Bulk Edit), and every "Loading…" is one `LoadingText` component with `role="status"` (conventions in `CLAUDE.md`, "Empty and loading states"). **The Phase 5 full-app click-through at desktop and phone width has NOT been done** — it needs a signed-in session in the browser pane, which an AI session cannot create. That, plus the still-open Today-header density check from Phase 2 and the two RC-Lina self-checks, is the remaining verification debt for the whole UI/UX overhaul; nothing from Phases 1-5 has been seen inside the real signed-in app. The Phase 2 Today-header density check is still open for the same no-session reason.

## October 6 follow-up — location service contacts

After the original contacts feature was published, Aaron approved grouping service people by location (John as the Amarillo handyman, Martin for Rachel cleaning were examples, not seeded data). Location-wide coverage plus optional specific-unit links is prepared locally; tenants stay unit-specific. Manual migration `add-rental-contact-locations.sql` is pending. Local access/atomicity and mounted phone/desktop UI checks passed; real unit mappings are not independently verified. New SQL lists them for Aaron to review. No publication of this follow-up yet.

October 6 update: Aaron reports the location-contact SQL ran successfully. Publishing the approved Contacts follow-up under the existing public-site authorization; signed-in functional checks remain pending.

October 6 bug fix prepared: Amarillo could not receive a lease because Long Term lacked add/edit controls and its + pointed at an unmounted calendar. Reused the booking form for long-term leases, fixed +, verified both signed-in entry points without saving records. No SQL needed. Publishing rejected by automatic approval review pending explicit approval for this fix.

## Historical lease-notes checkpoints — October 6, 2026 (published status above supersedes these)

Contacts, location coverage, and the long-term Add/Edit lease fix are published. Aaron next requested the lease-notes phase. A sample screen preview is prepared at `/Users/aaron/Documents/Codex/2026-10-06/i/outputs/lease-notes-preview.html`: latest note on long-term cards and a full dated author history. Proposed rules allow Rentals members to read/add, authors to edit/archive/restore their own notes, and preserve each note under its original lease. Layout and editing rules still await approval; Aaron’s request to update Markdown records the status only. No lease-notes application code or SQL exists yet. ONGOING_PLANS.md holds the current scope and next action. Export follows; call/text logging remains deferred.

October 6 continuation: Aaron asked to go on after the lease-notes preview/Markdown checkpoint. Implemented the shown long-term latest-note/history flow with author-only changes, archive/restore, original-tenancy snapshots and past-lease picker. Manual SQL `add-rental-lease-notes.sql` is prepared; no production migration or publication. Local PostgreSQL permission/retention tests and mounted 390px/1280px lifecycle checks passed. Next: Aaron runs SQL, then signed-in verification and explicit publishing authorization.

October 6 migration checkpoint: Aaron reports running the lease-note SQL. Signed-in local note panels now load successfully from Supabase; Findlay’s Add note editor shows the correct original lease. No production note was created during verification. Live writes/access/Realtime remain unverified; local checks passed. Lease-note code is not committed or published. Next: explicit commit/publish authorization.

October 6 publication checkpoint: Aaron explicitly approved committing and publishing lease notes. Feature commit `9125b9b` pushed to origin/main; public Netlify HTML and bundle `/assets/index-C6OnU2O3.js` confirm deployed note controls. No production notes created during verification. Live saves/author access/Realtime remain outstanding. Next proposed phase is Rentals CSV export scope; call/text logging stays deferred.

### Active follow-up — October 6, 2026: overdue move

Codex reproduced Aaron's production report: Move all to today succeeds but tasks remain overdue because moving uses original PHT date while the timeline shows CT. Jack and Jill's edit form shows October 6 at 1 AM PHT; row shows October 5 noon CT. Proposed fix uses display-timezone today/time for timed tasks, preserving original zone metadata; user approval pending. No code change or publication. See AUDIT_HANDOFF.md for evidence.

Overdue follow-up checkpoint: Aaron approved the fix. TaskBoard's shared move path now uses display-zone today/time for timed tasks and original-zone calendar semantics for all-day tasks, preserving stored zone/duration. Focused regression checks, lint and build passed. Prepared locally; not committed, pushed or live. Next: publication when authorized.

October 6, 2026 publication checkpoint: Aaron requested committing the verified overdue timezone fix. Committing TaskBoard.jsx and these checkpoint notes only; push/deployment not requested in this step.

October 6, 2026 — Codex: overdue timezone fix committed as `4c8e2a1` and successfully pushed to origin/main at Aaron's request. Local regression checks, lint and build passed; Netlify deployment and production move behavior have not yet been verified.

Active contact follow-up (October 6): Aaron reports missing new contacts after reopening the phone app. Confirmed source gap: contacts hook has no resume/reconnect catch-up fetch. Proposed fix awaiting approval; phone behavior and production Realtime publication not yet verified. No app change.

Contact catch-up checkpoint (October 6): approved repair implemented locally in useRentalContacts. Resume/focus/network recovery/subscription reconnect now refetch contacts; cleanup verified. Mocked hook lifecycle checks, lint and build passed. Not committed, pushed or deployed; real phone check remains pending.

October 6, 2026 — Codex publication checkpoint: contact resume/reconnect refresh committed as `7343015` and successfully pushed to origin/main at Aaron's request. Local lifecycle checks, lint and build passed. Netlify deployment and real phone verification remain pending.

Bug hunt Phase 1 checkpoint (October 6): checklist conversion draft preservation and report-notification duplicate retry repairs prepared locally. Actual callback-chain failure/retry/double-click checks, lint and build passed. Not committed or pushed; no production UI/phone write verification. Phase 2 and Phase 3 remain pending.

Bug hunt Phase 2 checkpoint (October 6): timezone date and lease-note resume/reconnect fixes prepared; actual helper/effect regression checks, lint/build passed. Phases 1–2 are still local and uncommitted/unpublished; no live writes or phone verification. Phase 3 remains pending.

Phase 3 first checkpoint (October 6): actual-handler fixture tests reproduced Vault folder move dropping owner/sharing metadata, Staff old-filter response overwriting new results, and Board create-then-link failure generating duplicate tasks on retry. No Phase 3 repairs yet. Proposed next subphase: Vault metadata + Staff request ordering; then choose durable Board create/link repair. Phases 1–2 remain local/unpublished. Live access/phone/notification verification outstanding.

Phase 3A checkpoint (October 6): Vault folder moves retain owner/sharing/TOTP details and respect closed/switched detail; Staff ignores old-filter responses, stale errors and post-unmount results. Actual-handler fixtures, lint/build passed. Phases 1–3A remain local/uncommitted/unpublished; no live writes. Phase 3B Board create/link duplicate protection remains to design and prepare.

Phase 3B checkpoint (October 6): atomic idempotent roadmap task creation/linking prepared in add-roadmap-task-atomic.sql, schema.sql and frontend RPC path. Local PostgreSQL rollback/retry/RLS checks and lint/build passed. Existing owner-only project scheduling rule retained; shared-viewer Add button mismatch remains. Production SQL must be applied manually before publishing frontend. All bug-fix phases still uncommitted/unpublished; live phone/access/notification verification incomplete.

October 6 migration checkpoint: Aaron ran the roadmap SQL. Read-only production query confirms the function exists, exact body matches, uses invoker security/public search path, authenticated execute allowed and anonymous denied. No live tasks created for verification. Application fixes remain uncommitted/unpushed; next is authorized publication and signed-in/phone checks.

October 6, 2026 — Codex publication checkpoint: Phases 1–3B committed as `67bb76b` and pushed to origin/main following Aaron's acknowledgment of publication-ready fixes. Public Netlify bundle `/assets/index-CsENemu9.js` contains atomic roadmap RPC, report push-failure warning and opt-in task-save error propagation. New frontend code confirmed deployed at public asset level; actual signed-in write flows/phone resume still unverified. Roadmap function separately confirmed live with matching body and execute permissions. No production test writes or secrets used. Remaining: shared-viewer project Add button mismatch, broader live access/notification checks, real-phone validation.

October 6 documentation checkpoint: Aaron requested an updated Markdown round-up. Current state and Active handoff now enumerate all ten fixes, publication/verification evidence and next checks; older preparation entries remain historical. This documentation refresh is local, not committed/pushed.

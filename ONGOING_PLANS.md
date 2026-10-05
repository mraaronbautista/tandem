# Tandem — Ongoing Plans

This file is the canonical home for work that is approved but not fully shipped yet.

- Keep only active plans here. Remove a plan after it ships; `CLAUDE.md` documents the resulting architecture and behavior.
- Record product decisions, implementation phases, unresolved choices, and the next concrete action—not a second copy of the code documentation.
- Update the status checklist whenever a related commit lands.
- If implementation changes the plan, update this file in the same commit.

## Staff timekeeping and payroll redesign

**Status:** Approved; implementation in progress.

### Product goal

Give Aaron and Ada a remote-friendly way to verify the property manager's attendance, approve hours, and prepare payroll without maintaining a second list of properties or manually finding geographic coordinates.

Geofencing is an exception signal, not a hard attendance gate: a shift outside the expected radius is recorded and flagged for review.

### Decisions

- Physical locations are independent of companies: Rachel and Parkside are current places, while future acquisitions can become additional locations regardless of whether Awa or Azu manages their units.
- A rental unit belongs to at most one physical location; one location can contain any number of units. Staff clocks into the location, never an individual unit.
- `work_sites` represents those physical places and remains the geofence configuration because rental properties do not contain coordinates and staff may also work at non-rental locations. `rental_properties.work_site_id` supplies the many-units-to-one-location link.
- The admin UI must not ask Aaron to re-enter a rental property's name or address.
- Latitude and longitude remain hidden under advanced details.
- A configured location receives a sensible default radius (currently proposed: 150 meters).
- Location setup first attempts to derive a map point from the property's saved address through an explicit OpenStreetMap search; it does not autocomplete or request staff location permission.
- If address lookup is unreliable, the on-site property manager may capture the point; that point remains pending until Aaron or Ada approves it.
- Standard/emergency rates are snapshotted at clock-in, so editing rates never reprices past shifts.
- The existing staff/member separation, RLS boundaries, server-side geofence calculation, and RPC-only clock-out remain intact.

### Member-facing Staff tab

1. **Hours overview**
   - Payroll-period selector.
   - Pending hours/pay, approved hours/pay, and flagged-shift count.
   - Shift cards with property, clock times, duration, rate, pay, location status, and approval action.
   - CSV export uses the same visible payroll period and status filters.
   - A guided onboarding state replaces the large empty gap when no shifts exist.

2. **Property manager**
   - Compact profile card with name, standard rate, emergency rate, and active state.
   - Edit and deactivate/reactivate actions.
   - Deactivation must not strand an open shift.

3. **Clock-in locations**
   - Show physical locations such as Rachel and Parkside, with their Awa/Azu units nested underneath for context.
   - Show a clear state for each location: Needs setup, Awaiting approval, Ready, or Inactive.
   - Let members create a location group and select all units physically located there.
   - Permit a group to be saved before coordinates are available; it remains hidden from staff until ready.
   - New acquisitions become another location when operational, without changing the company/location model.

### Staff-facing clock view

- Keep the phone-first Start/Stop experience.
- Request browser location permission only when staff taps Start shift, when the location reading is needed; do not prompt on login or while merely viewing the clock screen.
- Require a successful location reading at clock-in and provide a clear retry state.
- Suggest the nearest configured property while allowing a manual property override.
- Show selected property, rate, elapsed time, geofence flag, recent shifts, and estimated pay.
- Explain when no clock-in location is ready instead of exposing a technical/database error.
- Clock-out remains possible when its location reading fails.

### Implementation phases

- [x] Audit the existing staff feature and document the revised product direction.
- [x] Finish the reliability/mobile baseline: clock-in retry, no-location state, staff profile editing, and overflow-safe cards.
- [x] Replace the raw empty state with the Hours overview/onboarding layout.
- [x] Load and present properties from both Awa and Azu.
- [x] Replace “Add site” with “Manage clock-in locations” and property-first configuration.
- [x] Replace one-location-per-unit with physical location groups that can contain multiple Awa/Azu units and future acquisitions.
- [x] Add user-triggered address lookup and hide technical coordinates by default.
- [x] Keep staff location permission scoped to the Start shift action.
- [x] Add on-site capture with member approval fallback — schema: five nullable `pending_*` columns on `work_sites` (not a child table — a site has at most one live geofence point regardless of capture attempts, so a resubmit before approval just overwrites), a new `staff_submit_location_capture()` security-definer RPC (staff has zero direct write RLS on `work_sites`, same reasoning `staff_clock_out()` already established), and a third SELECT policy so staff can see (but not write) a needs-setup/pending site. Approve/reject are plain member updates, not RPCs, since members already hold unrestricted `work_sites` UPDATE RLS. `workSiteStatus()` (`src/lib/staff.js`) is now the single 4-state classifier (`ready`/`pendingApproval`/`needsSetup`/`inactive`), replacing logic that used to be duplicated inline in `StaffLocationsManager.jsx` and `StaffLogsView.jsx`. Locally verified (mocked-Supabase harness) — capture, recapture, approve, and discard all confirmed end to end. Its own incremental SQL block (and the earlier-still-pending "Physical staff locations" block, discovered un-run at the same time) are both now live on Supabase — confirmed via direct schema queries, not just assumed. The capture/approve/discard *UI flow itself* hasn't been clicked through live yet, only confirmed structurally (see the still-open verification item below).
- [x] Verify member desktop/mobile and staff mobile flows against the live Supabase project — signed in as the real `pmanager` staff account and as Aaron (real credentials, real live project, not a mock) and ran the existing clock-in → clock-out → member-approval cycle end to end. Confirmed via direct SQL against the live DB, not just the UI: `stamp_time_entry_meta()` correctly stamped `rate_amount`/`distance_from_site_m`/`flagged`, `staff_clock_out()` correctly stamped `clock_out_at`/lat/lng, and the member `approveTimeEntry()` update correctly set `status`/`approved_by`/`approved_at`. Test work site and time entries created for this were deleted afterward (`work_sites`/`time_entries` both back to 0 rows). Not yet covered: the on-site capture/approve/discard flow's own UI (schema confirmed live, per above, but nobody has tapped "Capture location" for real yet), and the admin dashboard at a genuine desktop-width viewport specifically (testing here was done at a narrow/mobile-width viewport).
- [x] Run security checks for RLS, geofence stamping, clock-out ownership, and deactivation with an open shift — a genuine adversarial pass against live Supabase, using real password-grant access tokens for `pmanager` (staff) and Aaron (member), not the elevated CLI access used for the migrations/earlier verification. Six things attacked directly via the REST API, all confirmed correct except one:
  - Staff PATCHing `latitude`/`longitude`/`active` directly on `work_sites`, bypassing the RPC — **blocked** (0 rows matched, row unchanged; staff has no UPDATE policy on this table at all).
  - Staff SELECTing `work_sites` with an archived-but-still-coordinates-having row present — **correctly excluded**; only the genuinely needs-setup and already-ready rows came back.
  - `staff_submit_location_capture()` called against an already-ready site — **rejected** (`"work site not found or already configured"`); called against a genuinely needs-setup site — succeeded, correctly stamped `pending_captured_by` to the real caller's id (not client-suppliable).
  - Resubmitting a capture on the same still-pending site — **allowed**, correctly overwrote the previous pending point (the intentional "self-correcting a bad tap" design).
  - Staff PATCHing their own `time_entries` row directly (self-approve, fabricate `rate_amount`, set `clock_out_at`) — **blocked** (0 rows matched; confirms staff has zero UPDATE access on this table, not even for their own rows — clock-out really is RPC-only).
  - `staff_clock_out()` called with a nonexistent entry id — **rejected** (`"time entry not found, not yours, or already clocked out"`); called with a real entry id for a genuinely open shift — succeeded correctly.
  - **Real gap found**: deactivating a staff account while they have an open shift (`ONGOING_PLANS.md`'s own stated decision: "Deactivation must not strand an open shift") — `staff_clock_out()` correctly refuses a deactivated account (`"not an active staff member"`, matching `is_staff()`'s `active` check), and there's currently **no UI path for a member to close that stranded shift either** — `StaffLogsView.jsx` shows it as "in progress" with no action available (Approve is gated on `clock_out_at` being set, and nothing else touches it). The only way to close it today is a member's own raw DB update, which RLS does permit (confirmed: a member's unrestricted `time_entries` UPDATE covers this), but there's no button for it. **Not fixed yet** — flagging as a real, still-open product gap rather than closing this checklist item's own scope by silently building something unrequested.

  All test fixtures (3 work_sites, 3 time_entries, one temporary deactivate/reactivate cycle) created and cleaned up via the same live project; both tables confirmed back to 0 rows afterward, `pmanager` confirmed reactivated.
- [x] Give a member a way to close a shift stranded open by deactivation — `forceClockOutEntry()` (`src/lib/staff.js`), a plain member-side update (no RPC needed, same reasoning `approveTimeEntry()` already relies on — members already hold unrestricted `time_entries` UPDATE RLS, confirmed by the security pass above). Sets `clock_out_at` to now, leaves `clock_out_lat`/`clock_out_lng` null rather than guessing at a location a remote member has no way to actually know. New "Force clock-out" button in `StaffLogsView.jsx`'s entry card, shown only while `!clock_out_at`, gated behind a native `confirm()` since it directly determines pay. Verified live against the exact reproduced scenario (a real deactivated `pmanager` shift, stranded open) — Force clock-out correctly closed it, Approve then worked normally afterward on the same entry, confirmed via direct SQL that `clock_out_lat`/`lng` were left null. Test data cleaned up, `pmanager` reactivated, both tables back to 0 rows.
- [x] Add payroll-period filtering, summary metrics, and filter-aware CSV export — `staff.payroll_cadence` (new `staff_payroll_cadence` enum: `weekly`/`biweekly`/`twice_monthly`/`monthly`, default `biweekly`), edited via `StaffProfileForm.jsx`'s new cadence `<select>`. `startOfPeriod()`/`BIWEEKLY_ANCHOR` (`src/lib/tasks.js`) are now exported and reused unchanged for weekly/biweekly/monthly; `twice_monthly` (two fixed calendar halves per month, not an N-day cycle) gets its own `startOfTwiceMonthly()` in `src/lib/staff.js` — caught and fixed a real bug here during verification: `new Date(0, month, day)` triggers the Date constructor's year-0-99-to-1900-1999 remapping, which combined with `month` being a large absolute count landed the computed date centuries off; fixed by using a real 4-digit base year (2000) instead. `StaffLogsView.jsx` gained a `‹ [pay period] ›` stepper (reusing `EndOfDayReportForm.jsx`'s exact pattern) in its own row below the existing status tabs, a "Show all time" escape hatch back to the original unscoped view, and summary metrics (total pay, total hours, pending/approved counts) alongside the existing total. `fetchAllTimeEntries()` already supported `from`/`to` — this was the first caller to actually pass them. `StaffPayrollExport.jsx` needed only a `periodLabel`/`periodDates` prop addition (description text + payroll-period-based filename) since the entries it receives are already period-filtered upstream. `npm run lint`/`npm run build` clean. Verified via direct math checks against the exact shipped `startOfTwiceMonthly()` code (month/year-boundary stepping, e.g. Aug 20 2026 stepping back through Aug 16/Aug 1/Jul 16/Jul 1, and a Dec→Jan rollover) — no live Supabase in this sandbox (`.env` holds placeholder values), so the schema migration and the UI's actual live behavior are still unverified; see the item below.
- [x] Apply the `staff_payroll_cadence` schema migration to the live Supabase project (`qizvsymlntbukuhypkxh`, via `supabase db query --linked`) — confirmed via direct schema query beforehand that `payroll_cadence` didn't already exist, applied the `create type`/`alter table` block, then confirmed via a second direct query that the column landed with the correct default (`Property Manager`'s existing row reads `payroll_cadence: "biweekly"`, no backfill needed since it's a `not null default` column). Not yet covered: clicking through the cadence `<select>` in `StaffProfileForm.jsx` and the period stepper in `StaffLogsView.jsx` as a real signed-in member — this sandbox has no real Ada/Aaron session to drive that with, so it needs a real click-through by Aaron or Ada before this item can close.
- [x] Click through the on-site capture/approve flow as a real session — the first actual live click-through of this flow, via a direct user report rather than a deliberate verification pass: the property manager tapped "Capture location" and saw the expected success message, but the location never showed as "Awaiting approval" on Ada/Aaron's side. **Real gap found**: `StaffLogsView.jsx` only ever fetched `work_sites` once, on mount — unlike `time_entries`, there was no Realtime channel for it, so a member already sitting on an open Staff tab had no way to see a capture land; the deployment note's original reasoning ("`work_sites` changes rarely enough that an explicit reload after an admin edit is fine") stopped holding the moment staff gained an independent write path onto that table. **Fixed**: added a second `staff-work-sites-changes` Realtime channel (`reloadSites()`, no filter dependencies, alongside the existing `staff-time-entries-changes` one) in `StaffLogsView.jsx`, and documented `alter publication supabase_realtime add table work_sites;` as a required manual step next to the on-site-capture migration block in `schema.sql`. The user then asked the natural follow-up before finishing their live test — does an approve/discard update the pmanager's own screen live? — which surfaced the identical gap in the other direction: `StaffClockView.jsx` also only fetched `work_sites` once, on mount, with no channel at all. Fixed the same way: a `staff-clock-work-sites-changes` channel calling a new `reloadSites()` (split out of `loadAll()` there too, so it doesn't also re-run the profile/active-entry/history fetches or disturb an in-progress Start flow on every unrelated site change). User has run the publication statement live and is testing the full capture → approve/discard round trip. Live testing turned up a second, unrelated real bug in the same flow: two sites (937 Findlay, 1072 Rachel) ended up `active = true` with `latitude`/`longitude` still null after the user deliberately cleared their coordinates to reset them for a fresh capture test — an invalid state the capture RPC's own "not active" guard can't recognize as re-capturable, surfacing as "work site not found or already configured" with no way out except a manual DB fix. Root cause: `StaffWorkSitesForm.jsx`'s `shouldBeActive` used `site.active || (...)`, so an already-active site stayed active regardless of what was actually submitted for latitude/longitude on that same save. **Fixed**: `shouldBeActive` now requires `hasCoordinates` as a precondition in every branch (`hasCoordinates && (site ? site.active || existingWasUnconfigured : true)`), so clearing coordinates on an active site correctly deactivates it instead of stranding it. The two already-corrupted rows still need a one-time manual fix (`update work_sites set active = false where active = true and latitude is null and longitude is null;`) before they're recapturable — not yet confirmed run. The original Realtime question (does the member's screen update live on a fresh capture, no manual reload) is also still unconfirmed — this item stays open until both are verified.
- [ ] Click through the cadence field and payroll-period stepper as a real member session (Ada or Aaron), confirm the stepper correctly scopes real `time_entries` rows for at least one non-biweekly cadence, then update `CLAUDE.md`'s Property manager section, remove this completed plan, commit, and push the final phase.
- [ ] **Diagnose why the work_sites Realtime channel doesn't update live even though the publication is correctly configured** — confirmed via live query: `work_sites` and `time_entries` both appear in `pg_publication_tables` for `supabase_realtime`, ruling out the publication itself. A manual fetch (edit-and-resave) correctly returns the updated pending state, ruling out the write/read path. What's unconfirmed is whether the channel subscription itself ever reaches `SUBSCRIBED` and whether an event payload actually arrives client-side — temporary `console.log`s were added to `staff-work-sites-changes` in `StaffLogsView.jsx` for exactly this (still in place, not yet removed) but the user hasn't yet reported back what appeared in DevTools during a live capture test.
- [x] Add manual time-entry editing/creation and staff-initiated correction requests, requested directly ("a way to clear/modify the time submitted," "pmanager/staff should also have an option to ask for a manual change which will notify me/ada", confirmed to cover both fixing an existing entry and flagging a shift with no entry at all). Schema: `"members can insert time entries"` INSERT policy (members previously had none at all — only staff could insert, via clock-in), and a new `time_entry_requests` table (staff plain-INSERT their own row, members read/resolve, no RPC needed since there's no existing-row trust boundary to cross the way `staff_clock_out()`/`staff_submit_location_capture()` needed one). `StaffTimeEntryForm.jsx` (new) handles both editing an existing shift's times and adding one manually — a manual entry reuses the selected site's own coordinates for the required `clock_in_lat`/`clock_in_lng` columns (no real GPS reading exists for a shift nobody clocked into live) and is inserted pre-approved. `manual-notify` gained a `time_entry_correction_request` kind — the one call in that function where the caller is staff, not a member, so it notifies both Ada and Aaron unconditionally rather than "whoever isn't the caller." Built with live-update channels from the start this time (`staff-time-entry-requests-changes` on both the admin and pmanager sides), rather than bolting them on after a live report the way `work_sites` needed. Verified: `npm run lint`/`npm run build` clean, and every new UI element checked visually against the real built CSS (no live Supabase in this sandbox to click through the actual flows). **Not yet done**: the `alter publication supabase_realtime add table time_entry_requests;` step hasn't been run live, and none of create/edit/request/resolve has been clicked through against real data.
- [x] Add a DELETE policy for members on `time_entries` (`deleteTimeEntry()`), requested directly right after shift editing shipped — a duplicate, a bogus manual add, or a mistaken clock-in had no way to actually go away. Its own small incremental block (separate from the one above, run independently). Verified visually at 375px width — the entry card's action row can now hold five pieces (pay, Edit, Delete, Force clock-out, Approve), so it gained `flex-wrap`.
- [x] Add a break/clock-out choice, geofence-exit detection, and shift reports — requested directly, with three product decisions locked in via AskUserQuestion before building: break is an ordinary clock-out/clock-in with no new pause/resume schema (tagged `"(Break — will resume shortly)"` via the new report mechanism so the gap reads as deliberate); geofence exit only ever prompts, never auto-clocks-out; the end-of-shift report is optional, never blocking Stop. A fourth decision came from a follow-up mid-build (the report needed to be submittable/editable later, not just at the moment of stopping) and a fifth from the one after that (staff has no push notification capability at all yet, so "ask for a report" from the member side is an in-app prompt, not a push — building real push support for staff was flagged as out of scope for this pass, its own future item if ever wanted). New `staff_submit_shift_report()` RPC (mirrors `staff_clock_out()`'s shape, appends to `notes` rather than overwriting, clears `report_requested_at` unconditionally) covers every "add a report" moment with one call. `report_requested_at`/`report_requested_by` are plain member columns needing no RPC. Geofence detection is entirely client-side in `StaffClockView.jsx` (`watchPosition`, 2-minute debounce before prompting, reusing `haversineDistanceM()` from `src/lib/geo.js`). Verified: lint/build clean, every new UI state (both stop-flow steps, the geofence variant, the report-requested banner, the member-side notes/ask-for-report row) checked visually against the real built CSS at 375px. **Not yet done**: no live Supabase in this sandbox, so none of break/clock-out/report/ask-for-report/geofence-prompt has been clicked through against real data or a real moving device.
- [x] Add an "Add staff" function on the member side — reported directly as a real gap: there was no way to create a new property-manager account from the app at all. `staff.id` references `auth.users`, so this needed a genuinely new capability, not just a new form — `create-staff-account`, the second Edge Function invoked directly from the browser (alongside `manual-notify`), using the service-role client to call `auth.admin.createUser()` then insert the `staff` row, rolling back the Auth user if the `staff` insert fails. Deployed `--no-verify-jwt` for the same CORS-preflight reason `manual-notify` is, which makes the caller-is-a-member check inside it load-bearing, not optional — without it this endpoint would let anyone create arbitrary staff accounts. `StaffProfileForm.jsx` now covers create (username/password, the latter with a "Generate" button reusing `generateStrongPassword()` from `vault.js`) alongside its existing edit mode, same `x ? edit : create` shape already used elsewhere in this feature. Verified: lint/build clean, form fields checked visually against the real built CSS. **Not yet done**: `create-staff-account` hasn't been deployed live or clicked through — needs `supabase functions deploy create-staff-account --no-verify-jwt`.

### Decision

- Property-manager payroll cadence is **configurable, not fixed at build time** — Aaron and Ada asked for it to be interchangeable and manageable by either of them, not hardcoded to one of weekly/biweekly/twice-monthly/monthly. Concrete design for whoever builds the payroll-period-filtering item below: a new `staff.payroll_cadence` column (enum: `weekly | biweekly | twice_monthly | monthly`, default `biweekly` to match the household's actual current arrangement per `EndOfDayReportForm.jsx`'s own `biweekly` report period) — lives on `staff`, not `members` or a new table, since it's a property of *this specific staff member's* pay arrangement (the same reasoning `hourly_rate`/`emergency_rate` already live there), and a household with more than one staff member later could plausibly want different cadences per person. Edited via `StaffProfileForm.jsx`, alongside the existing rate fields it already manages — that form is already "Ada/Aaron's own view of managing the property manager," reachable from `StaffLogsView.jsx`'s roster Edit action, so no new settings surface is needed. The period-boundary math itself should reuse `startOfPeriod()`'s existing `BIWEEKLY_ANCHOR`-based cycle logic (`src/lib/tasks.js`) for the `biweekly` case rather than reinventing it — that function is currently module-private, so it'll need exporting (or a small duplicated copy, matching this app's own established preference for that over premature sharing, e.g. `buildWeeks()`).

### Next action

Run the incremental `staff_payroll_cadence` schema block against the live Supabase project and verify the new cadence field and payroll-period stepper end to end (as a real member session, real data — same discipline the earlier live-verification passes on this plan used), then close out this plan: update `CLAUDE.md`, remove it, commit, and push.

## Rentals — multiple tenants per booking

**Status:** Implemented and locally verified; awaiting live migration/data verification.

### Goal and decisions

- One booking continues to reserve one unit/date range and generate one rental charge cycle.
- A booking may contain multiple individual tenant names; it is not represented as overlapping bookings for the same unit.
- `rental_bookings.guest_names` is the structured tenant list. The existing `guest_name` remains a joined compatibility/display value so older clients and existing logic degrade safely.
- Existing bookings migrate to a one-item tenant list automatically.
- Long tenant labels must never participate in calendar track sizing; the seven day columns use `minmax(0, 1fr)` and every day cell has `min-width: 0`.

### Status

- [x] Add repeatable Tenant fields with Add tenant and Remove controls to Add/Edit booking.
- [x] Render structured tenant labels throughout Calendar, Overview, Details, availability explanations, and confirmations.
- [x] Bound calendar tracks so long names truncate instead of inflating the month grid.
- [x] Add the backward-compatible `guest_names` migration and pre-migration read/write fallbacks.
- [x] Verify the long-name calendar and repeatable Tenant controls at desktop and 390px mobile widths.
- [ ] Run the incremental SQL block against live Supabase.
- [ ] Verify create/edit of a two-tenant booking on desktop and mobile against live data.
- [ ] Remove this completed plan after live verification and keep the final behavior in `CLAUDE.md`.


## Rental contacts, call logging, lease notes, unit files, reply templates and export

**October 6, 2026 — Aaron’s scope update:** Call/text logging is deferred at Aaron’s request because it may not be useful right now. Do not implement the logging flow, Call/Text task sources, or related task links for this feature unless he explicitly resumes it. The logging portions of the proposal, phases, export datasets, and questions below are historical proposals, not current scope. Contacts, lease notes, unit files, reply templates, and export remain proposed; no next feature has been selected or approved.

**Status:** Property contacts approved and prepared locally; manual migration and live verification pending. Call/text logging deferred. Other improvements below remain proposed. No production SQL, commits, pushes or deployments performed for contacts.

### Approved first delivery — property contacts (October 6, 2026)

Aaron approved the property contacts preview in chat. Scope: tenants/vendors/other, shared directory, name/company/phone search, per-unit panels for short/midterm and long-term, multiple unit links with roles, copy number, notes, archive/restore retaining links. All Rentals-enabled members can view/edit; staff and Rentals-disabled members cannot. No call/text task sources, task links, or logging flow. Lease notes, templates, unit files and exports remain separate unapproved proposals.

- [x] Prepare frontend, contact library, atomic save RPC and manual migration (`supabase/add-rental-contacts.sql`, mirrored in `schema.sql`).
- [x] Local PostgreSQL checks: migration rerun, multi-unit create/edit, rollback on invalid link, archive preservation, Rentals-disabled/non-member read and write denial, publication entries.
- [x] Lint/build and mounted-component checks at 390px/1280px: number search, edit, unit selection, cancel/close, no page errors or horizontal overflow. Follow-up simulated saves verified the RPC payload, permission-error draft preservation, archive/restore visibility, and cancel discarding edits.
- [ ] Aaron runs the migration manually and checks live access with Rentals-enabled, Rentals-disabled and staff accounts.
- [ ] Real signed-in create/edit/link/archive/restore/copy and live Realtime verification.
- [x] Commit authorized by Aaron; feature and documentation saved in Git.
- [ ] Push/deploy remain unauthorized and not performed.

The original proposal below is retained as historical context. Its combined Phase 1 and call-logging dependencies do not describe the approved first delivery.

### Product goal

Aaron is becoming Ada's main point of contact for rental tenants and vendors; calls and texts arrive through a shared Google Voice number. Tandem should be his phone-first command center for that: log a call in a few taps, know who someone is and which unit they relate to, find a unit's reference info, and send a consistent reply.

### What already exists and is reused (not duplicated)

- **Access model:** every `rental_*` table is `is_member() and has_permission('rentals')`; staff accounts fail `is_member()`, so they get nothing. All new tables copy this exactly.
- **Tasks:** a call or text becomes a normal task (assignees, due date, priority, checklist, reports, Inbox all work unchanged). `task_source` is a Postgres enum (`teams`/`email`/`none`) today; `tasks.rental_turnover_booking_id` is the existing precedent for a nullable link from a task to rental data.
- **Rentals:** `rental_properties` (units), `rental_bookings` (tenant names in `guest_names`, no phone/email), `rental_properties.work_site_id` (unit → physical location).
- **Vault:** AES-GCM entries, per-entry sharing, folders stored *inside* the encrypted payload. Door/lockbox codes and passwords stay here.
- **UI parts:** `NewTaskForm` hub (tabbed modal), `TaskRow`, `ConfirmProvider`, `HelpHint`, `LoadingText`, the Phase 4 accessibility rules in `CLAUDE.md`.

### Proposal

1. **Contacts** (tenants, vendors, other). One table, `kind` distinguishes them. Vendor `trade` is free text with suggestions (plumber, electrician, cleaner, HOA, utility, insurance…). Phone, optional second phone, email, notes. Archive instead of delete (former tenants and old vendors stay findable). Linked to units, and tenants to a booking. A contact's page also lists their tasks (derived from `tasks.contact_id`, no extra table).
2. **Log a call or text** = a task. Add `call` and `text` to `task_source`, plus nullable `tasks.contact_id` and `tasks.rental_property_id`. A "Log call/text" flow: Call/Text toggle → find the contact by name or last digits of the number (or create one inline with just name + number) → unit (prefilled from the contact) → one line on what they need → follow-up on/off → priority → save. Assignee defaults to you.
3. **Unit file.** One row per unit with six plain-text sections (utilities, HOA, insurance, access instructions, appliances, maintenance). Providers and phone numbers are *linked contacts* with a role label, not retyped. Codes and account/policy numbers live in the Vault; the unit file points to them.
4. **Reply templates.** Saved messages with `{placeholders}` (`{name}`, `{unit}`, `{address}`, `{my_name}`, `{date}`, `{time}`). Pick a template, pick the contact/unit, unknown placeholders become small fill-in fields, live preview, **Copy** (to paste into Google Voice).
5. **Long-term lease notes** (added at Aaron's request). Today the Long Term lease card shows no notes at all; the only notes field is one text blob on a booking, visible only inside the booking detail window. Proposed: a **dated running log per lease** (who wrote it, when), shown on the lease card as the latest note plus "Add note" and a full notes sheet. Meant for context that builds up over a tenancy ("Oct 3 — asked about parking, replied by text"). A logged call can add a note to its unit's lease in one tap. The booking's existing single `notes` field stays as is.
6. **Major CSV export** (added at Aaron's request). One Export screen inside Rentals with a checklist of datasets (units, bookings and leases, long-term notes, contacts and their links, call/text log, unit files, reply templates, optionally expenses), filters (company, short/long term, include archived, date range), and a download. Each dataset is its own plain CSV; each phase of this plan registers its dataset into the exporter, so it grows with the feature instead of being a separate last-minute job.

### Data model (outline — final SQL prepared only after approval)

| Table / change | Key columns | Notes |
| --- | --- | --- |
| `rental_contacts` | `kind` (tenant/vendor/other), `name`, `organization`, `trade`, `phone`, `phone_alt`, generated `phone_digits` for search, `email`, `notes`, `active`, `created_by`, timestamps | No SSN, bank, ID or card fields. |
| `rental_contact_links` | `contact_id`, exactly one of `property_id` / `booking_id`, `role` | Cascade on delete; a check enforces exactly one target. |
| `tasks` (alter) | `contact_id`, `rental_property_id` (both nullable, `on delete set null`) | Ids only; names resolve through contact/unit RLS. |
| `task_source` (alter) | add `call`, `text` | Enum additions must be run on their own, outside a transaction block. |
| `rental_notes` | `property_id`, nullable `booking_id` (`on delete set null`, so a note outlives a replaced lease), `body`, `created_by`, `created_at`, `updated_at` | Dated log for long-term context; same Rentals RLS. |
| `rental_message_templates` | `title`, `audience` (tenant/vendor/any), `body`, `sort_order`, `active`, `created_by` | Shared by everyone with Rentals. |
| `rental_unit_files` | `property_id` (pk), `utilities`, `hoa`, `insurance`, `access`, `appliances`, `maintenance`, `updated_by`, `updated_at` | Plain text only. |
| Realtime | add the four new tables to `supabase_realtime` | By hand; known easy-to-miss step. |

### Access rules

- All new tables: select/insert/update/delete require `is_member() and has_permission('rentals')`. A member with Rentals off, and every staff account, sees nothing.
- Export: the button is hidden without Rentals permission, and every dataset is fetched through the same RLS-protected queries, so a member without the permission cannot get the data by any route. Free-text fields are escaped against spreadsheet formula injection (same `csvEscape` approach as the Vault and payroll exports) and a UTF-8 marker is added so Excel reads names with accents.
- A task linked to a contact is visible to whoever can already see the task (assignee or `task_access`). They see the task's own title/notes; the **contact's name, phone and unit only resolve for people with Rentals permission**. Tasks carry ids, not contact data.
- No sensitive personal data: no fields for it, plus a guard on free-text fields that blocks SSN-shaped and card-length digit runs and warns on "code / pin / password" with a pointer to the Vault.
- Phone numbers and emails are ordinary contact data stored in plaintext under RLS, like tenant names and bookings are today.

### Phases

- [ ] **0. Decisions.** Aaron approves the plan and answers the open questions below.
- [ ] **1. Contacts + call/text logging** (the daily mid-call loop). Tables, enum values, task columns, Contacts section inside Rentals, contact page, search by name/number, "Log call/text" flow, Call/Text label and contact/unit chips on `TaskRow`.
- [ ] **2. Long-term lease notes + the export framework.** Notes table, notes row on the lease card, notes sheet; then the Export screen with the datasets that exist by then (units, bookings/leases, notes, contacts, call log). Small phases that follow from Phase 1 and give the first real use of the data.
- [ ] **3. Reply templates.** Table, manager screen, fill-in + preview + Copy, starter set from Aaron's own top messages; adds its dataset to the export.
- [ ] **4. Unit file.** Table, unit file screen from a unit, linked contacts with roles, Vault pointer; adds its dataset to the export. 4b (optional, later): a dated maintenance log with vendor and cost.
- [ ] **5. Hardening and docs.** Duplicate-number warning, optional contact import, free-text guard, guide/FAQ, `CLAUDE.md`, impersonation tests for the access rules, a phone click-through, and a check that every export dataset matches what is on screen.

Order rationale: contacts are the dependency for logging, notes, templates and unit files; logging is the highest-value, most-used piece; notes and export are small and build directly on it; templates are quick; the unit file is the largest and least urgent. If notes or export matter more to you than call logging, say so and Phase 2 moves first (notes have no dependency on contacts).

### Where I'd differ from the original list

1. **Locations link through units, not directly.** `work_sites` is readable only with the *Staff* permission, so a Rentals-only member could not read a location a contact was linked to. A contact linked to a unit shows up under that unit's location anyway (`rental_properties.work_site_id`).
2. **Logging a call that needs no follow-up** shouldn't clutter the task list. Proposed: a "needs follow-up" switch; off logs it as already done. Catch: done tasks count in EOD report tallies.
3. **No Google Voice integration.** It has no public API; calls and texts are logged by hand and replies are copied out. A message inbox would be a separate, much larger product.
4. **Tap-to-call/text opens the phone's own dialer, not Google Voice**, so a callback could go out from the wrong number. Copy-number is the safe default.
5. **Vault mid-call friction.** The vault key lives only in memory and is re-typed every time it is reopened. Unit files can point at entries, and entries can get an optional "Unit" field (inside the encrypted payload, so nothing leaks), but needing a code mid-call will still mean typing the master password.
6. **Unit file as notes + linked contacts + Vault pointers**, instead of retyping HOA/utility/insurance contact details as free text.
7. **Contacts live inside Rentals**, not a new navigation tab: the mobile bottom bar is already full, and Rentals is already hidden from members without the permission. Cork Board is not reused (its pins are personal and private by design).
8. **Notes as a dated log, not a bigger text box.** A single field gets overwritten and loses who said what and when; a log also lets a logged call append to the lease in one tap. The cost is one more table.
9. **The export is not the Vault export.** It contains tenants' and vendors' phone numbers and emails in plain text, so it gets a clear confirm dialog before downloading, but not the typed-word gate the Vault uses for passwords. It never includes Vault contents, and has no SSN/bank fields because none exist.
10. **Opening a call task is also visible to Ada.** Anyone assigned or with task access sees what a call was about. That is a feature for oversight, but worth knowing.

### Open questions (need Aaron's answers before building)

1. **Who edits?** Everyone with Rentals can view and edit everything (like Rentals today), or only the creator edits? Today that group is Ada and you; is RC Lina in it?
2. **Call logging default.** A call that needs no follow-up: log it as already done, or always create an open task? (Done tasks count in EOD tallies.)
3. **Entry point.** The + button means "Add booking" on the Rentals tab and the task hub on Today. Where do you want "Log call/text" reachable mid-call, from any tab: a header button, a + menu item, or both?
4. **Tap-to-call/text.** Copy-number only, phone dialer links as well, or also a Google Voice link (needs testing)?
5. **Vault.** Should the vault be allowed to stay unlocked for a few minutes within the app session so codes are quick to reach mid-call? Default is no change.
6. **Locations.** Link through units only (recommended)?
7. **Templates.** Your 5-10 most common tenant and vendor messages, and anything you must not say (notice-of-entry and similar wording varies by jurisdiction and is not legal advice).
8. **Import.** Do you want to import existing contacts from Google (CSV) now or later?
9. **Former tenants.** Keep them as archived contacts with their lease history?
10. **Maintenance log.** In v1 of the unit file, or later?
11. **Phone numbers.** US numbers only?
12. **Lease notes.** A dated log (recommended) or one bigger note per lease? Who can edit or delete a note: only its author, or anyone with Rentals? Short/midterm units too, or long term only for now?
13. **Notes: where they show.** On the lease card and the booking detail; also on a tenant contact's page if linked?
14. **Export: which data?** Everything in the list above, or a subset? Include expenses and savings goals (the financial side)? Archived contacts and past leases by default or opt-in?
15. **Export: how it downloads.** One CSV per dataset (simple, works on phones), or also a single .zip of everything (needs a small library; zip files are awkward on a phone)? One combined file is not practical because the datasets have different columns.
16. **Export: where it lives.** A button beside "+ Add unit" on both terms, inside the Contacts area, or both?
17. **Export: privacy.** Is a plain confirm dialog enough, or do you want the typed-word gate like the Vault?

### Hand-run SQL

Prepared **after approval**, never run by the assistant (now also covering `rental_notes`): one incremental file (`supabase/add-rental-contacts.sql`, mirrored into `schema.sql`) with the tables, policies and indexes, the `task_source` enum additions as separate statements to run on their own, the Realtime publication line, and read-only verification queries. Apply, then verify with a Rentals-off member session and a staff session before any frontend ships.

### Verification plan

Impersonation checks that a member without Rentals permission and a staff account get zero rows from every new table; a real phone click-through of the call-logging flow; the Phase 4 accessibility checks (contrast, 40px targets, plain-language errors) on every new screen; `CLAUDE.md`, the in-app guide and this plan updated in the same change as each phase.

### Next action

Aaron answers the open questions and approves (or amends) the phases. Then Phase 1 starts with the SQL for review.

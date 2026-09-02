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
- [ ] Add payroll-period filtering, summary metrics, and filter-aware CSV export.
- [ ] Update `CLAUDE.md`, remove this completed plan, commit, and push the final phase.

### Decision

- Property-manager payroll cadence is **configurable, not fixed at build time** — Aaron and Ada asked for it to be interchangeable and manageable by either of them, not hardcoded to one of weekly/biweekly/twice-monthly/monthly. Concrete design for whoever builds the payroll-period-filtering item below: a new `staff.payroll_cadence` column (enum: `weekly | biweekly | twice_monthly | monthly`, default `biweekly` to match the household's actual current arrangement per `EndOfDayReportForm.jsx`'s own `biweekly` report period) — lives on `staff`, not `members` or a new table, since it's a property of *this specific staff member's* pay arrangement (the same reasoning `hourly_rate`/`emergency_rate` already live there), and a household with more than one staff member later could plausibly want different cadences per person. Edited via `StaffProfileForm.jsx`, alongside the existing rate fields it already manages — that form is already "Ada/Aaron's own view of managing the property manager," reachable from `StaffLogsView.jsx`'s roster Edit action, so no new settings surface is needed. The period-boundary math itself should reuse `startOfPeriod()`'s existing `BIWEEKLY_ANCHOR`-based cycle logic (`src/lib/tasks.js`) for the `biweekly` case rather than reinventing it — that function is currently module-private, so it'll need exporting (or a small duplicated copy, matching this app's own established preference for that over premature sharing, e.g. `buildWeeks()`).

### Next action

Add payroll-period filtering, summary metrics, and filter-aware CSV export to the Hours overview, now that the cadence decision above is resolved — starting with `staff.payroll_cadence` (schema + `StaffProfileForm.jsx` field) so the period selector has a real default to read instead of guessing.

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

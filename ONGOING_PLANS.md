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
- [x] Add on-site capture with member approval fallback — schema: five nullable `pending_*` columns on `work_sites` (not a child table — a site has at most one live geofence point regardless of capture attempts, so a resubmit before approval just overwrites), a new `staff_submit_location_capture()` security-definer RPC (staff has zero direct write RLS on `work_sites`, same reasoning `staff_clock_out()` already established), and a third SELECT policy so staff can see (but not write) a needs-setup/pending site. Approve/reject are plain member updates, not RPCs, since members already hold unrestricted `work_sites` UPDATE RLS. `workSiteStatus()` (`src/lib/staff.js`) is now the single 4-state classifier (`ready`/`pendingApproval`/`needsSetup`/`inactive`), replacing logic that used to be duplicated inline in `StaffLocationsManager.jsx` and `StaffLogsView.jsx`. Locally verified (mocked-Supabase harness) — capture, recapture, approve, and discard all confirmed end to end; not yet run against live Supabase.
- [ ] Add payroll-period filtering, summary metrics, and filter-aware CSV export.
- [ ] Verify member desktop/mobile and staff mobile flows against the live Supabase project — including the new on-site capture/approval flow above, which still needs its own incremental SQL block run live (see schema.sql's "On-site location capture with member approval" section).
- [ ] Run security checks for RLS, geofence stamping, clock-out ownership, and deactivation with an open shift — for the new capture flow specifically: confirm staff genuinely cannot write `latitude`/`longitude`/`active` directly, an archived site with real coordinates never matches the new staff SELECT policy, and resubmitting a capture on an already-approved site is rejected by the RPC.
- [ ] Update `CLAUDE.md`, remove this completed plan, commit, and push the final phase.

### Unresolved decision

- Property-manager payroll cadence: weekly, every two weeks, twice monthly, or monthly. This determines the default period selector and CSV boundaries.

### Next action

Add payroll-period filtering, summary metrics, and filter-aware CSV export to the Hours overview — the property-manager payroll cadence (weekly/biweekly/twice monthly/monthly) is still an open decision above and blocks the default period selector, so that needs resolving first.

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

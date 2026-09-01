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
- Location setup first attempts to derive a map point from the property's saved address.
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
- [ ] Add address lookup and hide technical coordinates by default.
- [ ] Add on-site capture with member approval fallback.
- [ ] Add payroll-period filtering, summary metrics, and filter-aware CSV export.
- [ ] Verify member desktop/mobile and staff mobile flows against the live Supabase project.
- [ ] Run security checks for RLS, geofence stamping, clock-out ownership, and deactivation with an open shift.
- [ ] Update `CLAUDE.md`, remove this completed plan, commit, and push the final phase.

### Unresolved decision

- Property-manager payroll cadence: weekly, every two weeks, twice monthly, or monthly. This determines the default period selector and CSV boundaries.

### Next action

Choose and integrate an address-lookup provider so a saved rental address can configure its map point without Aaron supplying coordinates.

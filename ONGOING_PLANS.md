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

- Existing active properties from both Awa and Azu Rentalz are the starting point for clock-in locations.
- `work_sites` remains the behind-the-scenes geofence configuration because rental properties do not contain coordinates and staff may also work at non-rental locations.
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
   - Automatically show active Awa and Azu properties.
   - Show a clear state for each: Needs setup, Awaiting approval, Ready, or Inactive.
   - “Configure” uses the existing rental name/address.
   - “Add other location” handles homes, offices, storage, or other non-rental sites.

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
- [ ] Replace the raw empty state with the Hours overview/onboarding layout.
- [ ] Load and present properties from both Awa and Azu.
- [ ] Replace “Add site” with “Manage clock-in locations” and property-first configuration.
- [ ] Add address lookup and hide technical coordinates by default.
- [ ] Add on-site capture with member approval fallback.
- [ ] Add payroll-period filtering, summary metrics, and filter-aware CSV export.
- [ ] Verify member desktop/mobile and staff mobile flows against the live Supabase project.
- [ ] Run security checks for RLS, geofence stamping, clock-out ownership, and deactivation with an open shift.
- [ ] Update `CLAUDE.md`, remove this completed plan, commit, and push the final phase.

### Unresolved decision

- Property-manager payroll cadence: weekly, every two weeks, twice monthly, or monthly. This determines the default period selector and CSV boundaries.

### Next action

Complete and verify the reliability/mobile baseline, then build the property-first empty/onboarding state before adding an address-lookup provider.

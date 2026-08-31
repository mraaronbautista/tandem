// Pure chrome for the shared .rental-add-booking/.rental-add-booking-primary
// pattern (App.css) — reused across RentalsView.jsx (Edit unit, + Add
// unit, + Add booking), RentalCalendar.jsx (+ Add booking, mobile), and
// RentalFinancials.jsx (+ Add overhead).
//
// Deliberately NOT SubmissionButton — that component's secondary variant
// leaves text color unset (native browser default) rather than the
// explicit var(--text-h) this class actually uses, and both of its
// variants add a hover/press animation (translate/scale/shadow) that
// .rental-add-booking has never had. Reusing it would have been a visual
// and behavioral change, not a mechanical swap, so this gets its own
// small primitive with the same exact-match discipline instead.
//
// variant="primary" matches .rental-add-booking-primary — the one action
// actually used every time a Rentals view is opened, filled-accent like
// SubmissionButton's own primary look elsewhere in the app, just without
// that component's animation. variant="secondary" (default) matches the
// plain .rental-add-booking look every other action here uses.
const VARIANT = {
  secondary: 'border-border bg-pill-bg text-text-h',
  primary: 'border-accent bg-accent font-semibold text-white',
}

export default function RentalButton({ variant = 'secondary', className = '', ...props }) {
  return (
    <button
      type="button"
      className={`cursor-pointer whitespace-nowrap rounded-[8px] border px-3.5 py-2 text-sm ${VARIANT[variant]} ${className}`}
      {...props}
    />
  )
}

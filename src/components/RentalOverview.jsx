import { Handshake } from 'lucide-react'
import { formatDateStr, unitOccupancyStatus } from '../lib/rentals'

// "All units at a glance" — a plain status line per unit rather than a
// multi-unit calendar grid, which an earlier Gantt-style attempt already
// tried and scrapped for the per-unit calendar (see RentalCalendar.jsx):
// it needed a wider layout that fought the mobile CSS reset. This reuses
// `bookings`, already fetched by RentalsView for the current month, plus
// a separate "still relevant" fetch so a unit occupied past this month's
// end still shows its real through-date instead of cutting off at the
// 30th/31st.
//
// Two contexts share this component: mobile's Overview tab (its own
// vertical list) and the desktop dashboard's RentalCalendar toolbar,
// rendered inline with "+ Add booking" in place of the (hidden)
// unit-tabs row — a CSS override on .rental-overview-list scoped by an
// ancestor class handles that layout difference, not a prop here.
// `selectedUnitId`/`onSelectUnit`, when given, make each row clickable
// and highlight the active one — in the desktop toolbar this is the only
// way to switch units now that the plain unit-tabs are hidden there; on
// mobile it's a handy bonus (priming which unit the Calendar tab opens
// to next).
export default function RentalOverview({
  properties,
  bookings,
  selectedUnitId,
  onSelectUnit,
  onEditUnit,
  onToggleNegotiating,
}) {
  if (properties.length === 0) {
    return <p className="task-notes-empty">No units yet.</p>
  }

  return (
    <ul className="rental-overview-list">
      {properties.map((p) => {
        const status = unitOccupancyStatus(bookings, p.id)
        const itemClasses = ['rental-overview-item']
        if (p.id === selectedUnitId) itemClasses.push('rental-overview-item-selected')

        // Two lines, not one long run of inline spans — name+price up
        // top, status below. Reads cleanly as a compact card at any
        // width instead of demanding one unbroken line long enough to
        // fit "Healthcare Haven $2,100/mo Occupied through Aug 30 —
        // Abdul" (which is what forced every card onto its own row in
        // the toolbar's grid, single-column, no matter how much
        // horizontal room was actually available).
        const content = (
          <>
            <span className="rental-overview-top">
              <span className="rental-unit-dot" style={{ background: p.color }} />
              <span className="rental-overview-unit-name font-semibold text-text-h" title={p.unit_name}>
                {p.unit_name}
              </span>
              <span className="rental-overview-rate text-xs opacity-60">
                ${Number(p.monthly_rent).toLocaleString()}/mo
              </span>
            </span>
            {status.occupied ? (
              <span className="rental-overview-status-line text-[13px] text-text-h opacity-100" title={`Occupied through ${formatDateStr(status.through)} — ${status.guest}`}>
                Occupied through {formatDateStr(status.through)} — {status.guest}
              </span>
            ) : status.next ? (
              <span className="rental-overview-status-line text-[13px] opacity-75" title={`Vacant — next ${status.next.pending ? 'request' : 'guest'} ${formatDateStr(status.next.checkIn)} — ${status.next.guest}`}>
                Vacant — next {status.next.pending ? 'request' : 'guest'} {formatDateStr(status.next.checkIn)} —{' '}
                {status.next.guest}
              </span>
            ) : (
              <span className="rental-overview-status-line text-[13px] opacity-50">Vacant</span>
            )}
          </>
        )

        // Absolutely positioned within the card (.rental-overview-item
        // is position: relative) rather than sitting in normal flow —
        // pinned to the card's lower-right corner, clearly separated
        // from the monthly price on the top line. It stays out of normal
        // flow so toggling it never changes the card's own height.
        // Icon-only at rest, grows to include "In talks" once on — same
        // element serves as both the control and the display, rather
        // than a separate read-only badge plus a separate toggle.
        // border/background/color/padding computed together, exclusively,
        // per on/off state — never split into an unconditional base class
        // plus a conditional override, since both states set the same
        // longhands (the mutual-exclusivity discipline NavItem.jsx/
        // PeriodTab.jsx already established for this exact class of bug).
        // duration-[120ms]: the original splits transform at --dur-fast
        // (120ms) from border-color/background/opacity/padding at
        // --dur-base (180ms) — collapsed to one uniform 120ms transition,
        // same documented compromise ThemeToggle.jsx/WorkingStatusToggle.jsx
        // already use for this exact shape of problem (Tailwind can't
        // combine two transition-* utilities with different durations on
        // one element).
        const negotiatingToggleClasses = `absolute right-3 bottom-2.5 flex h-6 min-w-6 cursor-pointer items-center justify-center gap-1 rounded-full border py-0 text-[11px] font-semibold leading-none whitespace-nowrap transition-all duration-[120ms] ease-tactile active:scale-90 ${
          p.in_negotiation
            ? 'border-[#e0a83e] bg-[#e0a83e] px-2.5 text-white opacity-100'
            : 'border-border bg-card-bg px-[5px] text-text-h opacity-45'
        }`

        const negotiatingToggle = onToggleNegotiating && (
          <button
            type="button"
            className={negotiatingToggleClasses}
            onClick={(e) => {
              // Stops this from also bubbling up into the card's own
              // onClick/onKeyDown (select-unit) — needed now that the
              // toggle lives inside the card rather than beside it.
              e.stopPropagation()
              onToggleNegotiating(p)
            }}
            title={p.in_negotiation ? 'In talks — click to clear' : 'Mark as in talks'}
            aria-pressed={!!p.in_negotiation}
            aria-label={`${p.unit_name}: ${p.in_negotiation ? 'in talks' : 'not in talks'}`}
          >
            {p.in_negotiation ? (
              <>
                <Handshake size={13} className="inline align-[-2px]" /> In talks
              </>
            ) : (
              <Handshake size={13} className="inline align-[-2px]" />
            )}
          </button>
        )

        return (
          // onEditUnit is only ever passed from mobile's standalone
          // Overview tab (see RentalsView.jsx) — the desktop toolbar
          // reuse of this same list stays exactly as compact as before,
          // no extra button crowding that row.
          <li key={p.id} className={onEditUnit ? 'flex items-stretch gap-1.5' : undefined}>
            {onSelectUnit ? (
              // A <div role="button"> here, not a real <button> — the
              // negotiating toggle now needs to live *inside* this card
              // (see negotiatingToggle above), and a <button> can't
              // validly contain another interactive control. tabIndex +
              // onKeyDown replace what a real button would otherwise
              // give for free, so keyboard activation (Enter/Space)
              // still works the same as before.
              <div
                role="button"
                tabIndex={0}
                className={itemClasses.join(' ')}
                onClick={() => onSelectUnit(p.id)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  onSelectUnit(p.id)
                }}
              >
                {content}
                {negotiatingToggle}
              </div>
            ) : (
              <div className={itemClasses.join(' ')}>
                {content}
                {negotiatingToggle}
              </div>
            )}
            {onEditUnit && (
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-accent"
                onClick={() => onEditUnit(p)}
              >
                Edit
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

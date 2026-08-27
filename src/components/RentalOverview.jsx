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
              <span className="rental-overview-name">{p.unit_name}</span>
              <span className="rental-overview-price">${Number(p.monthly_rent).toLocaleString()}/mo</span>
            </span>
            {status.occupied ? (
              <span className="rental-overview-status rental-overview-status-occupied">
                Occupied through {formatDateStr(status.through)} — {status.guest}
              </span>
            ) : status.next ? (
              <span className="rental-overview-status">
                Vacant — next {status.next.pending ? 'request' : 'guest'} {formatDateStr(status.next.checkIn)} —{' '}
                {status.next.guest}
              </span>
            ) : (
              <span className="rental-overview-status rental-overview-status-vacant">Vacant</span>
            )}
          </>
        )

        // Absolutely positioned within the card (.rental-overview-item
        // is position: relative) rather than sitting in normal flow —
        // pinned to the card's right edge, vertically centered against
        // the *whole* card regardless of how many lines its status text
        // wraps to, so toggling it never changes the card's own height
        // the way inserting a badge as another stacked line would.
        // Icon-only at rest, grows to include "In talks" once on — same
        // element serves as both the control and the display, rather
        // than a separate read-only badge plus a separate toggle.
        const negotiatingToggle = onToggleNegotiating && (
          <button
            type="button"
            className={`rental-negotiating-toggle${p.in_negotiation ? ' rental-negotiating-toggle-on' : ''}`}
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
            {p.in_negotiation ? '🤝 In talks' : '🤝'}
          </button>
        )

        return (
          // onEditUnit is only ever passed from mobile's standalone
          // Overview tab (see RentalsView.jsx) — the desktop toolbar
          // reuse of this same list stays exactly as compact as before,
          // no extra button crowding that row.
          <li key={p.id} className={onEditUnit ? 'rental-overview-row' : undefined}>
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
              <button type="button" className="rental-savings-edit" onClick={() => onEditUnit(p)}>
                Edit
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

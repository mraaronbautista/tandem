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
export default function RentalOverview({ properties, bookings, selectedUnitId, onSelectUnit, onEditUnit }) {
  if (properties.length === 0) {
    return <p className="task-notes-empty">No units yet.</p>
  }

  return (
    <ul className="rental-overview-list">
      {properties.map((p) => {
        const status = unitOccupancyStatus(bookings, p.id)
        const itemClasses = ['rental-overview-item']
        if (p.id === selectedUnitId) itemClasses.push('rental-overview-item-selected')

        const content = (
          <>
            <span className="rental-unit-dot" style={{ background: p.color }} />
            <span className="rental-overview-name">{p.unit_name}</span>
            <span className="rental-overview-price">${Number(p.monthly_rent).toLocaleString()}/mo</span>
            {status.occupied ? (
              <span className="rental-overview-status rental-overview-status-occupied">
                Occupied through {formatDateStr(status.through)} — {status.guest}
              </span>
            ) : status.next ? (
              <span className="rental-overview-status">
                Vacant — next {status.next.pending ? 'request' : 'guest'} {formatDateStr(status.next.checkIn)}
              </span>
            ) : (
              <span className="rental-overview-status rental-overview-status-vacant">Vacant</span>
            )}
          </>
        )

        return (
          // onEditUnit is only ever passed from mobile's standalone
          // Overview tab (see RentalsView.jsx) — the desktop toolbar
          // reuse of this same list stays exactly as compact as before,
          // no extra button crowding that row.
          <li key={p.id} className={onEditUnit ? 'rental-overview-row' : undefined}>
            {onSelectUnit ? (
              <button type="button" className={itemClasses.join(' ')} onClick={() => onSelectUnit(p.id)}>
                {content}
              </button>
            ) : (
              <div className={itemClasses.join(' ')}>{content}</div>
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

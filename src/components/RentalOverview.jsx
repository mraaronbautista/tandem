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
// Two contexts share this component, both default card-row styling:
// mobile's Overview tab, and the desktop dashboard's Overview section
// below the calendar (laid out as a grid there via a CSS override on
// .rental-overview-list, not a prop here — see .rentals-overview-section
// in App.css). `selectedUnitId`/`onSelectUnit`, when given, make each
// row clickable and highlight the active one — primary navigation in the
// desktop dashboard, a handy bonus on mobile too (priming which unit the
// Calendar tab opens to next).
export default function RentalOverview({ properties, bookings, selectedUnitId, onSelectUnit }) {
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
          <li key={p.id}>
            {onSelectUnit ? (
              <button type="button" className={itemClasses.join(' ')} onClick={() => onSelectUnit(p.id)}>
                {content}
              </button>
            ) : (
              <div className={itemClasses.join(' ')}>{content}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

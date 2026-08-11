import { forwardRef, useImperativeHandle, useState } from 'react'
import RentalBookingForm from './RentalBookingForm'
import RentalBookingDetail from './RentalBookingDetail'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function pad(n) {
  return String(n).padStart(2, '0')
}

function toDateStr(year, month, day) {
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

function formatDateStr(dateStr) {
  // Parsed as local, not UTC — a bare 'YYYY-MM-DD' parsed via `new Date()`
  // would otherwise shift a day depending on the browser's timezone offset.
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// Finds the booking (if any) covering this exact day. check_out is the
// last occupied day (inclusive), not a hotel-style departure day.
function bookingForDay(bookings, dateStr) {
  return bookings.find((b) => b.check_in <= dateStr && b.check_out >= dateStr)
}

// Weeks as 7-cell rows (Sun-Sat), padded with `null` before day 1 and
// after the month's last day, so the grid always lines up under the
// weekday header regardless of what day the month starts on.
function buildWeeks(year, month) {
  const numDays = new Date(year, month + 1, 0).getDate()
  const startWeekday = new Date(year, month, 1).getDay()
  const cells = [...Array(startWeekday).fill(null), ...Array.from({ length: numDays }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

// One unit's calendar at a time (picked via a row of unit tabs) rather
// than all units in one wide grid — a single 7-column month grid fits
// comfortably on a phone screen with no horizontal scrolling, unlike a
// multi-unit timeline where every extra unit needs another scrollable
// row of narrow day cells. Tabs instead of a <select> so switching units
// is a single click on desktop rather than open-scroll-choose; see
// RentalOverview.jsx for the separate "all units at once" view this
// doesn't try to replace.
//
// selectedUnitId/onSelectUnit are controlled by the caller (not owned
// here) — RentalsView.jsx's desktop dashboard also drives unit selection
// from a RentalOverview list and a prev/next nav row, so a single source
// of truth has to live above this component. showUnitTabs lets that same
// desktop dashboard suppress this component's own unit-tabs toolbar,
// with unitTabsReplacement rendered in that exact slot instead (the
// RentalOverview list, in the dashboard's case) — the mobile tabbed
// layout keeps the plain unit-tabs (both props default accordingly).
const RentalCalendar = forwardRef(function RentalCalendar(
  {
    properties,
    bookings,
    monthDate,
    createdBy,
    onBookingsChanged,
    selectedUnitId,
    onSelectUnit,
    showUnitTabs = true,
    unitTabsReplacement = null,
    showAddBooking = true,
    showUnitHeader = true,
  },
  ref,
) {
  const [formOpen, setFormOpen] = useState(false)
  const [selectedBooking, setSelectedBooking] = useState(null)
  const [editingBooking, setEditingBooking] = useState(null)

  // Lets the desktop dashboard trigger the add-booking form from a button
  // it renders itself (beside the unit nav), while the form's open/close
  // state still lives here — same "controlled selection, owned state"
  // split the rest of this component already uses for selectedUnitId.
  useImperativeHandle(ref, () => ({ openAddBooking: () => setFormOpen(true) }))

  const unit = properties.find((p) => p.id === selectedUnitId) || properties[0]
  const unitBookings = unit ? bookings.filter((b) => b.property_id === unit.id) : []

  const year = monthDate.getFullYear()
  const month = monthDate.getMonth()
  const numDays = new Date(year, month + 1, 0).getDate()
  const weeks = buildWeeks(year, month)
  const todayStr = toDateStr(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())

  if (properties.length === 0) {
    return <p className="task-notes-empty">No units yet.</p>
  }

  return (
    <div className="rental-calendar">
      <div className="rental-calendar-toolbar">
        {showUnitTabs ? (
          <div className="rental-unit-tabs">
            {properties.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`rental-unit-tab${p.id === selectedUnitId ? ' rental-unit-tab-active' : ''}`}
                onClick={() => onSelectUnit(p.id)}
              >
                <span className="rental-unit-dot" style={{ background: p.color }} />
                {p.unit_name}
              </button>
            ))}
          </div>
        ) : (
          unitTabsReplacement
        )}
        {showAddBooking && (
          <button type="button" className="rental-add-booking" onClick={() => setFormOpen(true)}>
            + Add booking
          </button>
        )}
      </div>

      {showUnitHeader && (
        <div className="rental-unit-header">
          ${Number(unit.monthly_rent).toLocaleString()}/mo
        </div>
      )}

      <div className="rental-month-grid">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="rental-month-weekday">
            {label}
          </div>
        ))}

        {weeks.map((week, weekIndex) =>
          week.map((day, col) => {
            if (day === null) return <div key={`${weekIndex}-${col}`} className="rental-month-day-empty" />

            const dateStr = toDateStr(year, month, day)
            const booking = bookingForDay(unitBookings, dateStr)
            const isToday = dateStr === todayStr
            const classes = ['rental-month-day']
            if (isToday) classes.push('rental-month-day-today')

            if (!booking) {
              return (
                <div key={dateStr} className={classes.join(' ')}>
                  {day}
                </div>
              )
            }

            const isStart = dateStr === booking.check_in || col === 0
            const isEnd = dateStr === booking.check_out || col === 6 || day === numDays
            const isPending = booking.status === 'pending'
            classes.push('rental-month-day-occupied')
            if (isPending) classes.push('rental-month-day-pending')
            if (isStart) classes.push('rental-month-day-start')
            if (isEnd) classes.push('rental-month-day-end')

            // Whether the row-adjacent cell is the *same* booking (not just
            // "also occupied") — used below to visually bridge the grid gap
            // between them so a multi-day stay reads as one continuous bar
            // instead of a checkerboard of separate tiles. Only checked
            // within the row: a booking spanning a week boundary is
            // supposed to break into a separate bar per row, same as
            // isStart/isEnd already treat col 0/6 as edges regardless of
            // the booking's real check-in/check-out.
            const prevBooking = col > 0 && week[col - 1] ? bookingForDay(unitBookings, toDateStr(year, month, week[col - 1])) : null
            const nextBooking = col < 6 && week[col + 1] ? bookingForDay(unitBookings, toDateStr(year, month, week[col + 1])) : null
            const connectsLeft = !isStart && prevBooking?.id === booking.id
            const connectsRight = !isEnd && nextBooking?.id === booking.id

            const fill = isPending
              ? `repeating-linear-gradient(45deg, ${unit.color}, ${unit.color} 4px, transparent 4px, transparent 8px)`
              : unit.color

            return (
              <div
                key={dateStr}
                className={classes.join(' ')}
                style={{
                  // Pending requests get a diagonal stripe instead of a solid
                  // fill — still visible as "held" but distinct from a
                  // confirmed guest at a glance.
                  background: fill,
                  // Paints over the grid's gap on the connecting side(s) with
                  // the same fill — a pure paint effect (box-shadow doesn't
                  // affect layout or text position), so it can't shift the
                  // day number or resize the cell the way padding/margin
                  // tricks would.
                  boxShadow:
                    [connectsLeft && `-4px 0 0 0 ${unit.color}`, connectsRight && `4px 0 0 0 ${unit.color}`]
                      .filter(Boolean)
                      .join(', ') || undefined,
                }}
                title={`${booking.guest_name}${isPending ? ' (pending)' : ''}: ${formatDateStr(booking.check_in)} – ${formatDateStr(booking.check_out)}`}
                onClick={() => setSelectedBooking(booking)}
              >
                {day}
              </div>
            )
          }),
        )}
      </div>

      {(formOpen || editingBooking) && (
        <RentalBookingForm
          properties={properties}
          defaultPropertyId={selectedUnitId}
          booking={editingBooking}
          createdBy={createdBy}
          onClose={() => {
            setFormOpen(false)
            setEditingBooking(null)
          }}
          onSaved={() => {
            setFormOpen(false)
            setEditingBooking(null)
            onBookingsChanged()
          }}
        />
      )}

      {selectedBooking && (
        <RentalBookingDetail
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
          onEdit={(booking) => {
            setSelectedBooking(null)
            setEditingBooking(booking)
          }}
          onDeleted={() => {
            setSelectedBooking(null)
            onBookingsChanged()
          }}
          onConfirmed={() => {
            setSelectedBooking(null)
            onBookingsChanged()
          }}
        />
      )}
    </div>
  )
})

export default RentalCalendar

import { useState } from 'react'
import { deleteRentalBooking } from '../lib/rentals'
import RentalBookingForm from './RentalBookingForm'

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

// One unit's calendar at a time (picked via dropdown) rather than all
// units in one wide grid — a single 7-column month grid fits comfortably
// on a phone screen with no horizontal scrolling, unlike a multi-unit
// timeline where every extra unit needs another scrollable row of narrow
// day cells.
export default function RentalCalendar({ properties, bookings, monthDate, createdBy, onBookingsChanged }) {
  const [selectedUnitId, setSelectedUnitId] = useState(properties[0]?.id || '')
  const [formOpen, setFormOpen] = useState(false)

  const unit = properties.find((p) => p.id === selectedUnitId) || properties[0]
  const unitBookings = unit ? bookings.filter((b) => b.property_id === unit.id) : []

  const year = monthDate.getFullYear()
  const month = monthDate.getMonth()
  const numDays = new Date(year, month + 1, 0).getDate()
  const weeks = buildWeeks(year, month)
  const todayStr = toDateStr(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())

  async function handleDayClick(booking) {
    const range = `${formatDateStr(booking.check_in)} – ${formatDateStr(booking.check_out)}`
    if (!window.confirm(`Delete booking for ${booking.guest_name} (${range})? This can't be undone.`)) return
    await deleteRentalBooking(booking.id)
    onBookingsChanged()
  }

  if (properties.length === 0) {
    return <p className="task-notes-empty">No units yet.</p>
  }

  return (
    <div className="rental-calendar">
      <div className="rental-calendar-toolbar">
        <select
          className="rental-unit-select"
          value={selectedUnitId}
          onChange={(e) => setSelectedUnitId(e.target.value)}
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.unit_name}
            </option>
          ))}
        </select>
        <button type="button" className="rental-add-booking" onClick={() => setFormOpen(true)}>
          + Add booking
        </button>
      </div>

      <div className="rental-unit-header">
        <span className="rental-unit-dot" style={{ background: unit.color }} />
        {unit.unit_name} — ${Number(unit.monthly_rent).toLocaleString()}/mo
      </div>

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
            classes.push('rental-month-day-occupied')
            if (isStart) classes.push('rental-month-day-start')
            if (isEnd) classes.push('rental-month-day-end')

            return (
              <div
                key={dateStr}
                className={classes.join(' ')}
                style={{ background: unit.color }}
                title={`${booking.guest_name}: ${formatDateStr(booking.check_in)} – ${formatDateStr(booking.check_out)}`}
                onClick={() => handleDayClick(booking)}
              >
                {day}
              </div>
            )
          }),
        )}
      </div>

      {formOpen && (
        <RentalBookingForm
          properties={properties}
          createdBy={createdBy}
          onClose={() => setFormOpen(false)}
          onCreated={() => {
            setFormOpen(false)
            onBookingsChanged()
          }}
        />
      )}
    </div>
  )
}

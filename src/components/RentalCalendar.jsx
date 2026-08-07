import { useState } from 'react'
import { deleteRentalBooking } from '../lib/rentals'
import RentalBookingForm from './RentalBookingForm'

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

// Finds the booking (if any) covering this exact day for this unit.
// check_out is the checkout day itself, not an occupied night, so it's
// excluded from the range.
function bookingForDay(bookings, propertyId, dateStr) {
  return bookings.find((b) => b.property_id === propertyId && b.check_in <= dateStr && b.check_out > dateStr)
}

export default function RentalCalendar({ properties, bookings, monthDate, createdBy, onBookingsChanged }) {
  const [formOpen, setFormOpen] = useState(false)

  const year = monthDate.getFullYear()
  const month = monthDate.getMonth()
  const numDays = new Date(year, month + 1, 0).getDate()
  const days = Array.from({ length: numDays }, (_, i) => i + 1)
  const firstDayStr = toDateStr(year, month, 1)
  const lastDayStr = toDateStr(year, month, numDays)

  async function handleCellClick(booking) {
    const range = `${formatDateStr(booking.check_in)} – ${formatDateStr(booking.check_out)}`
    if (!window.confirm(`Delete booking for ${booking.guest_name} (${range})? This can't be undone.`)) return
    await deleteRentalBooking(booking.id)
    onBookingsChanged()
  }

  return (
    <div className="rental-calendar">
      <button type="button" className="rental-add-booking" onClick={() => setFormOpen(true)}>
        + Add booking
      </button>

      {properties.length === 0 ? (
        <p className="task-notes-empty">No units yet.</p>
      ) : (
        <div className="rental-calendar-scroll">
          <table className="rental-calendar-table">
            <thead>
              <tr>
                <th className="rental-unit-label-header">Unit</th>
                {days.map((day) => (
                  <th key={day} className="rental-day-header">
                    {day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {properties.map((property) => (
                <tr key={property.id} className="rental-unit-row">
                  <td className="rental-unit-label">
                    <span className="rental-unit-dot" style={{ background: property.color }} />
                    {property.unit_name}
                  </td>
                  {days.map((day) => {
                    const dateStr = toDateStr(year, month, day)
                    const booking = bookingForDay(bookings, property.id, dateStr)
                    if (!booking) return <td key={day} className="rental-day-cell" />
                    const isStart = dateStr === booking.check_in || dateStr === firstDayStr
                    const nextDateStr = toDateStr(year, month, Math.min(day + 1, numDays))
                    const isEnd = booking.check_out <= nextDateStr || dateStr === lastDayStr
                    const classes = ['rental-day-cell', 'rental-day-occupied']
                    if (isStart) classes.push('rental-day-start')
                    if (isEnd) classes.push('rental-day-end')
                    return (
                      <td
                        key={day}
                        className={classes.join(' ')}
                        style={{ background: property.color }}
                        title={`${booking.guest_name}: ${formatDateStr(booking.check_in)} – ${formatDateStr(booking.check_out)}`}
                        onClick={() => handleCellClick(booking)}
                      />
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rental-legend">
        {properties.map((property) => (
          <span key={property.id} className="rental-legend-item">
            <span className="rental-legend-swatch" style={{ background: property.color }} />
            {property.unit_name} — ${Number(property.monthly_rent).toLocaleString()}/mo
          </span>
        ))}
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

import { useState } from 'react'
import { deleteRentalBooking } from '../lib/rentals'
import Modal from './Modal'

function formatDateStr(dateStr) {
  // Parsed as local, not UTC — a bare 'YYYY-MM-DD' parsed via `new Date()`
  // would otherwise shift a day depending on the browser's timezone offset.
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

// Viewing a booking and deleting it are separate deliberate steps —
// tapping a highlighted calendar day used to prompt for deletion
// immediately, which was too easy to trigger by an exploratory tap.
export default function RentalBookingDetail({ booking, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!window.confirm(`Delete booking for ${booking.guest_name}? This can't be undone.`)) return
    setDeleting(true)
    try {
      await deleteRentalBooking(booking.id)
      onDeleted()
    } catch (err) {
      alert(err.message)
      setDeleting(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="submission-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Booking details</h2>

        <p className="rental-booking-detail-guest">{booking.guest_name}</p>
        <p className="rental-booking-detail-dates">
          {formatDateStr(booking.check_in)} – {formatDateStr(booking.check_out)}
        </p>

        <div className="submission-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="rental-delete-booking" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete booking'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

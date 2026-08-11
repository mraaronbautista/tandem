import { useState } from 'react'
import { deleteRentalBooking, confirmRentalBooking, BOOKING_SOURCE_LABEL } from '../lib/rentals'
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
export default function RentalBookingDetail({ booking, onClose, onDeleted, onConfirmed }) {
  const [deleting, setDeleting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const isPending = booking.status === 'pending'

  async function handleDelete() {
    const verb = isPending ? 'Decline' : 'Delete'
    if (!window.confirm(`${verb} booking for ${booking.guest_name}? This can't be undone.`)) return
    setDeleting(true)
    try {
      await deleteRentalBooking(booking.id)
      onDeleted()
    } catch (err) {
      alert(err.message)
      setDeleting(false)
    }
  }

  async function handleConfirm() {
    setConfirming(true)
    try {
      await confirmRentalBooking(booking.id)
      onConfirmed()
    } catch (err) {
      alert(err.message)
      setConfirming(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="submission-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Booking details</h2>

        {isPending && <span className="rental-pending-badge">Pending request</span>}
        <p className="rental-booking-detail-guest">{booking.guest_name}</p>
        <p className="rental-booking-detail-dates">
          {formatDateStr(booking.check_in)} – {formatDateStr(booking.check_out)}
        </p>
        {booking.source && (
          <p className="rental-booking-detail-source">
            Source: {BOOKING_SOURCE_LABEL[booking.source]}
            {booking.source === 'other' && booking.source_note ? ` — ${booking.source_note}` : ''}
          </p>
        )}

        <div className="submission-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="rental-delete-booking" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : isPending ? 'Decline' : 'Delete booking'}
          </button>
          {isPending && (
            <button type="button" className="submission-save" onClick={handleConfirm} disabled={confirming}>
              {confirming ? 'Confirming…' : 'Confirm booking'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

import { useState } from 'react'
import {
  deleteRentalBooking,
  confirmRentalBooking,
  setChargePaid,
  chargeDatesForBooking,
  todayDateStr,
  BOOKING_SOURCE_LABEL,
} from '../lib/rentals'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

function formatDateStr(dateStr) {
  // Parsed as local, not UTC — a bare 'YYYY-MM-DD' parsed via `new Date()`
  // would otherwise shift a day depending on the browser's timezone offset.
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

// Viewing a booking and deleting it are separate deliberate steps —
// tapping a highlighted calendar day used to prompt for deletion
// immediately, which was too easy to trigger by an exploratory tap.
export default function RentalBookingDetail({ booking, onClose, onDeleted, onConfirmed, onEdit }) {
  const [deleting, setDeleting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [markingPaid, setMarkingPaid] = useState(false)
  const [error, setError] = useState('')
  const isPending = booking.status === 'pending'
  // The soonest of this booking's own charge dates (see
  // chargeDatesForBooking) that hasn't actually happened yet and isn't
  // already marked paid — an advance payment, same concept as
  // RentalFinancials.jsx's own "Mark paid" button, just scoped to one
  // specific booking instead of "whichever booking generates a
  // property's next charge." A charge that's already arrived doesn't
  // need this at all (isBillableCharge already counts it once the date
  // passes, paid_charges or not), and a pending request can't be paid in
  // advance for something that might still be declined.
  const nextUnpaidCharge = isPending
    ? null
    : chargeDatesForBooking(booking).find((d) => d > todayDateStr() && !(booking.paid_charges || []).includes(d))

  async function handleMarkPaid() {
    setMarkingPaid(true)
    setError('')
    try {
      await setChargePaid(booking.id, booking.paid_charges || [], nextUnpaidCharge)
    } catch (err) {
      setError(err.message)
    } finally {
      setMarkingPaid(false)
    }
  }

  async function handleDelete() {
    const verb = isPending ? 'Decline' : 'Delete'
    if (!window.confirm(`${verb} booking for ${booking.guest_name}? This can't be undone.`)) return
    setDeleting(true)
    setError('')
    try {
      await deleteRentalBooking(booking.id)
      onDeleted()
    } catch (err) {
      setError(err.message)
      setDeleting(false)
    }
  }

  async function handleConfirm() {
    setConfirming(true)
    setError('')
    try {
      await confirmRentalBooking(booking.id)
      onConfirmed()
    } catch (err) {
      setError(err.message)
      setConfirming(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <ModalCard>
        <h2>Booking details</h2>

        {error && <p className="error">{error}</p>}

        {isPending && (
          <span className="inline-block self-start rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">
            Pending request
          </span>
        )}
        <p className="text-[17px] font-semibold text-text-h">{booking.guest_name}</p>
        <p className="opacity-75">
          {formatDateStr(booking.check_in)} – {formatDateStr(booking.check_out)}
        </p>
        {nextUnpaidCharge && (
          <p className="text-[13px] opacity-65">Next charge: {formatDateStr(nextUnpaidCharge)}</p>
        )}
        {booking.source && (
          <p className="text-[13px] opacity-65">
            Source: {BOOKING_SOURCE_LABEL[booking.source]}
            {booking.source === 'other' && booking.source_note ? ` — ${booking.source_note}` : ''}
          </p>
        )}
        {booking.notes && (
          <p className="break-words border-t border-border pt-1 text-sm whitespace-pre-wrap">{booking.notes}</p>
        )}

        <SubmissionActions>
          <SubmissionButton onClick={onClose}>Close</SubmissionButton>
          <SubmissionButton onClick={() => onEdit(booking)}>Edit</SubmissionButton>
          {nextUnpaidCharge && (
            <SubmissionButton onClick={handleMarkPaid} disabled={markingPaid}>
              {markingPaid ? 'Marking…' : `Mark ${formatDateStr(nextUnpaidCharge)} paid`}
            </SubmissionButton>
          )}
          <SubmissionButton variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : isPending ? 'Decline' : 'Delete booking'}
          </SubmissionButton>
          {isPending && (
            <SubmissionButton variant="primary" onClick={handleConfirm} disabled={confirming}>
              {confirming ? 'Confirming…' : 'Confirm booking'}
            </SubmissionButton>
          )}
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

import { useEffect, useState } from 'react'
import { createRentalBooking, updateRentalBooking, hasOverlappingBooking, BOOKING_SOURCE_LABEL } from '../lib/rentals'
import Modal from './Modal'

// 'unspecified' is display-only (see BOOKING_SOURCE_LABEL) — not a real
// choice here, so it's excluded from the picker itself.
const SOURCE_OPTIONS = Object.entries(BOOKING_SOURCE_LABEL).filter(([value]) => value !== 'unspecified')

// 'YYYY-MM-DD' for today in the browser's own local timezone — matches
// what the native date input expects.
function todayDateString() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Parsed as local y/m/d components, not the date string directly — a
// bare 'YYYY-MM-DD' handed straight to `new Date()` is parsed as UTC
// midnight, which can shift a day depending on the browser's timezone
// offset.
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const result = new Date(y, m - 1, d + days)
  const pad = (n) => String(n).padStart(2, '0')
  return `${result.getFullYear()}-${pad(result.getMonth() + 1)}-${pad(result.getDate())}`
}

// Doubles as the Add-booking and Edit-booking form — passing an existing
// `booking` prefills every field and switches the submit path to
// updateRentalBooking instead of createRentalBooking, same "one form,
// initialValues decide create vs. edit" pattern TaskForm.jsx already
// uses. This is also the only way to retroactively set a source (e.g.
// booking source) on a booking created before that field existed.
export default function RentalBookingForm({
  properties,
  defaultPropertyId,
  defaultCheckIn,
  booking,
  createdBy,
  onClose,
  onSaved,
}) {
  const [propertyId, setPropertyId] = useState(booking?.property_id || defaultPropertyId || properties[0]?.id || '')
  const [guestName, setGuestName] = useState(booking?.guest_name || '')
  // defaultCheckIn comes from clicking a specific vacant calendar day —
  // takes priority over today's date, but an existing booking's own
  // check_in (editing) always wins over both.
  const [checkIn, setCheckIn] = useState(booking?.check_in || defaultCheckIn || todayDateString())
  // Rent is charged in ~30-day cycles (see chargeDatesForBooking in
  // rentals.js) — pre-filling checkout at check-in + 29 days matches the
  // common case and saves a step; still fully editable, and an existing
  // booking's real checkout always wins over this default.
  const [checkOut, setCheckOut] = useState(
    booking?.check_out || addDays(booking?.check_in || defaultCheckIn || todayDateString(), 29),
  )
  const [status, setStatus] = useState(booking?.status || 'confirmed')
  const [source, setSource] = useState(booking?.source || '')
  const [sourceNote, setSourceNote] = useState(booking?.source_note || '')
  const [notes, setNotes] = useState(booking?.notes || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // A heads-up as soon as both dates are picked, not just a submit-time
  // alert() after guest name/source/notes are already filled in — the
  // real, authoritative check still runs again on submit (see
  // createRentalBooking/updateRentalBooking), this is purely advisory.
  const [dateConflict, setDateConflict] = useState(false)

  useEffect(() => {
    if (!propertyId || !checkIn || !checkOut || checkOut < checkIn) {
      setDateConflict(false)
      return
    }
    let cancelled = false
    hasOverlappingBooking(propertyId, checkIn, checkOut, booking?.id).then((overlaps) => {
      if (!cancelled) setDateConflict(overlaps)
    })
    return () => {
      cancelled = true
    }
  }, [propertyId, checkIn, checkOut, booking?.id])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!propertyId || !guestName.trim() || !checkIn || !checkOut) return
    setSaving(true)
    setError('')
    try {
      const payload = {
        property_id: propertyId,
        guest_name: guestName.trim(),
        check_in: checkIn,
        check_out: checkOut,
        status,
        source: source || null,
        source_note: sourceNote.trim(),
        notes: notes.trim(),
      }
      const saved = booking
        ? await updateRentalBooking(booking.id, payload)
        : await createRentalBooking({ ...payload, created_by: createdBy })
      onSaved(saved)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <form className="submission-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>{booking ? 'Edit booking' : 'Add booking'}</h2>

        {error && <p className="error">{error}</p>}

        <label>
          Unit
          <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.unit_name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Guest name
          <input
            required
            autoFocus
            placeholder="Who's staying?"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
          />
        </label>

        <label>
          Check-in
          <input type="date" required value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        </label>

        <label>
          Last day
          <input type="date" required min={checkIn} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
        </label>

        {dateConflict && (
          <p className="error">This unit already has a booking that overlaps those dates.</p>
        )}

        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending request</option>
          </select>
        </label>

        <label>
          Source
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">— Not set —</option>
            {SOURCE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {source === 'other' && (
          <label>
            Source details
            <input
              placeholder="e.g. neighbor referral, Craigslist"
              value={sourceNote}
              onChange={(e) => setSourceNote(e.target.value)}
            />
          </label>
        )}

        <label>
          Notes
          <textarea
            rows={3}
            placeholder="Anything else worth remembering about this booking…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        <div className="submission-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="submission-save" disabled={saving}>
            {saving ? 'Saving…' : booking ? 'Save changes' : 'Add booking'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

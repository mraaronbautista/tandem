import { useState } from 'react'
import { createRentalBooking } from '../lib/rentals'
import Modal from './Modal'

// 'YYYY-MM-DD' for today in the browser's own local timezone — matches
// what the native date input expects.
function todayDateString() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function RentalBookingForm({ properties, defaultPropertyId, createdBy, onClose, onCreated }) {
  const [propertyId, setPropertyId] = useState(defaultPropertyId || properties[0]?.id || '')
  const [guestName, setGuestName] = useState('')
  const [checkIn, setCheckIn] = useState(todayDateString())
  const [checkOut, setCheckOut] = useState('')
  const [status, setStatus] = useState('confirmed')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!propertyId || !guestName.trim() || !checkIn || !checkOut) return
    setSaving(true)
    try {
      const booking = await createRentalBooking({
        property_id: propertyId,
        guest_name: guestName.trim(),
        check_in: checkIn,
        check_out: checkOut,
        status,
        created_by: createdBy,
      })
      onCreated(booking)
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <form className="submission-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>Add booking</h2>

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

        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending request</option>
          </select>
        </label>

        <div className="submission-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="submission-save" disabled={saving}>
            {saving ? 'Saving…' : 'Add booking'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

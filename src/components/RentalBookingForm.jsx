import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import {
  createRentalBooking,
  updateRentalBooking,
  hasOverlappingBooking,
  BOOKING_SOURCE_LABEL,
  bookingGuestNames,
} from '../lib/rentals'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

// Matches .submission-field input[type='text'/'number']/textarea
// (App.css:1366-1382) — same fix as the other 3 Rental forms. Deliberately
// does NOT extend to the <select> or type="date" fields below: there's no
// equivalent established convention for those anywhere in the app (bare
// `select` only carries the same shared focus-visible rule as bare
// `input`, same as before this form's text fields were fixed; the only
// styled <select> patterns that exist, like .who-select, are a visually
// distinct pill-filter look for a different context, not a general form
// field). Styling those would be inventing a new look rather than
// applying an existing one, out of scope for this pass.
const FIELD_INPUT_CLASS =
  'w-full rounded-[8px] border border-border bg-bg px-3 py-[10px] text-[15px] text-text-h [font-family:inherit] [line-height:inherit]'
const FIELD_TEXTAREA_CLASS = `${FIELD_INPUT_CLASS} min-h-[90px] resize-y`

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
  const [tenantNames, setTenantNames] = useState(() => {
    const existing = bookingGuestNames(booking)
    return existing.length ? existing : ['']
  })
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

  function setTenantName(index, value) {
    setTenantNames((current) => current.map((name, i) => (i === index ? value : name)))
  }

  function removeTenant(index) {
    setTenantNames((current) => current.filter((_, i) => i !== index))
  }

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
    const cleanedTenantNames = tenantNames.map((name) => name.trim()).filter(Boolean)
    if (!propertyId || cleanedTenantNames.length === 0 || !checkIn || !checkOut) return
    setSaving(true)
    setError('')
    try {
      const payload = {
        property_id: propertyId,
        // Keep guest_name as a human-readable compatibility value for
        // older clients/functions; guest_names is the real structured
        // tenant list used by the current UI.
        guest_name: cleanedTenantNames.join(' and '),
        guest_names: cleanedTenantNames,
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
      <ModalCard as="form" onSubmit={handleSubmit}>
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

        <fieldset className="rounded-[8px] border border-border px-3 py-2">
          <legend className="px-1 text-sm font-medium text-text-h">Tenants</legend>
          <div className="mt-1 flex flex-col gap-2">
            {tenantNames.map((tenantName, index) => (
              <label key={index} className="min-w-0">
                Tenant {index + 1}
                <span className="mt-1 flex min-w-0 gap-1.5">
                  <input
                    required
                    autoFocus={index === 0}
                    placeholder="Tenant name"
                    value={tenantName}
                    onChange={(e) => setTenantName(index, e.target.value)}
                    className={FIELD_INPUT_CLASS}
                  />
                  {tenantNames.length > 1 && (
                    <button
                      type="button"
                      className="flex-none cursor-pointer rounded-[8px] border border-border bg-pill-bg px-2 text-text-h"
                      onClick={() => removeTenant(index)}
                      aria-label={`Remove tenant ${index + 1}`}
                    >
                      <X size={16} />
                    </button>
                  )}
                </span>
              </label>
            ))}
            <button
              type="button"
              className="cursor-pointer self-start rounded-sm border border-border bg-pill-bg px-2.5 py-1.5 text-xs text-text-h"
              onClick={() => setTenantNames((current) => [...current, ''])}
            >
              <Plus size={13} className="mr-1 inline align-[-2px]" /> Add tenant
            </button>
          </div>
        </fieldset>

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
              className={FIELD_INPUT_CLASS}
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
            className={FIELD_TEXTAREA_CLASS}
          />
        </label>

        <SubmissionActions>
          <SubmissionButton onClick={onClose}>Cancel</SubmissionButton>
          <SubmissionButton type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : booking ? 'Save changes' : 'Add booking'}
          </SubmissionButton>
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

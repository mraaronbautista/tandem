import { useState } from 'react'
import { MapPin } from 'lucide-react'
import { createWorkSite, updateWorkSite, archiveWorkSite } from '../lib/staff'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

// Matches .submission-field input (see RentalPropertyForm.jsx's own
// identical constant/comment) — same fix repeated locally rather than
// shared, matching this codebase's own established preference for small
// per-file duplication over a shared module for a handful of lines.
const FIELD_INPUT_CLASS =
  'w-full rounded-[8px] border border-border bg-bg px-3 py-[10px] text-[15px] text-text-h [font-family:inherit] [line-height:inherit]'

// Same "one form, initialValues decide create vs. edit" shape as
// RentalPropertyForm.jsx. The one thing a plain lat/lng text field
// can't give an admin: confidence the numbers are actually right — the
// "Use my current location" button lets Ada/Aaron stand at the real
// property and capture exact coordinates with one tap, the same
// getCurrentPosition call StaffClockView.jsx uses for clock-in. Manual
// entry stays available as a fallback (e.g. adding a site remotely).
export default function StaffWorkSitesForm({ site, rentalProperties, onClose, onSaved, onArchived }) {
  const [name, setName] = useState(site?.name || '')
  const [address, setAddress] = useState(site?.address || '')
  const [latitude, setLatitude] = useState(site?.latitude ?? '')
  const [longitude, setLongitude] = useState(site?.longitude ?? '')
  const [radiusM, setRadiusM] = useState(site?.geofence_radius_m ?? 100)
  const [rentalPropertyId, setRentalPropertyId] = useState(site?.rental_property_id || '')
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [error, setError] = useState('')

  function handleUseCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationError('Location is not supported on this device/browser.')
      return
    }
    setLocating(true)
    setLocationError('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude)
        setLongitude(pos.coords.longitude)
        setLocating(false)
      },
      () => {
        setLocationError("Couldn't get your location — enter the coordinates manually instead.")
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || latitude === '' || longitude === '') return
    setSaving(true)
    setError('')
    try {
      const payload = {
        name: name.trim(),
        address: address.trim(),
        latitude: Number(latitude),
        longitude: Number(longitude),
        geofence_radius_m: Number(radiusM) || 100,
        rental_property_id: rentalPropertyId || null,
      }
      const saved = site ? await updateWorkSite(site.id, payload) : await createWorkSite(payload)
      onSaved(saved)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive() {
    if (!window.confirm(`Remove "${site.name}" from the active site list? Past time entries are kept.`)) return
    setArchiving(true)
    setError('')
    try {
      await archiveWorkSite(site.id)
      onArchived()
    } catch (err) {
      setError(err.message)
      setArchiving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <ModalCard as="form" onSubmit={handleSubmit}>
        <h2>{site ? 'Edit work site' : 'New work site'}</h2>

        {error && <p className="error">{error}</p>}

        <label>
          Site name
          <input
            required
            autoFocus
            placeholder="e.g. Rachel St."
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
        </label>

        <label>
          Address (optional)
          <input
            placeholder="e.g. 123 Rachel St."
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
        </label>

        {rentalProperties?.length > 0 && (
          <label>
            Linked Awa Rentalz unit (optional)
            <select
              value={rentalPropertyId}
              onChange={(e) => setRentalPropertyId(e.target.value)}
              className={FIELD_INPUT_CLASS}
            >
              <option value="">Not a rental unit</option>
              {rentalProperties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.unit_name}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          className="cursor-pointer self-start rounded-sm border border-border bg-pill-bg px-3 py-2 text-sm text-text-h"
          onClick={handleUseCurrentLocation}
          disabled={locating}
        >
          {locating ? (
            'Locating…'
          ) : (
            <>
              <MapPin size={14} className="mr-1 inline align-[-2px]" /> Use my current location
            </>
          )}
        </button>
        {locationError && <p className="error">{locationError}</p>}

        <div className="flex gap-2">
          <label className="flex-1">
            Latitude
            <input
              required
              type="number"
              step="any"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              className={FIELD_INPUT_CLASS}
            />
          </label>
          <label className="flex-1">
            Longitude
            <input
              required
              type="number"
              step="any"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              className={FIELD_INPUT_CLASS}
            />
          </label>
        </div>

        <label>
          Geofence radius (meters)
          <input
            type="number"
            min="10"
            step="10"
            value={radiusM}
            onChange={(e) => setRadiusM(e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
        </label>

        <SubmissionActions>
          <SubmissionButton onClick={onClose}>Cancel</SubmissionButton>
          {site && (
            <SubmissionButton variant="destructive" onClick={handleArchive} disabled={archiving}>
              {archiving ? 'Removing…' : 'Remove site'}
            </SubmissionButton>
          )}
          <SubmissionButton type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : site ? 'Save changes' : 'Add site'}
          </SubmissionButton>
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

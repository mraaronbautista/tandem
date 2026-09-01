import { useState } from 'react'
import { MapPin } from 'lucide-react'
import { createWorkSite, updateWorkSite, archiveWorkSite, assignRentalPropertiesToWorkSite } from '../lib/staff'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

const FIELD_INPUT_CLASS =
  'w-full rounded-[8px] border border-border bg-bg px-3 py-[10px] text-[15px] text-text-h [font-family:inherit] [line-height:inherit]'

export default function StaffWorkSitesForm({ site, rentalProperties, onClose, onSaved, onArchived }) {
  const [name, setName] = useState(site?.name || '')
  const [address, setAddress] = useState(site?.address || '')
  const [latitude, setLatitude] = useState(site?.latitude ?? '')
  const [longitude, setLongitude] = useState(site?.longitude ?? '')
  const [radiusM, setRadiusM] = useState(site?.geofence_radius_m ?? 150)
  const [propertyIds, setPropertyIds] = useState(
    rentalProperties.filter((property) => property.work_site_id === site?.id).map((property) => property.id),
  )
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [error, setError] = useState('')

  function toggleProperty(propertyId) {
    setPropertyIds((current) =>
      current.includes(propertyId) ? current.filter((id) => id !== propertyId) : [...current, propertyId],
    )
  }

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
        setLocationError("Couldn't get this device's location. Address lookup will be added next.")
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError('')
    try {
      const hasCoordinates = latitude !== '' && longitude !== ''
      const existingWasUnconfigured = site && (site.latitude == null || site.longitude == null)
      const shouldBeActive = site ? site.active || (existingWasUnconfigured && hasCoordinates) : hasCoordinates
      const payload = {
        name: name.trim(),
        address: address.trim(),
        latitude: hasCoordinates ? Number(latitude) : null,
        longitude: hasCoordinates ? Number(longitude) : null,
        geofence_radius_m: Number(radiusM) || 150,
        active: shouldBeActive,
      }
      const saved = site ? await updateWorkSite(site.id, payload) : await createWorkSite(payload)
      await assignRentalPropertiesToWorkSite(saved.id, propertyIds)
      onSaved(saved)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive() {
    if (!window.confirm(`Deactivate "${site.name}" as a clock-in location? Past shifts and linked units are kept.`)) return
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
        <h2>{site ? 'Edit physical location' : 'New physical location'}</h2>
        {error && <p className="error">{error}</p>}

        <label>
          Location name
          <input required autoFocus placeholder="e.g. Rachel or Parkside" value={name} onChange={(event) => setName(event.target.value)} className={FIELD_INPUT_CLASS} />
        </label>

        <label>
          Address (optional for now)
          <input placeholder="Street address for this physical location" value={address} onChange={(event) => setAddress(event.target.value)} className={FIELD_INPUT_CLASS} />
        </label>

        <fieldset className="rounded-[8px] border border-border px-3 py-2">
          <legend className="px-1 text-sm font-medium text-text-h">Rental units at this location</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {rentalProperties.map((property) => {
              const assignedElsewhere = property.work_site_id && property.work_site_id !== site?.id
              return (
                <label key={property.id} className="flex min-w-0 cursor-pointer items-start gap-2 rounded-sm bg-card-bg px-2.5 py-2 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={propertyIds.includes(property.id)} onChange={() => toggleProperty(property.id)} />
                  <span className="min-w-0">
                    <span className="block truncate text-text-h">{property.unit_name}</span>
                    <span className="block text-xs opacity-60">
                      {property.company === 'azu' ? 'Azu' : 'Awa'}{assignedElsewhere ? ' · currently linked elsewhere' : ''}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
          {rentalProperties.length === 0 && <p className="py-2 text-sm opacity-60">No active rental units yet.</p>}
        </fieldset>

        <details className="rounded-[8px] border border-border px-3 py-2" open={latitude === '' || longitude === ''}>
          <summary className="cursor-pointer text-sm font-medium text-text-h">Clock-in point</summary>
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-xs opacity-65">
              You can save this group before GPS is configured. It will show Needs setup and will not appear to staff yet.
            </p>
            <button type="button" className="cursor-pointer self-start rounded-sm border border-border bg-pill-bg px-3 py-2 text-sm text-text-h" onClick={handleUseCurrentLocation} disabled={locating}>
              {locating ? 'Locating…' : <><MapPin size={14} className="mr-1 inline align-[-2px]" /> Use this device's current location</>}
            </button>
            {locationError && <p className="error">{locationError}</p>}
            <div className="grid grid-cols-2 gap-2">
              <label className="min-w-0">
                Latitude
                <input type="number" step="any" value={latitude} onChange={(event) => setLatitude(event.target.value)} className={FIELD_INPUT_CLASS} />
              </label>
              <label className="min-w-0">
                Longitude
                <input type="number" step="any" value={longitude} onChange={(event) => setLongitude(event.target.value)} className={FIELD_INPUT_CLASS} />
              </label>
            </div>
            <label>
              Allowed radius (meters)
              <input type="number" min="10" step="10" value={radiusM} onChange={(event) => setRadiusM(event.target.value)} className={FIELD_INPUT_CLASS} />
            </label>
          </div>
        </details>

        <SubmissionActions>
          <SubmissionButton onClick={onClose}>Cancel</SubmissionButton>
          {site && (
            <SubmissionButton variant="destructive" onClick={handleArchive} disabled={archiving}>
              {archiving ? 'Deactivating…' : 'Deactivate'}
            </SubmissionButton>
          )}
          <SubmissionButton type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save location'}
          </SubmissionButton>
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

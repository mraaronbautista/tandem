import { useState } from 'react'
import { createRentalProperty, updateRentalProperty, archiveRentalProperty, LAST_DAY, dueDayLabel } from '../lib/rentals'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'
import { useConfirm } from '../lib/confirmContext'
import { friendlyError } from '../lib/friendlyError'
import RentDuePreview from './RentDuePreview'

const DEFAULT_COLOR = '#3b82f6'

// "1st", "2nd", ... for the Rent due day dropdown (1 to 28; the 29th to 31st do
// not exist in every month, so "Last day of the month" covers those).
const DUE_DAY_OPTIONS = Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: dueDayLabel(i + 1).replace('the ', '') }))

// Matches .submission-field input[type='text'/'number'] (App.css:1366-1376)
// — same fix as RentalSavingsGoalForm.jsx/RentalExpenseForm.jsx. Does NOT
// apply to the Calendar color field below — that's type="color", outside
// this selector's scope even in the original CSS, styled by its own
// compact utilities instead.
const FIELD_INPUT_CLASS =
  'w-full rounded-[8px] border border-border bg-bg px-3 py-[10px] text-[15px] text-text-h [font-family:inherit] [line-height:inherit]'

// Same "one form, initialValues decide create vs. edit" pattern as
// RentalBookingForm.jsx/RentalExpenseForm.jsx. Properties had no in-app
// way to add or edit at all before this — creating/renaming a unit
// meant going straight into the Supabase table editor.
//
// `defaultTerm` seeds a new unit's term from whichever tab (Short/Midterm
// vs. Long Term) was active in RentalsView.jsx when "+ Add unit" was
// tapped — same reasoning the company picker already scopes a new unit to
// whichever company tab you're on, rather than making term a choice with
// no sensible default.
export default function RentalPropertyForm({ company, property, defaultTerm, locations = null, bookings = [], onClose, onSaved, onArchived }) {
  const confirm = useConfirm()
  const [unitName, setUnitName] = useState(property?.unit_name || '')
  const [address, setAddress] = useState(property?.address || '')
  const [monthlyRent, setMonthlyRent] = useState(property?.monthly_rent ?? '')
  const [color, setColor] = useState(property?.color || DEFAULT_COLOR)
  const [term, setTerm] = useState(property?.term || defaultTerm || 'short_midterm')
  const [workSiteId, setWorkSiteId] = useState(property?.work_site_id || '')
  // '' = "Same as move-in day" (null in the database).
  const [rentDueDay, setRentDueDay] = useState(property?.rent_due_day == null ? '' : String(property.rent_due_day))
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!unitName.trim()) return
    setSaving(true)
    setError('')
    try {
      const payload = {
        unit_name: unitName.trim(),
        address: address.trim(),
        monthly_rent: monthlyRent === '' ? null : Number(monthlyRent),
        color,
        term,
        ...(locations ? { work_site_id: workSiteId || null } : {}),
        // Only sent when it changed, so saving a unit never touches a database
        // that has not had add-rent-due-day.sql run yet.
        ...(rentDueDay !== (property?.rent_due_day == null ? '' : String(property.rent_due_day))
          ? { rent_due_day: rentDueDay === '' ? null : Number(rentDueDay) }
          : {}),
      }
      const saved = property
        ? await updateRentalProperty(property.id, payload)
        : await createRentalProperty(company, payload)
      onSaved(saved)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive() {
    const ok = await confirm({
      title: `Remove "${property.unit_name}" from the active unit list?`,
      message: 'Its booking history is kept.',
      confirmLabel: 'Remove unit',
      tone: 'neutral',
    })
    if (!ok) return
    setArchiving(true)
    setError('')
    try {
      await archiveRentalProperty(property.id)
      onArchived()
    } catch (err) {
      setError(friendlyError(err))
      setArchiving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <ModalCard as="form" onSubmit={handleSubmit}>
        <h2>{property ? 'Edit unit' : 'New unit'}</h2>

        {error && <p className="error">{error}</p>}

        <label>
          Unit name
          <input
            required
            autoFocus
            placeholder="e.g. Healthcare Haven"
            value={unitName}
            onChange={(e) => setUnitName(e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
        </label>

        <label>
          Term
          <select value={term} onChange={(e) => setTerm(e.target.value)} className={FIELD_INPUT_CLASS}>
            <option value="short_midterm">Short/Midterm</option>
            <option value="long_term">Long Term</option>
          </select>
        </label>

        {locations && <label>Location<select aria-label="Location" className={FIELD_INPUT_CLASS} value={workSiteId} onChange={(event) => setWorkSiteId(event.target.value)}><option value="">No location set</option>{locations.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>}
        <p className="text-sm text-text">Location-wide service contacts appear for every unit assigned to that location. Manage location names under Staff.</p>
        <label>
          Address (optional)
          <input
            placeholder="e.g. 123 Main St"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
        </label>

        <label>
          Monthly rent (optional)
          <input
            type="number"
            min="0"
            step="1"
            placeholder="e.g. 1800"
            value={monthlyRent}
            onChange={(e) => setMonthlyRent(e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
        </label>

        <label>
          Rent due day
          <select value={rentDueDay} onChange={(e) => setRentDueDay(e.target.value)} className={FIELD_INPUT_CLASS}>
            <option value="">Same as move-in day</option>
            {DUE_DAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            <option value={String(LAST_DAY)}>Last day of the month</option>
          </select>
          <span className="mt-1 block text-xs text-text">
            {rentDueDay === ''
              ? "Rent is charged on each tenant's move-in day, a full month at a time."
              : `Rent is charged on ${dueDayLabel(Number(rentDueDay))} of every month, like TurboTenant. A part-month at move-in or move-out is prorated by days.`}
          </span>
        </label>

        {/* What each setting would charge the unit's tenant, calculated live from
            the dropdown above. Nothing is saved until Save changes. */}
        <RentDuePreview
          property={property}
          bookings={bookings}
          rent={monthlyRent}
          currentDueDay={property?.rent_due_day ?? null}
          selectedDueDay={rentDueDay === '' ? null : Number(rentDueDay)}
        />

        <label>
          Calendar color
          <input
            type="color"
            className="h-9 w-[60px] self-start cursor-pointer rounded-[6px] border border-border bg-transparent p-0.5"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>

        <SubmissionActions>
          <SubmissionButton onClick={onClose}>Cancel</SubmissionButton>
          {property && (
            <SubmissionButton variant="destructive" onClick={handleArchive} disabled={archiving}>
              {archiving ? 'Removing…' : 'Remove unit'}
            </SubmissionButton>
          )}
          <SubmissionButton type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : property ? 'Save changes' : 'Add unit'}
          </SubmissionButton>
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

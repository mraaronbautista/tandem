import { useState } from 'react'
import { createRentalProperty, updateRentalProperty, archiveRentalProperty } from '../lib/rentals'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

const DEFAULT_COLOR = '#3b82f6'

// Matches .submission-field input[type='text'/'number'] (App.css:1366-1376)
// — same fix as RentalSavingsGoalForm.jsx/RentalExpenseForm.jsx. Does NOT
// apply to the Calendar color field below — that's type="color", outside
// this selector's scope even in the original CSS, styled by its own
// .rental-property-color-input class instead (untouched here).
const FIELD_INPUT_CLASS =
  'w-full rounded-[8px] border border-border bg-bg px-3 py-[10px] text-[15px] text-text-h [font-family:inherit] [line-height:inherit]'

// Same "one form, initialValues decide create vs. edit" pattern as
// RentalBookingForm.jsx/RentalExpenseForm.jsx. Properties had no in-app
// way to add or edit at all before this — creating/renaming a unit
// meant going straight into the Supabase table editor.
export default function RentalPropertyForm({ company, property, onClose, onSaved, onArchived }) {
  const [unitName, setUnitName] = useState(property?.unit_name || '')
  const [address, setAddress] = useState(property?.address || '')
  const [monthlyRent, setMonthlyRent] = useState(property?.monthly_rent ?? '')
  const [color, setColor] = useState(property?.color || DEFAULT_COLOR)
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
      }
      const saved = property
        ? await updateRentalProperty(property.id, payload)
        : await createRentalProperty(company, payload)
      onSaved(saved)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive() {
    if (!window.confirm(`Remove "${property.unit_name}" from the active unit list? Its booking history is kept.`))
      return
    setArchiving(true)
    setError('')
    try {
      await archiveRentalProperty(property.id)
      onArchived()
    } catch (err) {
      setError(err.message)
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
          Calendar color
          <input
            type="color"
            className="rental-property-color-input"
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

import { useState } from 'react'
import { updateStaffProfile } from '../lib/staff'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

const FIELD_CLASS =
  'w-full rounded-[8px] border border-border bg-bg px-3 py-[10px] text-[15px] text-text-h [font-family:inherit] [line-height:inherit]'

export default function StaffProfileForm({ staffMember, onClose, onSaved }) {
  const [displayName, setDisplayName] = useState(staffMember.display_name)
  const [hourlyRate, setHourlyRate] = useState(staffMember.hourly_rate)
  const [emergencyRate, setEmergencyRate] = useState(staffMember.emergency_rate)
  const [payrollCadence, setPayrollCadence] = useState(staffMember.payroll_cadence || 'biweekly')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const saved = await updateStaffProfile(staffMember.id, {
        display_name: displayName.trim(),
        hourly_rate: Number(hourlyRate),
        emergency_rate: Number(emergencyRate),
        payroll_cadence: payrollCadence,
      })
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
        <h2>Edit staff member</h2>
        {error && <p className="error">{error}</p>}

        <label>
          Display name
          <input
            required
            autoFocus
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className={FIELD_CLASS}
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="min-w-0">
            Standard rate ($/hr)
            <input
              required
              type="number"
              min="0"
              step="0.01"
              value={hourlyRate}
              onChange={(event) => setHourlyRate(event.target.value)}
              className={FIELD_CLASS}
            />
          </label>
          <label className="min-w-0">
            Emergency rate ($/hr)
            <input
              required
              type="number"
              min="0"
              step="0.01"
              value={emergencyRate}
              onChange={(event) => setEmergencyRate(event.target.value)}
              className={FIELD_CLASS}
            />
          </label>
        </div>

        <p className="text-xs opacity-65">Rate changes apply only to future clock-ins. Past shifts keep their original rate.</p>

        <label>
          Payroll cadence
          <select
            value={payrollCadence}
            onChange={(event) => setPayrollCadence(event.target.value)}
            className={FIELD_CLASS}
          >
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="twice_monthly">Twice a month</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>

        <SubmissionActions>
          <SubmissionButton onClick={onClose}>Cancel</SubmissionButton>
          <SubmissionButton type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </SubmissionButton>
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

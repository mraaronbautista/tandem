import { useState } from 'react'
import { updateStaffProfile, createStaffAccount } from '../lib/staff'
import { generateStrongPassword } from '../lib/vault'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

const FIELD_CLASS =
  'w-full rounded-[8px] border border-border bg-bg px-3 py-[10px] text-[15px] text-text-h [font-family:inherit] [line-height:inherit]'

// staffMember null = create (username/password fields appear, calling the
// create-staff-account Edge Function since a new staff.id needs a new
// auth.users row first — a privileged operation the browser can't do
// directly); staffMember set = edit, unchanged from before. Same
// `x ? edit : create` shape StaffWorkSitesForm.jsx/StaffTimeEntryForm.jsx
// already use, rather than a separate create-only component — the shared
// fields (display name, rates, cadence) outweigh what's actually different.
export default function StaffProfileForm({ staffMember, onClose, onSaved }) {
  const isCreate = !staffMember

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState(staffMember?.display_name || '')
  const [hourlyRate, setHourlyRate] = useState(staffMember?.hourly_rate ?? '')
  const [emergencyRate, setEmergencyRate] = useState(staffMember?.emergency_rate ?? '')
  const [payrollCadence, setPayrollCadence] = useState(staffMember?.payroll_cadence || 'biweekly')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (isCreate) {
        await createStaffAccount({
          username: username.trim(),
          password,
          displayName: displayName.trim(),
          hourlyRate: Number(hourlyRate),
          emergencyRate: Number(emergencyRate),
          payrollCadence,
        })
        // No row to hand back the way updateStaffProfile()'s single-row
        // update does — the caller (StaffLogsView.jsx) just refetches the
        // whole roster in this branch.
        onSaved(null)
      } else {
        const saved = await updateStaffProfile(staffMember.id, {
          display_name: displayName.trim(),
          hourly_rate: Number(hourlyRate),
          emergency_rate: Number(emergencyRate),
          payroll_cadence: payrollCadence,
        })
        onSaved(saved)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <ModalCard as="form" onSubmit={handleSubmit}>
        <h2>{isCreate ? 'Add a property manager' : 'Edit staff member'}</h2>
        {error && <p className="error">{error}</p>}

        {isCreate && (
          <>
            <label>
              Username (how they sign in — no email needed)
              <input
                required
                autoFocus
                placeholder="e.g. maria"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                className={FIELD_CLASS}
              />
            </label>
            <label>
              Password
              <div className="flex gap-2">
                <input
                  required
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={FIELD_CLASS}
                />
                <button
                  type="button"
                  className="flex-none cursor-pointer rounded-sm border border-border bg-pill-bg px-3 py-2 text-sm text-text-h"
                  onClick={() => setPassword(generateStrongPassword(12))}
                >
                  Generate
                </button>
              </div>
              <span className="mt-1 block text-xs opacity-65">
                Share this with them directly — there's no email to send it to. At least 8 characters.
              </span>
            </label>
          </>
        )}

        <label>
          Display name
          <input
            required
            autoFocus={!isCreate}
            placeholder={isCreate ? 'e.g. Maria' : undefined}
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

        {!isCreate && (
          <p className="text-xs opacity-65">Rate changes apply only to future clock-ins. Past shifts keep their original rate.</p>
        )}

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
            {saving ? 'Saving…' : isCreate ? 'Create account' : 'Save changes'}
          </SubmissionButton>
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

import { useState } from 'react'
import { updateTimeEntryTimes, createManualTimeEntry } from '../lib/staff'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

const FIELD_CLASS =
  'w-full rounded-[8px] border border-border bg-bg px-3 py-[10px] text-[15px] text-text-h [font-family:inherit] [line-height:inherit]'

// datetime-local reads/writes local wall-clock time with no timezone of its
// own — same "viewer-local, no per-entry zone" convention the rest of
// staff time tracking already uses (StaffClockView.jsx's startOfToday()/
// startOfWeek() are plain local Date too; unlike tasks.due_timezone, a
// shift has no separate stored zone to round-trip through).
function toLocalInputValue(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInputValue(value) {
  if (!value) return null
  return new Date(value).toISOString()
}

// Handles both editing an existing shift's times (entry set) and adding one
// that was never clocked into at all (entry null) — see "Manual time
// entries and correction requests" in schema.sql. Two different field sets
// under one component rather than two files, same reasoning
// StaffWorkSitesForm.jsx's site ? edit : create already follows: the shared
// parts (this modal shape, the time fields) outweigh what's actually
// different between them.
export default function StaffTimeEntryForm({ entry, staffRoster = [], workSites = [], meId, onClose, onSaved }) {
  const isEdit = Boolean(entry)

  const [staffId, setStaffId] = useState(staffRoster.find((s) => s.active)?.id || '')
  const [workSiteId, setWorkSiteId] = useState(workSites[0]?.id || '')
  const [rateType, setRateType] = useState('standard')
  const [notes, setNotes] = useState('')

  const [clockInAt, setClockInAt] = useState(toLocalInputValue(entry?.clock_in_at) || toLocalInputValue(new Date().toISOString()))
  // Reopening a shift (clearing clock-out back to null) is a real, if rare,
  // correction — same reasoning updateTimeEntryTimes()'s own comment in
  // staff.js gives. A plain empty datetime-local input can't distinguish
  // "not set yet" from "deliberately cleared," hence the separate checkbox
  // rather than inferring null purely from an empty string.
  const [hasClockOut, setHasClockOut] = useState(isEdit ? Boolean(entry.clock_out_at) : true)
  const [clockOutAt, setClockOutAt] = useState(toLocalInputValue(entry?.clock_out_at))

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selectedSite = workSites.find((s) => s.id === workSiteId)
  const selectedStaff = staffRoster.find((s) => s.id === staffId)

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (isEdit) {
        await updateTimeEntryTimes(entry.id, {
          clockInAt: fromLocalInputValue(clockInAt),
          clockOutAt: hasClockOut ? fromLocalInputValue(clockOutAt) : null,
        })
      } else {
        if (!selectedSite) throw new Error('Pick a work site.')
        if (selectedSite.latitude == null || selectedSite.longitude == null) {
          throw new Error('That site has no clock-in point configured yet.')
        }
        await createManualTimeEntry({
          staffId,
          workSiteId,
          siteLat: selectedSite.latitude,
          siteLng: selectedSite.longitude,
          rateType,
          clockInAt: fromLocalInputValue(clockInAt),
          clockOutAt: hasClockOut ? fromLocalInputValue(clockOutAt) : null,
          notes,
          approverId: meId,
        })
      }
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <ModalCard as="form" onSubmit={handleSubmit}>
        <h2>{isEdit ? 'Edit shift times' : 'Add a shift manually'}</h2>
        {error && <p className="error">{error}</p>}

        {!isEdit && (
          <>
            <label>
              Property manager
              <select value={staffId} onChange={(event) => setStaffId(event.target.value)} className={FIELD_CLASS}>
                {staffRoster
                  .filter((s) => s.active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.display_name}
                    </option>
                  ))}
              </select>
            </label>

            <label>
              Clock-in location
              <select value={workSiteId} onChange={(event) => setWorkSiteId(event.target.value)} className={FIELD_CLASS}>
                {workSites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {workSites.length === 0 && (
              <p className="text-xs opacity-65">No ready clock-in locations yet — set one up first.</p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`rounded-sm border px-3 py-2 text-sm ${rateType === 'standard' ? 'border-accent bg-accent text-white' : 'border-border bg-bg text-text'}`}
                onClick={() => setRateType('standard')}
              >
                Standard{selectedStaff ? ` ($${selectedStaff.hourly_rate}/hr)` : ''}
              </button>
              <button
                type="button"
                className={`rounded-sm border px-3 py-2 text-sm ${rateType === 'emergency' ? 'border-accent bg-accent text-white' : 'border-border bg-bg text-text'}`}
                onClick={() => setRateType('emergency')}
              >
                Emergency{selectedStaff ? ` ($${selectedStaff.emergency_rate}/hr)` : ''}
              </button>
            </div>
          </>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="min-w-0">
            Clock in
            <input
              required
              type="datetime-local"
              value={clockInAt}
              onChange={(event) => setClockInAt(event.target.value)}
              className={FIELD_CLASS}
            />
          </label>
          <label className="min-w-0">
            Clock out
            <input
              type="datetime-local"
              disabled={!hasClockOut}
              value={clockOutAt}
              onChange={(event) => setClockOutAt(event.target.value)}
              className={`${FIELD_CLASS} disabled:opacity-50`}
            />
          </label>
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs opacity-75">
          <input
            type="checkbox"
            checked={hasClockOut}
            onChange={(event) => {
              setHasClockOut(event.target.checked)
              if (event.target.checked && !clockOutAt) setClockOutAt(toLocalInputValue(new Date().toISOString()))
            }}
          />
          Has a clock-out time
          {isEdit && !entry.clock_out_at ? ' (unchecking leaves this shift open, same as it is now)' : ''}
        </label>

        {!isEdit && (
          <label>
            Notes (optional)
            <textarea
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className={`${FIELD_CLASS} resize-y`}
            />
          </label>
        )}

        <SubmissionActions>
          <SubmissionButton onClick={onClose}>Cancel</SubmissionButton>
          <SubmissionButton type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save times' : 'Add shift'}
          </SubmissionButton>
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

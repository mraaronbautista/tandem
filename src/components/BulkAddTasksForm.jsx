import { useMemo, useState } from 'react'
import { parseBulkSchedule } from '../lib/bulkTasks'
import { createTask } from '../lib/tasks'
import { TIMEZONE_OPTIONS, zonedTimeToUtcIso } from '../lib/timezone'
import { WHO_LABEL, whoKeyForName } from '../lib/whoLabels'
import Modal from './Modal'

// A bulk paste is often one person entering the OTHER person's schedule
// (e.g. Aaron, in the Philippines, pasting in Ada's US shift times) —
// defaulting the zone to whoever's device is filling out the form
// (detectDefaultTimezone, same as the regular task form) would silently
// read those times in the wrong zone. Defaulting to the selected
// person's own known zone instead — same hardcoded two-person mapping
// whoLabels.js already uses for names — gets it right by default in the
// common case, while still leaving the picker open for the "actually,
// this batch is in a different zone" exception. Used only as a fallback
// when that person hasn't set an explicit default_timezone in Settings
// (see zoneForWho below) — this hardcoded guess predates that setting.
const WHO_DEFAULT_ZONE = { yours: 'America/Chicago', assistant: 'Asia/Manila' }

const PLACEHOLDER = `Aug 21
Texas 12a-4a
Washington 2a-5a
Texas 4a-7a
Washington 10p-2a

Aug 22
Texas 12a-4a
Washington 2a-5a
Texas 4a-7a`

function formatPreviewTime(dueTime, durationMinutes) {
  const [h, m] = dueTime.split(':').map(Number)
  const start = new Date(2000, 0, 1, h, m)
  const end = new Date(start.getTime() + durationMinutes * 60000)
  const fmt = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `${fmt(start)} – ${fmt(end)}`
}

// Includes the year only when it's not the current one — a bulk paste is
// almost always same-year, so spelling it out every row would just be
// noise, but the one time a line lands in an unexpected year (e.g. the
// no-year-given date-header heuristic in bulkTasks.js rolling a stale
// date into next year) is exactly when it needs to be visible here.
function formatPreviewDate(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const date = new Date(y, mo - 1, d)
  const opts = { weekday: 'short', month: 'short', day: 'numeric' }
  if (y !== new Date().getFullYear()) opts.year = 'numeric'
  return date.toLocaleDateString([], opts)
}

// A whole schedule at once — a date line followed by one shift per line
// ("Texas 12a-4a") until the next date line — instead of clicking through
// the New Task form once per shift. All tasks in one paste get the same
// `who`; there's no per-line assignee since a pasted schedule like this
// is normally all one person's shifts. See lib/bulkTasks.js for the
// actual parsing rules and why a line can usually be pasted close to
// verbatim out of a schedule tool's own display.
export default function BulkAddTasksForm({ me, members, defaultWho, onClose, onCreated }) {
  const [text, setText] = useState('')
  const [who, setWho] = useState(defaultWho || 'yours')

  // That person's own saved preference (Settings) if they've set one,
  // else the hardcoded guess above. Looked up by `who` rather than a
  // fixed member id since either "yours" or "assistant" can be selected.
  function zoneForWho(w) {
    const member = members?.find((m) => whoKeyForName(m.display_name) === w)
    return member?.default_timezone || WHO_DEFAULT_ZONE[w]
  }

  const [zone, setZone] = useState(() => zoneForWho(defaultWho || 'yours'))
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // Re-defaults the zone to the newly-selected person's own — see
  // zoneForWho above. If they'd already picked a different zone on
  // purpose they can just re-pick it after switching; silently keeping a
  // stale zone selected across a Who switch would risk the exact mistake
  // this default exists to avoid.
  function handleWhoChange(nextWho) {
    setWho(nextWho)
    setZone(zoneForWho(nextWho))
  }

  const { tasks, errors } = useMemo(() => parseBulkSchedule(text), [text])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!tasks.length || saving) return
    setSaving(true)
    setSubmitError('')
    try {
      await Promise.all(
        tasks.map((t) =>
          createTask({
            title: t.title,
            who,
            due_date: zonedTimeToUtcIso(t.due_date, t.due_time, zone),
            due_timezone: zone,
            duration_minutes: t.duration_minutes,
            created_by: me.id,
          }),
        ),
      )
      onCreated()
    } catch (err) {
      setSubmitError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <form className="submission-modal bulk-add-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>Bulk add tasks</h2>
        <p className="bulk-add-hint">
          A date on its own line, then one shift per line below it as "Title start-end" — e.g. "Texas 12a-4a".
        </p>

        <label>
          Who
          <select value={who} onChange={(e) => handleWhoChange(e.target.value)}>
            <option value="yours">{WHO_LABEL.yours}</option>
            <option value="assistant">{WHO_LABEL.assistant}</option>
          </select>
        </label>

        <label>
          Time zone
          <select value={zone} onChange={(e) => setZone(e.target.value)}>
            {TIMEZONE_OPTIONS.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Schedule
          <textarea rows={10} placeholder={PLACEHOLDER} value={text} onChange={(e) => setText(e.target.value)} />
        </label>

        {text.trim() && (
          <div className="bulk-add-preview">
            {tasks.length > 0 && (
              <>
                <span className="submission-field-label">
                  {tasks.length} task{tasks.length === 1 ? '' : 's'} ready
                </span>
                <ul className="bulk-add-preview-list">
                  {tasks.map((t, i) => (
                    <li key={i}>
                      <span className="bulk-add-preview-date">{formatPreviewDate(t.due_date)}</span>
                      <span className="bulk-add-preview-title">{t.title}</span>
                      <span className="bulk-add-preview-time">{formatPreviewTime(t.due_time, t.duration_minutes)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {errors.length > 0 && (
              <>
                <span className="submission-field-label bulk-add-error-label">
                  {errors.length} line{errors.length === 1 ? '' : 's'} couldn't be read
                </span>
                <ul className="bulk-add-error-list">
                  {errors.map((err) => (
                    <li key={err.line}>
                      Line {err.line}: "{err.text}" — {err.message}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {submitError && <p className="error">{submitError}</p>}

        <div className="submission-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="submission-save" disabled={saving || tasks.length === 0}>
            {saving ? 'Creating…' : tasks.length ? `Create ${tasks.length} task${tasks.length === 1 ? '' : 's'}` : 'Create tasks'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

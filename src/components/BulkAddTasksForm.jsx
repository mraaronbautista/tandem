import { useMemo, useState } from 'react'
import { parseBulkSchedule } from '../lib/bulkTasks'
import { createTask } from '../lib/tasks'
import { detectDefaultTimezone, zonedTimeToUtcIso } from '../lib/timezone'
import { WHO_LABEL } from '../lib/whoLabels'
import Modal from './Modal'

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

function formatPreviewDate(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number)
  return new Date(y, mo - 1, d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

// A whole schedule at once — a date line followed by one shift per line
// ("Texas 12a-4a") until the next date line — instead of clicking through
// the New Task form once per shift. All tasks in one paste get the same
// `who`; there's no per-line assignee since a pasted schedule like this
// is normally all one person's shifts. See lib/bulkTasks.js for the
// actual parsing rules and why a line can usually be pasted close to
// verbatim out of a schedule tool's own display.
export default function BulkAddTasksForm({ me, defaultWho, onClose, onCreated }) {
  const [text, setText] = useState('')
  const [who, setWho] = useState(defaultWho || 'yours')
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const { tasks, errors } = useMemo(() => parseBulkSchedule(text), [text])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!tasks.length || saving) return
    setSaving(true)
    setSubmitError('')
    try {
      const zone = detectDefaultTimezone()
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
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="yours">{WHO_LABEL.yours}</option>
            <option value="assistant">{WHO_LABEL.assistant}</option>
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

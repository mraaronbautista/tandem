import { useState } from 'react'
import { WHO_LABEL } from '../lib/whoLabels'
import { TIMEZONE_OPTIONS, DEFAULT_TIMEZONE, zonedTimeToUtcIso } from '../lib/timezone'
import ChecklistEditor from './ChecklistEditor'

export const emptyTaskForm = {
  title: '',
  who: 'yours',
  priority: 'med',
  due_date: '',
  due_time: '09:00',
  due_timezone: DEFAULT_TIMEZONE,
  source: 'none',
  source_note: '',
  notes: '',
  checklist: [],
  recurrence: 'none',
}

// Half-hour increments across the day, e.g. "09:00" -> "9:00 AM".
export const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2)
  const m = i % 2 === 0 ? '00' : '30'
  const value = `${String(h).padStart(2, '0')}:${m}`
  const label = new Date(2000, 0, 1, h, Number(m)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return { value, label }
})

export default function TaskForm({ initialValues, submitLabel, onSubmit, onCancel, autoFocus = true }) {
  // source_note/notes are nullable in the database — coalesce to '' so
  // editing a task that never had them doesn't hand a controlled input a
  // null value.
  const [form, setForm] = useState({
    ...emptyTaskForm,
    ...initialValues,
    source_note: initialValues?.source_note ?? '',
    notes: initialValues?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) return
    setSaving(true)
    try {
      const { due_time, ...rest } = form
      await onSubmit({
        ...rest,
        due_date: form.due_date ? zonedTimeToUtcIso(form.due_date, due_time, form.due_timezone) : null,
        source_note: form.source_note || null,
        notes: form.notes || null,
        checklist: form.checklist.filter((item) => item.text.trim()),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="new-task-form" onSubmit={handleSubmit}>
      <input
        autoFocus={autoFocus}
        required
        placeholder="What needs to happen?"
        value={form.title}
        onChange={(e) => set('title', e.target.value)}
      />

      <div className="new-task-row">
        <label>
          Who
          <select value={form.who} onChange={(e) => set('who', e.target.value)}>
            <option value="yours">{WHO_LABEL.yours}</option>
            <option value="assistant">{WHO_LABEL.assistant}</option>
          </select>
        </label>

        <label>
          Priority
          <select value={form.priority} onChange={(e) => set('priority', e.target.value)}>
            <option value="low">Low</option>
            <option value="med">Med</option>
            <option value="high">High</option>
          </select>
        </label>

        <label>
          Date
          <input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
        </label>

        <label>
          Time
          <select value={form.due_time} onChange={(e) => set('due_time', e.target.value)}>
            {TIME_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Time zone
          <select value={form.due_timezone} onChange={(e) => set('due_timezone', e.target.value)}>
            {TIMEZONE_OPTIONS.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Repeats
          <select value={form.recurrence} onChange={(e) => set('recurrence', e.target.value)}>
            <option value="none">Never</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
      </div>

      <div className="new-task-row">
        <label>
          Is there an attachment?
          <select value={form.source} onChange={(e) => set('source', e.target.value)}>
            <option value="none">No</option>
            <option value="teams">Sent via Teams</option>
            <option value="email">Sent via Email</option>
          </select>
        </label>

        {form.source !== 'none' && (
          <input
            className="new-task-source-note"
            placeholder="File name / context (optional)"
            value={form.source_note}
            onChange={(e) => set('source_note', e.target.value)}
          />
        )}
      </div>

      <textarea
        placeholder="Optional details…"
        value={form.notes}
        onChange={(e) => set('notes', e.target.value)}
      />

      <ChecklistEditor items={form.checklist} onChange={(checklist) => set('checklist', checklist)} />

      <div className="new-task-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}

import { useState } from 'react'
import { WHO_LABEL } from '../lib/whoLabels'
import { TIMEZONE_OPTIONS, DEFAULT_TIMEZONE, zonedTimeToUtcIso } from '../lib/timezone'
import { formatDuration } from '../lib/tasks'
import ChecklistEditor from './ChecklistEditor'
import ScrollSelect from './ScrollSelect'

export const emptyTaskForm = {
  title: '',
  who: 'yours',
  priority: 'med',
  due_date: '',
  due_time: '09:00',
  due_timezone: DEFAULT_TIMEZONE,
  duration_minutes: '',
  source: 'none',
  source_note: '',
  notes: '',
  checklist: [],
  recurrence: 'none',
}

// Quick-pick spans for "how long will this take" — covers the common
// cases without needing a free-form time input. Empty string means no
// span: the task is just a point-in-time/deadline, same as before this
// field existed.
export const DURATION_OPTIONS = [
  { value: '', label: 'None' },
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '45', label: '45 min' },
  { value: '60', label: '1 hr' },
  { value: '90', label: '1.5 hr' },
  { value: '120', label: '2 hr' },
  { value: '180', label: '3 hr' },
  { value: '240', label: '4 hr' },
  { value: '300', label: '5 hr' },
  { value: '360', label: '6 hr' },
  { value: '480', label: '8 hr' },
  { value: '600', label: '10 hr' },
  { value: '720', label: '12 hr' },
]

// Half-hour increments across the day, e.g. "09:00" -> "9:00 AM".
export const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2)
  const m = i % 2 === 0 ? '00' : '30'
  const value = `${String(h).padStart(2, '0')}:${m}`
  const label = new Date(2000, 0, 1, h, Number(m)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return { value, label }
})

// "YYYY-MM-DD" for today in the browser's own local timezone — matches
// what the native date input expects and what's stored in due_date.
function todayDateString() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function minutesToTimeLabel(mins) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// End-time picker for a given start: 15-minute steps for the first 2
// hours (fine control for short tasks), then 30-minute steps out to a
// 48-hour cap — long enough for a task that spans into the day after
// next. Rendered through ScrollSelect rather than a native <select>, so a
// long list here is fine: it shows a handful of rows at a time and
// scrolls, rather than dumping everything into an unstylable native
// popover. Every Duration preset still lands on an exact tick, so the two
// stay interchangeable. Spans crossing midnight are labeled "(+1 day)" /
// "(+2 days)".
function buildEndTimeOptions(startTime) {
  const startMinutes = timeToMinutes(startTime)
  const offsets = []
  for (let offset = 15; offset <= 120; offset += 15) offsets.push(offset)
  for (let offset = 150; offset <= 48 * 60; offset += 30) offsets.push(offset)

  const options = [{ value: '', label: 'None' }]
  for (const offset of offsets) {
    const total = startMinutes + offset
    const daysAhead = Math.floor(total / (24 * 60))
    const dayLabel = daysAhead > 0 ? ` (+${daysAhead} day${daysAhead > 1 ? 's' : ''})` : ''
    options.push({ value: String(offset), label: `${minutesToTimeLabel(total % (24 * 60))}${dayLabel}` })
  }
  return options
}

export default function TaskForm({ initialValues, submitLabel, onSubmit, onCancel, autoFocus = true }) {
  // source_note/notes are nullable in the database — coalesce to '' so
  // editing a task that never had them doesn't hand a controlled input a
  // null value.
  const [form, setForm] = useState({
    ...emptyTaskForm,
    ...initialValues,
    due_date: initialValues?.due_date || todayDateString(),
    source_note: initialValues?.source_note ?? '',
    notes: initialValues?.notes ?? '',
    duration_minutes: initialValues?.duration_minutes != null ? String(initialValues.duration_minutes) : '',
  })
  const [saving, setSaving] = useState(false)

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  // Both selects below just read/write the same form.duration_minutes —
  // "End time" expresses it as a clock time, "Duration" as a span, but
  // they're two views on one value, so picking either one updates both.
  const endTimeOptions = buildEndTimeOptions(form.due_time)
  const durationOptions = DURATION_OPTIONS.some((d) => d.value === form.duration_minutes)
    ? DURATION_OPTIONS
    : [...DURATION_OPTIONS, { value: form.duration_minutes, label: formatDuration(Number(form.duration_minutes)) }]

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) return
    setSaving(true)
    try {
      const { due_time, ...rest } = form
      await onSubmit({
        ...rest,
        due_date: form.due_date ? zonedTimeToUtcIso(form.due_date, due_time, form.due_timezone) : null,
        duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : null,
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
          End time
          <ScrollSelect
            value={form.duration_minutes}
            onChange={(v) => set('duration_minutes', v)}
            options={endTimeOptions}
          />
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
          Duration
          <select value={form.duration_minutes} onChange={(e) => set('duration_minutes', e.target.value)}>
            {durationOptions.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
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

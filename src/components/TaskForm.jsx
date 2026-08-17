import { useId, useState } from 'react'
import { WHO_LABEL } from '../lib/whoLabels'
import { TIMEZONE_OPTIONS, detectDefaultTimezone, zonedTimeToUtcIso } from '../lib/timezone'
import { formatDuration } from '../lib/tasks'
import ChecklistEditor from './ChecklistEditor'
import ScrollSelect from './ScrollSelect'

// due_date/due_time/due_timezone aren't set here — a brand-new task
// defaults to roughly "now", in whoever's creating it own zone (see
// defaultDueDateTime/detectDefaultTimezone below), computed fresh each
// time the form actually opens rather than a fixed value baked into this
// module-level object at import time (detectDefaultTimezone can change
// mid-session, e.g. right after loading the signed-in member's saved
// preference).
export const emptyTaskForm = {
  title: '',
  who: 'yours',
  priority: 'med',
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
  { value: '1440', label: '1 day' },
  { value: '2880', label: '2 days' },
  { value: '4320', label: '3 days' },
  { value: '10080', label: '1 week' },
]

// Half-hour increments across the day, e.g. "09:00" -> "9:00 AM".
export const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2)
  const m = i % 2 === 0 ? '00' : '30'
  const value = `${String(h).padStart(2, '0')}:${m}`
  const label = new Date(2000, 0, 1, h, Number(m)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return { value, label }
})

// A brand-new task's default due date/time — "now," rounded up to the
// next half-hour mark (matching TIME_OPTIONS' own granularity), rather
// than an arbitrary fixed hour (previously always 9 AM regardless of
// when the task was actually created). Rounds up, never down: a default
// already in the past would make a just-created task read as immediately
// overdue. Computed together, not as two independent defaults, so
// rounding up past midnight correctly rolls the date forward too.
function defaultDueDateTime() {
  const d = new Date()
  const remainder = d.getMinutes() % 30
  if (remainder !== 0 || d.getSeconds() > 0 || d.getMilliseconds() > 0) {
    d.setMinutes(d.getMinutes() + (30 - remainder))
  }
  d.setSeconds(0, 0)
  const pad = (n) => String(n).padStart(2, '0')
  return {
    due_date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    due_time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

// Local-calendar-day arithmetic on plain "YYYY-MM-DD" strings — the All
// Day end-date field needs to add/diff whole days without any of the
// timezone-conversion machinery zonedTimeToUtcIso/splitDueDateInZone
// exist for, since an All Day date is already timezone-agnostic (it's
// just "which calendar day," not an instant). new Date(y, m-1, d) (not
// new Date(dateStr), which parses as UTC midnight and can land on the
// wrong local day depending on the viewer's own offset) keeps this
// unambiguous.
function addDaysToDateStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function daysBetweenDateStrs(startStr, endStr) {
  const [y1, m1, d1] = startStr.split('-').map(Number)
  const [y2, m2, d2] = endStr.split('-').map(Number)
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / (24 * 60 * 60 * 1000))
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
// hours (fine control for short tasks), 30-minute steps out to 2 days
// (still fine enough to matter for same-week tasks), then hourly out to
// a 1-week cap — long enough for a genuinely multi-day task (e.g. a
// multi-day processing/turnaround time) without the list growing
// unreasonably long at 30-minute granularity the whole way out.
// Rendered through ScrollSelect rather than a native <select>, so a long
// list here is fine: it shows a handful of rows at a time and scrolls,
// rather than dumping everything into an unstylable native popover.
// Every Duration preset still lands on an exact tick, so the two stay
// interchangeable. Spans crossing midnight are labeled "(+1 day)" /
// "(+2 days)".
function buildEndTimeOptions(startTime) {
  const startMinutes = timeToMinutes(startTime)
  const offsets = []
  for (let offset = 15; offset <= 120; offset += 15) offsets.push(offset)
  for (let offset = 150; offset <= 48 * 60; offset += 30) offsets.push(offset)
  for (let offset = 48 * 60 + 60; offset <= 7 * 24 * 60; offset += 60) offsets.push(offset)

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
  // Multiple TaskForm instances can be mounted at once (each TaskRow
  // owns its own `editing` state independently), so the title/notes
  // label ids below need to be unique per instance, not a fixed string.
  const titleFieldId = useId()
  const notesFieldId = useId()
  // source_note/notes are nullable in the database — coalesce to '' so
  // editing a task that never had them doesn't hand a controlled input a
  // null value. Lazy initializer (not a plain object) so "now" is read
  // once, when the form actually mounts, rather than recomputed and
  // discarded on every render.
  const [form, setForm] = useState(() => {
    const defaultDateTime = defaultDueDateTime()
    return {
      ...emptyTaskForm,
      due_timezone: detectDefaultTimezone(),
      ...initialValues,
      due_date: initialValues?.due_date || defaultDateTime.due_date,
      due_time: initialValues?.due_time || defaultDateTime.due_time,
      source_note: initialValues?.source_note ?? '',
      notes: initialValues?.notes ?? '',
      duration_minutes: initialValues?.duration_minutes != null ? String(initialValues.duration_minutes) : '',
    }
  })
  const [saving, setSaving] = useState(false)
  // Distinct from "the date field happens to be blank" — that ambiguity
  // used to mean saving an All Day task unchanged silently gave it
  // today's date the moment it was edited (splitDueDateInZone(null, tz)
  // returns due_date: '', which then defaulted to today above). Whether a
  // due_date key was present in initialValues at all is what tells apart
  // "editing an existing All Day task" from "a brand-new task." A
  // due_date that IS present but lands on midnight with no duration is
  // still All Day — a specific-date one (see isAllDayTask in lib/tasks.js
  // for why that combination, not a due_date key, is what's checked).
  const hasDueDateKey = initialValues && Object.prototype.hasOwnProperty.call(initialValues, 'due_date')
  // A whole-day-multiple duration (1440, 2880, ...) still counts as All
  // Day — see isAllDayTask in lib/tasks.js for why that's the check
  // (not, say, a separate flag): it's what lets a multi-day All Day task
  // re-open as All Day rather than as a plain timed task when edited.
  const initialAllDayDate =
    hasDueDateKey &&
    initialValues.due_date &&
    initialValues.due_time === '00:00' &&
    (!initialValues.duration_minutes || initialValues.duration_minutes % 1440 === 0)
      ? initialValues.due_date
      : ''
  const [allDay, setAllDay] = useState(() => Boolean(hasDueDateKey && (!initialValues.due_date || initialAllDayDate)))
  // Tracked separately from form.due_date (which defaults to today's date
  // for every new task, All Day or not — see below) rather than reusing
  // it, so checking "All day" defaults to genuinely no date, not silently
  // today, unless a date is deliberately typed in here.
  const [allDayDate, setAllDayDate] = useState(initialAllDayDate)
  // Only meaningful once allDayDate is set — a multi-day span needs a
  // start to span from. Reconstructed from the initial duration (a whole
  // number of days) when editing an existing multi-day All Day task.
  const [allDayEndDate, setAllDayEndDate] = useState(() =>
    initialAllDayDate && initialValues?.duration_minutes
      ? addDaysToDateStr(initialAllDayDate, initialValues.duration_minutes / 1440)
      : '',
  )

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
        due_date: allDay
          ? allDayDate
            ? zonedTimeToUtcIso(allDayDate, '00:00', form.due_timezone)
            : null
          : !form.due_date
            ? null
            : zonedTimeToUtcIso(form.due_date, due_time, form.due_timezone),
        duration_minutes: allDay
          ? allDayDate && allDayEndDate && allDayEndDate > allDayDate
            ? daysBetweenDateStrs(allDayDate, allDayEndDate) * 1440
            : null
          : !form.duration_minutes
            ? null
            : Number(form.duration_minutes),
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
      <label className="visually-hidden" htmlFor={titleFieldId}>
        Title
      </label>
      <input
        id={titleFieldId}
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

        <label className="new-task-checkbox-label">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          All day
        </label>

        {allDay ? (
          <>
            <label>
              Date (optional)
              <input
                type="date"
                value={allDayDate}
                onChange={(e) => {
                  setAllDayDate(e.target.value)
                  // A cleared or moved-earlier start date can otherwise
                  // leave a stale end date sitting before it.
                  if (e.target.value && allDayEndDate && allDayEndDate < e.target.value) setAllDayEndDate('')
                  if (!e.target.value) setAllDayEndDate('')
                }}
              />
            </label>
            {allDayDate && (
              <label>
                End date (optional — spans multiple days)
                <input
                  type="date"
                  min={allDayDate}
                  value={allDayEndDate}
                  onChange={(e) => setAllDayEndDate(e.target.value)}
                />
              </label>
            )}
          </>
        ) : (
          <>
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
          </>
        )}

        <label>
          Repeats
          <select value={form.recurrence} onChange={(e) => set('recurrence', e.target.value)}>
            <option value="none">Never</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="every_3_weeks">Every 3 weeks</option>
            <option value="monthly">Monthly</option>
            <option value="every_2_months">Every 2 months</option>
            <option value="quarterly">Quarterly</option>
            <option value="every_6_months">Every 6 months</option>
            <option value="annually">Annually</option>
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

      <label className="visually-hidden" htmlFor={notesFieldId}>
        Notes
      </label>
      <textarea
        id={notesFieldId}
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

import { useMemo, useState } from 'react'
import { parseBulkSchedule } from '../lib/bulkTasks'
import { createTask, updateTask, isAllDayTask } from '../lib/tasks'
import {
  TIMEZONE_OPTIONS,
  zonedTimeToUtcIso,
  splitDueDateInZone,
  zoneAbbreviation,
  zoneLabel,
} from '../lib/timezone'
import { WHO_LABEL, WHO_COLOR, whoKeyForName } from '../lib/whoLabels'
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

// parseShiftLine's own midnight-wraparound (endMin += 24*60 when the end
// clock-time is <= the start) caps a single shift under 24h, so this
// never needs more than "(+1 day)" — same reasoning as TaskForm.jsx's
// end-time picker labeling a span that crosses midnight, just bounded
// here by the line format itself rather than a picker's own range.
function formatPreviewTime(dueTime, durationMinutes) {
  const [h, m] = dueTime.split(':').map(Number)
  const start = new Date(2000, 0, 1, h, m)
  const end = new Date(start.getTime() + durationMinutes * 60000)
  const fmt = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const crossesDay = end.getDate() !== start.getDate()
  return `${fmt(start)} – ${fmt(end)}${crossesDay ? ' (+1 day)' : ''}`
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

// Viewer-local time, same reasoning as TaskRow.jsx's own list display —
// this is just a quick reference for picking tasks out of a list, not an
// authoritative zone-aware label.
function formatTaskDue(task) {
  if (!task.due_date) return 'No date'
  if (isAllDayTask(task)) return new Date(task.due_date).toLocaleDateString([], { month: 'short', day: 'numeric' })
  const d = new Date(task.due_date)
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

// A whole schedule at once — a date line followed by one shift per line
// ("Texas 12a-4a") until the next date line — instead of clicking through
// the New Task form once per shift. All tasks in one paste get the same
// `who`; there's no per-line assignee since a pasted schedule like this
// is normally all one person's shifts. See lib/bulkTasks.js for the
// actual parsing rules and why a line can usually be pasted close to
// verbatim out of a schedule tool's own display.
//
// A second tab, Edit, handles the opposite direction: picking a batch of
// already-existing tasks and changing one field across all of them at
// once (e.g. every task from a mis-set timezone). Sharing this modal
// with Add rather than a separate one since they're both "bulk task
// operations" opened from the same quick action.
export default function BulkAddTasksForm({ me, members, tasks, defaultWho, onClose, onCreated }) {
  const [view, setView] = useState('add')

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

  const { tasks: parsedTasks, errors } = useMemo(() => parseBulkSchedule(text), [text])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!parsedTasks.length || saving) return
    setSaving(true)
    setSubmitError('')
    try {
      await Promise.all(
        parsedTasks.map((t) =>
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

  // Every not-yet-done task — both already-overdue and anything upcoming
  // — sorted soonest first, dateless (All Day, no date) ones trailing at
  // the end rather than sorting as "earliest" the way a missing due_date
  // would if compared naively.
  const editableTasks = useMemo(
    () =>
      [...tasks]
        .filter((t) => t.status !== 'done')
        .sort((a, b) => {
          if (!a.due_date && !b.due_date) return 0
          if (!a.due_date) return 1
          if (!b.due_date) return -1
          return new Date(a.due_date) - new Date(b.due_date)
        }),
    [tasks],
  )
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const allSelected = editableTasks.length > 0 && selectedIds.size === editableTasks.length

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(editableTasks.map((t) => t.id)))
  }

  // Each field a bulk edit can touch gets its own "apply this" toggle,
  // independent of the field's own value — otherwise there'd be no way
  // to tell "leave Notes alone" apart from "clear every selected task's
  // notes", since both look identical (an empty textarea) without an
  // explicit flag.
  const [applyTitle, setApplyTitle] = useState(false)
  const [titleMode, setTitleMode] = useState('append')
  const [titleText, setTitleText] = useState('')
  const [applyWho, setApplyWho] = useState(false)
  const [editWho, setEditWho] = useState('yours')
  const [applyTimezone, setApplyTimezone] = useState(false)
  const [editTimezone, setEditTimezone] = useState(() => zoneForWho(defaultWho || 'yours'))
  const [applyNotes, setApplyNotes] = useState(false)
  const [editNotes, setEditNotes] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState('')
  // Unlike Notes, an empty Title text isn't a meaningful "apply" — there's
  // no such thing as clearing a task's title (it's required everywhere
  // else in the app), so Title only counts toward "there's something to
  // apply" once actual text is typed, even if its checkbox is on.
  const hasFieldToApply = applyWho || applyTimezone || applyNotes || (applyTitle && titleText.trim())

  async function handleApply(e) {
    e.preventDefault()
    if (!selectedIds.size || !hasFieldToApply || applying) return
    setApplying(true)
    setApplyError('')
    try {
      const word = titleText.trim()
      await Promise.all(
        Array.from(selectedIds).map((id) => {
          const task = editableTasks.find((t) => t.id === id)
          const patch = {}
          if (applyTitle && word) {
            patch.title =
              titleMode === 'replace' ? word : titleMode === 'prepend' ? `${word} ${task.title}` : `${task.title} ${word}`
          }
          if (applyWho) patch.who = editWho
          if (applyNotes) patch.notes = editNotes.trim() || null
          // Keeps the wall-clock date/time exactly as originally entered
          // and reinterprets it in the new zone — the fix for "this whole
          // batch was set in the wrong timezone" — rather than shifting
          // to a different clock time that happens to be the same UTC
          // instant, which is almost never what's actually wanted.
          // Dateless (All Day, no date) tasks have no wall-clock time to
          // reinterpret, so they're left untouched even when selected.
          if (applyTimezone && task?.due_date) {
            const { due_date, due_time } = splitDueDateInZone(task.due_date, task.due_timezone)
            patch.due_date = zonedTimeToUtcIso(due_date, due_time, editTimezone)
            patch.due_timezone = editTimezone
          }
          return updateTask(id, patch)
        }),
      )
      onCreated()
    } catch (err) {
      setApplyError(err.message)
    } finally {
      setApplying(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <form
        className="submission-modal bulk-add-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={view === 'add' ? handleSubmit : handleApply}
      >
        <h2>Bulk {view === 'add' ? 'add' : 'edit'} tasks</h2>

        <div className="period-tabs">
          <button
            type="button"
            className={`period-tab${view === 'add' ? ' period-tab-active' : ''}`}
            onClick={() => setView('add')}
          >
            Add
          </button>
          <button
            type="button"
            className={`period-tab${view === 'edit' ? ' period-tab-active' : ''}`}
            onClick={() => setView('edit')}
          >
            Edit
          </button>
        </div>

        {view === 'add' ? (
          <>
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
                {parsedTasks.length > 0 && (
                  <>
                    <span className="submission-field-label">
                      {parsedTasks.length} task{parsedTasks.length === 1 ? '' : 's'} ready
                    </span>
                    <ul className="bulk-add-preview-list">
                      {parsedTasks.map((t, i) => (
                        <li key={i}>
                          <span className="bulk-add-preview-date">{formatPreviewDate(t.due_date)}</span>
                          <span className="bulk-add-preview-title">{t.title}</span>
                          <span className="bulk-add-preview-time">
                            {formatPreviewTime(t.due_time, t.duration_minutes)}
                          </span>
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
          </>
        ) : (
          <>
            {editableTasks.length === 0 ? (
              <p className="task-notes-empty">No active tasks to edit.</p>
            ) : (
              <>
                <div className="bulk-edit-select-row">
                  <span className="submission-field-label">
                    {selectedIds.size} of {editableTasks.length} selected
                  </span>
                  <button type="button" className="inbox-mark-read" onClick={toggleSelectAll}>
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </button>
                </div>

                <ul className="bulk-edit-task-list">
                  {editableTasks.map((task) => {
                    const whoKey = task.who
                    const selected = selectedIds.has(task.id)
                    return (
                      <li key={task.id}>
                        <label className={`bulk-edit-task-row${selected ? ' bulk-edit-task-row-selected' : ''}`}>
                          <input type="checkbox" checked={selected} onChange={() => toggleSelected(task.id)} />
                          <span className="bulk-edit-task-info">
                            <span className="bulk-edit-task-title">{task.title}</span>
                            <span className="bulk-edit-task-meta">
                              <span className="task-who-badge" style={{ background: WHO_COLOR[whoKey] }}>
                                {WHO_LABEL[whoKey]}
                              </span>
                              <span>{formatTaskDue(task)}</span>
                              {task.due_date && !isAllDayTask(task) && (
                                <span
                                  className="task-zone-badge"
                                  title={`Set in ${zoneLabel(task.due_timezone)}`}
                                >
                                  {zoneAbbreviation(task.due_timezone)}
                                </span>
                              )}
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>

                <div className="bulk-edit-fields">
                  <div className="bulk-edit-field-row bulk-edit-field-row-title">
                    <input type="checkbox" checked={applyTitle} onChange={(e) => setApplyTitle(e.target.checked)} />
                    <span className="bulk-edit-field-label">Title</span>
                    <div className="bulk-edit-title-controls">
                      <select value={titleMode} onChange={(e) => setTitleMode(e.target.value)} disabled={!applyTitle}>
                        <option value="append">Add after</option>
                        <option value="prepend">Add before</option>
                        <option value="replace">Replace with</option>
                      </select>
                      <input
                        type="text"
                        placeholder={titleMode === 'replace' ? 'New title' : 'Word or phrase to add'}
                        value={titleText}
                        onChange={(e) => setTitleText(e.target.value)}
                        disabled={!applyTitle}
                      />
                    </div>
                  </div>
                  {applyTitle && titleMode === 'replace' && (
                    <p className="bulk-add-hint">
                      Every selected task gets this exact title — usually only useful for a batch of otherwise
                      identical placeholder tasks. "Add before"/"Add after" keep each task's own title and just
                      tack this onto it instead.
                    </p>
                  )}

                  <div className="bulk-edit-fields-row">
                    <label className="bulk-edit-field-row">
                      <input type="checkbox" checked={applyWho} onChange={(e) => setApplyWho(e.target.checked)} />
                      <span className="bulk-edit-field-label">Who</span>
                      <select value={editWho} onChange={(e) => setEditWho(e.target.value)} disabled={!applyWho}>
                        <option value="yours">{WHO_LABEL.yours}</option>
                        <option value="assistant">{WHO_LABEL.assistant}</option>
                      </select>
                    </label>

                    <label className="bulk-edit-field-row">
                      <input
                        type="checkbox"
                        checked={applyTimezone}
                        onChange={(e) => setApplyTimezone(e.target.checked)}
                      />
                      <span className="bulk-edit-field-label">Time zone</span>
                      <select
                        value={editTimezone}
                        onChange={(e) => setEditTimezone(e.target.value)}
                        disabled={!applyTimezone}
                      >
                        {TIMEZONE_OPTIONS.map((tz) => (
                          <option key={tz.value} value={tz.value}>
                            {tz.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {applyTimezone && (
                    <p className="bulk-add-hint">
                      Keeps each task's date/time exactly as set, reinterpreted in the new zone — a task due "9:00
                      AM" stays "9:00 AM", just in a different zone. Dateless All Day tasks are left untouched.
                    </p>
                  )}

                  <label className="bulk-edit-field-row bulk-edit-field-row-notes">
                    <input type="checkbox" checked={applyNotes} onChange={(e) => setApplyNotes(e.target.checked)} />
                    <span className="bulk-edit-field-label">Notes</span>
                    <textarea
                      rows={3}
                      placeholder="Leave blank to clear notes on the selected tasks"
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      disabled={!applyNotes}
                    />
                  </label>
                </div>

                {applyError && <p className="error">{applyError}</p>}
              </>
            )}
          </>
        )}

        <div className="submission-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          {view === 'add' ? (
            <button type="submit" className="submission-save" disabled={saving || parsedTasks.length === 0}>
              {saving
                ? 'Creating…'
                : parsedTasks.length
                  ? `Create ${parsedTasks.length} task${parsedTasks.length === 1 ? '' : 's'}`
                  : 'Create tasks'}
            </button>
          ) : (
            <button
              type="submit"
              className="submission-save"
              disabled={applying || !selectedIds.size || !hasFieldToApply}
            >
              {applying ? 'Applying…' : `Apply to ${selectedIds.size} task${selectedIds.size === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </form>
    </Modal>
  )
}

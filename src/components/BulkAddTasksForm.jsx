import { useMemo, useState } from 'react'
import { parseBulkTasks } from '../lib/bulkTasks'
import { createTask, updateTask, deleteTask, isAllDayTask } from '../lib/tasks'
import {
  TIMEZONE_OPTIONS,
  zonedTimeToUtcIso,
  splitDueDateInZone,
  zoneAbbreviation,
  zoneLabel,
  DEFAULT_TIMEZONE,
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

Aug 30 – Abdul vacates Master Haven (schedule cleaning)
Today – Contact Ingrid about the turnover
If Ingrid unavailable – Follow-up with Martin (backup)`

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

// "No date" for an undated type: 'item' task (an unresolvable relative
// phrase like "End of this week", or a plain dependency note with no
// date shape at all) — same reasoning as formatTaskDue below, just for a
// task that was never assigned a real due_date in the first place rather
// than one that has one.
function formatPreviewDateOrNone(dateStr) {
  return dateStr ? formatPreviewDate(dateStr) : 'No date'
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

// Formatted in the task's own due_timezone, not the viewer's — this
// sits right next to the zone badge (task-zone-badge, below), so a
// silently-converted viewer-local time here would contradict what that
// badge says (same fix, and same reasoning, as DayTimeline.jsx's
// blockTimeLabel — a task set for 10 PM Eastern showing as "10:00 AM"
// next to an "ET" badge for a viewer 12 hours away). All Day tasks have
// no due_timezone-specific time to show, so they stay a plain date.
function formatTaskDue(task) {
  if (!task.due_date) return 'No date'
  if (isAllDayTask(task)) return new Date(task.due_date).toLocaleDateString([], { month: 'short', day: 'numeric' })
  const tz = task.due_timezone || DEFAULT_TIMEZONE
  const d = new Date(task.due_date)
  const date = d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
  return `${date}, ${time}`
}

// A whole schedule at once — a date line followed by one shift per line
// ("Texas 12a-4a") until the next date line, freely mixed with plain
// "<date or note> – description" items that carry their own inline date
// — instead of clicking through the New Task form once per line. Used
// to be two separate parsers behind a manual format toggle; merged (see
// lib/bulkTasks.js's parseBulkTasks) once that toggle turned out to just
// be a way to fail confusingly by pasting into the wrong one. All tasks
// in one paste get the same `who`; there's no per-line assignee since a
// pasted batch like this is normally all one person's.
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

  const { tasks: parsedTasks, errors } = useMemo(() => parseBulkTasks(text), [text])

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
            // 'shift' has a real time; 'item' is always All Day — either
            // pinned to a specific date (due_time 00:00, no duration) or
            // fully dateless (due_date null) when no date was recognized.
            due_date:
              t.type === 'shift'
                ? zonedTimeToUtcIso(t.due_date, t.due_time, zone)
                : t.due_date
                  ? zonedTimeToUtcIso(t.due_date, '00:00', zone)
                  : null,
            due_timezone: zone,
            duration_minutes: t.type === 'shift' ? t.duration_minutes : null,
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

  // A picker list mixing both people's tasks gets long fast once there's
  // any real volume — this narrows it to "just Ada's" / "just Aaron's"
  // before picking rows to edit, same idea as the Today tab's who-select.
  // Selection isn't cleared on switch: filtering only changes what's
  // visible, and a task selected under one filter should stay selected
  // (and still count toward "N selected") if you flip back to All.
  const [editWhoFilter, setEditWhoFilter] = useState('all')
  const visibleEditableTasks = useMemo(
    () => (editWhoFilter === 'all' ? editableTasks : editableTasks.filter((t) => t.who === editWhoFilter)),
    [editableTasks, editWhoFilter],
  )
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const allSelected =
    visibleEditableTasks.length > 0 && visibleEditableTasks.every((t) => selectedIds.has(t.id))

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Select all/none only among the currently-filtered rows — toggling
  // Select all under the Ada tab shouldn't silently also select every
  // one of Aaron's tasks sitting out of view.
  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (allSelected) {
        const next = new Set(prev)
        visibleEditableTasks.forEach((t) => next.delete(t.id))
        return next
      }
      const next = new Set(prev)
      visibleEditableTasks.forEach((t) => next.add(t.id))
      return next
    })
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

  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // A plain button, not a form submit — sharing this modal's one <form>
  // between Apply and Delete means a submit-triggered delete would run
  // whatever apply-field checkboxes happen to be checked too, so this
  // stays a separate type="button" handler like every other destructive
  // action in the app (see window.confirm usages elsewhere).
  async function handleDelete() {
    if (!selectedIds.size || applying || deleting) return
    const count = selectedIds.size
    if (!window.confirm(`Delete ${count} task${count === 1 ? '' : 's'}? This can't be undone.`)) return
    setDeleting(true)
    setDeleteError('')
    try {
      await Promise.all(Array.from(selectedIds).map((id) => deleteTask(id)))
      setSelectedIds(new Set())
      onCreated()
    } catch (err) {
      setDeleteError(err.message)
    } finally {
      setDeleting(false)
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
              Either a date on its own line followed by one shift per line below it ("Title start-end", e.g. "Texas
              12a-4a"), or a "&lt;date or note&gt; – description" line with no time of day (e.g. "Aug 30 – Renew the
              lease") — mix both freely. Category headers with no dash are skipped automatically; a line whose date
              isn't recognized (e.g. "End of this week") is kept whole as the title with no due date, rather than
              guessed at.
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
              Tasks
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
                          <span className="bulk-add-preview-date">
                            {t.type === 'shift' ? formatPreviewDate(t.due_date) : formatPreviewDateOrNone(t.due_date)}
                          </span>
                          <span className="bulk-add-preview-title">{t.title}</span>
                          {t.type === 'shift' && (
                            <span className="bulk-add-preview-time">
                              {formatPreviewTime(t.due_time, t.duration_minutes)}
                            </span>
                          )}
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
                <div className="period-tabs">
                  <button
                    type="button"
                    className={`period-tab${editWhoFilter === 'yours' ? ' period-tab-active' : ''}`}
                    onClick={() => setEditWhoFilter('yours')}
                  >
                    {WHO_LABEL.yours}
                  </button>
                  <button
                    type="button"
                    className={`period-tab${editWhoFilter === 'assistant' ? ' period-tab-active' : ''}`}
                    onClick={() => setEditWhoFilter('assistant')}
                  >
                    {WHO_LABEL.assistant}
                  </button>
                  <button
                    type="button"
                    className={`period-tab${editWhoFilter === 'all' ? ' period-tab-active' : ''}`}
                    onClick={() => setEditWhoFilter('all')}
                  >
                    All
                  </button>
                </div>

                <div className="bulk-edit-select-row">
                  <span className="submission-field-label">
                    {selectedIds.size} of {editableTasks.length} selected
                  </span>
                  <button
                    type="button"
                    className="inbox-mark-read"
                    onClick={toggleSelectAll}
                    disabled={visibleEditableTasks.length === 0}
                  >
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </button>
                </div>

                {visibleEditableTasks.length === 0 ? (
                  <p className="task-notes-empty">No active tasks for this filter.</p>
                ) : (
                <ul className="bulk-edit-task-list">
                  {visibleEditableTasks.map((task) => {
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
                )}

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
                {deleteError && <p className="error">{deleteError}</p>}
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
            <>
              <button
                type="button"
                className="submission-delete"
                onClick={handleDelete}
                disabled={deleting || applying || !selectedIds.size}
              >
                {deleting ? 'Deleting…' : `Delete ${selectedIds.size} task${selectedIds.size === 1 ? '' : 's'}`}
              </button>
              <button
                type="submit"
                className="submission-save"
                disabled={applying || deleting || !selectedIds.size || !hasFieldToApply}
              >
                {applying ? 'Applying…' : `Apply to ${selectedIds.size} task${selectedIds.size === 1 ? '' : 's'}`}
              </button>
            </>
          )}
        </div>
      </form>
    </Modal>
  )
}

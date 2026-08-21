import { useState } from 'react'
import { isOverdue, isAllDayTask, formatDuration } from '../lib/tasks'
import { PRIORITY_COLOR, PRIORITY_LABEL } from '../lib/priorityColors'
import { WHO_LABEL, WHO_COLOR, whoKeyForName } from '../lib/whoLabels'
import { splitDueDateInZone, DEFAULT_TIMEZONE, zoneAbbreviation, zoneLabel } from '../lib/timezone'
import { uploadCompletionAttachment, isImageAttachment } from '../lib/attachments'
import { sendTaskNudge } from '../lib/manualNotify'
import { EditIcon, PaperclipIcon, DuplicateIcon, ViewIcon, TrashIcon, CheckIcon, BellIcon } from './icons'
import TaskForm from './TaskForm'
import ChecklistView from './ChecklistView'
import TaskClarifications from './TaskClarifications'
import Modal from './Modal'

const SOURCE_LABEL = { teams: 'Teams', email: 'Email', none: null }
const DATE_TIME_FORMAT = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
const TIME_ONLY_FORMAT = { hour: 'numeric', minute: '2-digit' }

// Shown in the task's own due_timezone, not the viewer's — same fix and
// same reasoning as DayTimeline.jsx's blockTimeLabel/blockDateLabel: a
// silently-converted time sitting right next to the task-zone-badge
// (which names the zone it was actually *set* in) reads as if the shown
// time *is* in that zone. A task set for 10 PM Eastern showing as
// "10:00 AM" next to an "ET" badge, for a viewer 12 hours away, is
// exactly that bug. `timeZone` is optional — completed_at (see the
// "Completed" tag below) has no due_timezone concept of its own, it's
// just when the task was actually finished in the real world, so that
// one call stays in the viewer's own local time.
function localLabel(isoString, timeZone) {
  return timeZone
    ? new Date(isoString).toLocaleString('en-US', { ...DATE_TIME_FORMAT, timeZone })
    : new Date(isoString).toLocaleString([], DATE_TIME_FORMAT)
}

// "Jul 23, 5:30 – 6:10 PM (40 min)" when a duration is set, otherwise just
// the point-in-time label as before. An All Day task pinned to a specific
// date (see isAllDayTask) shows that date with "All day" instead of the
// literal midnight it's actually stored at. A duration long enough to
// land on a different calendar day than the start (now possible up to a
// week — see TaskForm.jsx) shows the end's full date too, not just a
// bare time — "5:30 PM – 9:00 AM" alone would misread as same-day for a
// multi-day span.
function dueLabel(task) {
  const timeZone = task.due_timezone || DEFAULT_TIMEZONE
  if (isAllDayTask(task)) {
    const startLabel = new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone })
    // A multi-day All Day task (see TaskForm.jsx's End date field) still
    // only appears once, on its start day (same as a multi-day *timed*
    // task doesn't repeat across every day it spans either) — the range
    // is what tells the two apart in the label.
    if (!task.duration_minutes) return `${startLabel}, All day`
    const endDate = new Date(new Date(task.due_date).getTime() + task.duration_minutes * 60000)
    const endLabel = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone })
    return `${startLabel} – ${endLabel}, All day`
  }
  const start = localLabel(task.due_date, timeZone)
  if (!task.duration_minutes) return start
  const startDate = new Date(task.due_date)
  const end = new Date(startDate.getTime() + task.duration_minutes * 60000)
  // Compared as calendar dates in due_timezone, not browser-local — a
  // span that crosses midnight in the due zone but not the viewer's (or
  // vice versa) needs to agree with the zone-aware labels above it.
  const spansDays = splitDueDateInZone(task.due_date, timeZone).due_date !== splitDueDateInZone(end.toISOString(), timeZone).due_date
  const endLabel = spansDays
    ? localLabel(end.toISOString(), timeZone)
    : end.toLocaleTimeString('en-US', { ...TIME_ONLY_FORMAT, timeZone })
  return `${start} – ${endLabel} (${formatDuration(task.duration_minutes)})`
}

export default function TaskRow({
  task,
  onStatusChange,
  onUpdate,
  onDelete,
  onDuplicate,
  memberName,
  meId,
  defaultOpen = false,
  overlappingIds,
  hidePriorityDot = false,
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [editing, setEditing] = useState(false)
  const [submitOpen, setSubmitOpen] = useState(false)
  const [viewSubmissionOpen, setViewSubmissionOpen] = useState(false)
  const [noteDraft, setNoteDraft] = useState(task.completion_note || '')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [nudging, setNudging] = useState(false)
  const [nudgeSent, setNudgeSent] = useState(false)
  const attachments = task.completion_attachments || []
  const hasSubmission = Boolean(task.completion_note || attachments.length)
  const overdue = isOverdue(task)
  const overlapping = overlappingIds?.has(task.id) ?? false
  const hasNotes = Boolean(task.notes)
  const sourceLabel = SOURCE_LABEL[task.source]
  const creatorName = memberName(task.created_by)
  // Nudging yourself makes no sense — same "assigning yourself a task
  // doesn't ping you, since you already know" reasoning notify-task-events
  // already uses. myWhoKey is falsy until members have loaded (memberName
  // returns '' until then, and whoKeyForName('') finds no match) — checked
  // explicitly rather than just `!== task.who`, since undefined !== 'yours'
  // is true, which would show this on your own task for a beat on first
  // load instead of staying hidden.
  const myWhoKey = whoKeyForName(memberName(meId))
  const canNudge = overdue && myWhoKey && task.who !== myWhoKey
  const checklist = task.checklist || []
  const checklistDone = checklist.filter((item) => item.done).length
  const clarifications = task.clarifications || []
  // A question directed at whoever's looking right now — an in-app
  // reminder that doesn't depend on the push notification having been
  // seen (or not dismissed). Excludes anything marked resolved (a plain
  // comment someone decided doesn't need a reply) — otherwise those would
  // flag this badge forever, since `answer` never gets set for them.
  const hasQuestionForMe = clarifications.some((c) => !c.answer && !c.resolved && c.askedBy !== meId)

  function handleDelete(e) {
    e.stopPropagation()
    if (window.confirm(`Delete "${task.title}"? This can't be undone.`)) {
      onDelete(task.id)
    }
  }

  function handleDuplicate(e) {
    e.stopPropagation()
    onDuplicate(task)
  }

  // nudgeSent is purely a local "yep, that went through" confirmation —
  // doesn't reflect overdue_nudge_sent_at (never fetched by the
  // frontend, see schema.sql) and resets on the next render of this
  // task from anywhere else, same low-stakes as any other fire-and-
  // forget notification button in this app (Nudge Aaron, Ask a
  // question) not tracking its own delivery state persistently.
  async function handleNudge(e) {
    e.stopPropagation()
    setNudging(true)
    try {
      await sendTaskNudge(task.id, task.title)
      setNudgeSent(true)
    } finally {
      setNudging(false)
    }
  }

  function handleChecklistItemChange(itemId, patch) {
    const updated = checklist.map((item) => (item.id === itemId ? { ...item, ...patch } : item))
    onUpdate(task.id, { checklist: updated })
  }

  async function handleClarificationsChange(updated) {
    await onUpdate(task.id, { clarifications: updated })
  }

  function handleStatusToggle() {
    const next = task.status === 'done' ? 'to_do' : 'done'
    onStatusChange(task.id, next)
    // Marking done surfaces Edit/Delete/Submit right away, instead of
    // making you dig into the row separately.
    if (next === 'done') setOpen(true)
  }

  function handleSaveNote() {
    if (noteDraft !== (task.completion_note || '')) onUpdate(task.id, { completion_note: noteDraft || null })
    setSubmitOpen(false)
  }

  async function handleAttachmentUpload(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true)
    setUploadError('')
    try {
      const uploaded = await Promise.all(
        files.map(async (file) => ({ url: await uploadCompletionAttachment(task.id, file), name: file.name })),
      )
      await onUpdate(task.id, { completion_attachments: [...attachments, ...uploaded] })
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  function handleRemoveAttachment(e, index) {
    e.stopPropagation()
    if (!window.confirm('Remove this attachment?')) return
    onUpdate(task.id, { completion_attachments: attachments.filter((_, i) => i !== index) })
  }

  if (editing) {
    return (
      <div className="task-row task-row-editing" onClick={(e) => e.stopPropagation()}>
        <TaskForm
          autoFocus={false}
          submitLabel="Save changes"
          initialValues={{ ...task, ...splitDueDateInZone(task.due_date, task.due_timezone || DEFAULT_TIMEZONE) }}
          onCancel={() => setEditing(false)}
          onSubmit={async (values) => {
            await onUpdate(task.id, values)
            setEditing(false)
          }}
        />
      </div>
    )
  }

  return (
    <div
      className={`task-row ${task.status === 'done' ? 'task-row-done' : ''} ${overlapping ? 'task-row-overlapping' : ''}`}
      onClick={() => setOpen((v) => !v)}
    >
      <div className="task-row-main">
        <input
          type="checkbox"
          className="task-done-checkbox"
          checked={task.status === 'done'}
          onClick={(e) => e.stopPropagation()}
          onChange={handleStatusToggle}
        />
        {!hidePriorityDot && (
          <span
            className="task-priority-dot"
            style={{ background: PRIORITY_COLOR[task.priority] }}
            title={PRIORITY_LABEL[task.priority]}
          />
        )}
        <span className="task-who-badge" style={{ background: WHO_COLOR[task.who] }}>
          {WHO_LABEL[task.who]}
        </span>
        <span className="task-title">{task.title}</span>
        {overlapping && (
          <span className="task-overlap-badge" title="Overlaps another task's time">
            ⚠ Overlap
          </span>
        )}
        {hasNotes && <span className="task-notes-icon" title="Has notes">📝</span>}
        {checklist.length > 0 && (
          <span className="task-checklist-badge" title="Subtasks">
            ☑ {checklistDone}/{checklist.length}
          </span>
        )}
        {hasQuestionForMe && (
          <span className="task-question-badge" title="Has something for you to reply to">
            💬
          </span>
        )}
        {task.due_date && (
          <span className={`task-due ${overdue ? 'task-due-overdue' : ''}`}>{dueLabel(task)}</span>
        )}
        {/* Names the zone dueLabel above is already showing the time in
            (see localLabel) — the two have to agree, since a badge next
            to a time that's actually in some other zone reads as if the
            badge's zone is what's displayed. All Day tasks skip this: the
            zone only affects which calendar day midnight falls on for
            them, a much lower-stakes mistake than a timed task landing
            hours off, so it's not worth a badge on every all-day item. */}
        {task.due_date && !isAllDayTask(task) && (
          <span className="task-zone-badge" title={`Set in ${zoneLabel(task.due_timezone || DEFAULT_TIMEZONE)}`}>
            {zoneAbbreviation(task.due_timezone || DEFAULT_TIMEZONE)}
          </span>
        )}
        {task.status === 'done' && task.completed_at && (
          <span className="task-completed-at">Completed {localLabel(task.completed_at)}</span>
        )}
      </div>

      {open && (
        <div className="task-row-details" onClick={(e) => e.stopPropagation()}>
          {creatorName && (
            <p className="task-meta">Added by {creatorName}</p>
          )}
          {sourceLabel && (
            <p>
              <strong>Source:</strong> {sourceLabel}
              {task.source_note ? ` — ${task.source_note}` : ''}
            </p>
          )}
          {task.notes && <p className="task-notes-text">{task.notes}</p>}
          <ChecklistView items={checklist} onItemChange={handleChecklistItemChange} />
          {task.recurrence !== 'none' && (
            <p className="task-recurrence">Repeats {task.recurrence}</p>
          )}
          {!sourceLabel && !task.notes && !checklist.length && task.recurrence === 'none' && !creatorName && (
            <p className="task-notes-empty">No additional details.</p>
          )}

          <TaskClarifications
            clarifications={clarifications}
            onChange={handleClarificationsChange}
            meId={meId}
            memberName={memberName}
            taskTitle={task.title}
            taskId={task.id}
            extraActions={
              <div className="task-row-actions">
                <button onClick={() => setEditing(true)} title="Edit" aria-label="Edit">
                  <EditIcon width={15} height={15} />
                </button>
                <button onClick={handleDuplicate} title="Duplicate" aria-label="Duplicate">
                  <DuplicateIcon width={15} height={15} />
                </button>
                {canNudge && (
                  <button
                    onClick={handleNudge}
                    disabled={nudging || nudgeSent}
                    title={nudgeSent ? 'Nudge sent' : 'Nudge — still on your plate?'}
                    aria-label={nudgeSent ? 'Nudge sent' : 'Nudge — still on your plate?'}
                  >
                    <BellIcon width={15} height={15} />
                  </button>
                )}
                {task.status === 'done' && hasSubmission && (
                  <button onClick={() => setViewSubmissionOpen(true)} title="View submission" aria-label="View submission">
                    <ViewIcon width={15} height={15} />
                  </button>
                )}
                {task.status === 'done' && (
                  <button
                    onClick={() => setSubmitOpen(true)}
                    title={hasSubmission ? 'Edit submission' : 'Submit'}
                    aria-label={hasSubmission ? 'Edit submission' : 'Submit'}
                  >
                    {hasSubmission ? <EditIcon width={15} height={15} /> : <CheckIcon width={15} height={15} />}
                  </button>
                )}
                <button className="task-delete" onClick={handleDelete} title="Delete" aria-label="Delete">
                  <TrashIcon width={15} height={15} />
                </button>
              </div>
            }
          />
        </div>
      )}

      {viewSubmissionOpen && (
        <Modal onClose={() => setViewSubmissionOpen(false)}>
          <div className="submission-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Submission</h2>
            {task.completion_note && <p className="task-submission-note-text">{task.completion_note}</p>}
            {attachments.length > 0 && (
              <div className="task-submission-attachments">
                {attachments.map((a, i) =>
                  isImageAttachment(a.name) ? (
                    <div className="task-submission-attachment task-submission-attachment-image" key={i}>
                      <img src={a.url} alt={a.name || 'Attachment'} />
                    </div>
                  ) : (
                    <a
                      className="task-submission-attachment task-submission-file-link"
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      key={i}
                    >
                      <span className="task-submission-file-icon">📎</span>
                      <span className="task-submission-file-name">{a.name || 'View attachment'}</span>
                    </a>
                  ),
                )}
              </div>
            )}
            <div className="submission-actions">
              <button type="button" onClick={() => setViewSubmissionOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {submitOpen && (
        <Modal onClose={() => setSubmitOpen(false)}>
          <div className="submission-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Submission</h2>
            <label className="submission-field">
              Link, note, or details
              <textarea
                rows={4}
                placeholder="Link, note, or details…"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
              />
            </label>

            <div className="submission-field">
              <span className="submission-field-label">Attachments</span>

              {attachments.length > 0 && (
                <div className="task-submission-attachments">
                  {attachments.map((a, i) =>
                    isImageAttachment(a.name) ? (
                      <div className="task-submission-attachment task-submission-attachment-image" key={i}>
                        <img src={a.url} alt={a.name || 'Attachment'} />
                        <button
                          type="button"
                          className="task-submission-remove"
                          onClick={(e) => handleRemoveAttachment(e, i)}
                          title="Remove"
                          aria-label="Remove attachment"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className="task-submission-attachment task-submission-file-link" key={i}>
                        <a href={a.url} target="_blank" rel="noreferrer" className="task-submission-file-open">
                          <span className="task-submission-file-icon">📎</span>
                          <span className="task-submission-file-name">{a.name || 'View attachment'}</span>
                        </a>
                        <button
                          type="button"
                          className="task-submission-remove"
                          onClick={(e) => handleRemoveAttachment(e, i)}
                          title="Remove"
                          aria-label="Remove attachment"
                        >
                          ✕
                        </button>
                      </div>
                    ),
                  )}
                </div>
              )}

              <label className="task-submission-upload" title="Attach files">
                {uploading ? 'Uploading…' : <PaperclipIcon width={16} height={16} />}
                <input type="file" multiple onChange={handleAttachmentUpload} hidden aria-label="Attach files" />
              </label>
              {uploadError && <p className="error">{uploadError}</p>}
            </div>

            <div className="submission-actions">
              <button
                type="button"
                onClick={() => {
                  setNoteDraft(task.completion_note || '')
                  setUploadError('')
                  setSubmitOpen(false)
                }}
              >
                Cancel
              </button>
              <button type="button" className="submission-save" onClick={handleSaveNote}>
                Save
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

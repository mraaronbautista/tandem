import { useState } from 'react'
import { isOverdue, formatDuration } from '../lib/tasks'
import { PRIORITY_COLOR } from '../lib/priorityColors'
import { WHO_LABEL, WHO_COLOR } from '../lib/whoLabels'
import { splitDueDateInZone, DEFAULT_TIMEZONE } from '../lib/timezone'
import { uploadCompletionAttachment, isImageAttachment } from '../lib/attachments'
import TaskForm from './TaskForm'
import ChecklistView from './ChecklistView'
import Modal from './Modal'

const SOURCE_LABEL = { teams: 'Teams', email: 'Email', none: null }
const DATE_TIME_FORMAT = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
const TIME_ONLY_FORMAT = { hour: 'numeric', minute: '2-digit' }

// Editing/assigning a task stays explicit about which zone the time is
// in (so you can target Ada's zone precisely) — but glancing at the list
// should show what time it lands at in whoever is actually looking right
// now, in their own device's local time. No zone label needed here since
// it's always "your" time, unambiguous by definition.
function localLabel(isoString) {
  return new Date(isoString).toLocaleString([], DATE_TIME_FORMAT)
}

// "Jul 23, 5:30 – 6:10 PM (40 min)" when a duration is set, otherwise just
// the point-in-time label as before.
function dueLabel(task) {
  const start = localLabel(task.due_date)
  if (!task.duration_minutes) return start
  const end = new Date(new Date(task.due_date).getTime() + task.duration_minutes * 60000)
  return `${start} – ${end.toLocaleTimeString([], TIME_ONLY_FORMAT)} (${formatDuration(task.duration_minutes)})`
}

export default function TaskRow({
  task,
  onStatusChange,
  onUpdate,
  onDelete,
  memberName,
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
  const hasSubmission = Boolean(task.completion_note || task.completion_attachment_url)
  const overdue = isOverdue(task)
  const overlapping = overlappingIds?.has(task.id) ?? false
  const hasNotes = Boolean(task.notes)
  const sourceLabel = SOURCE_LABEL[task.source]
  const creatorName = memberName(task.created_by)
  const checklist = task.checklist || []
  const checklistDone = checklist.filter((item) => item.done).length

  function handleDelete(e) {
    e.stopPropagation()
    if (window.confirm(`Delete "${task.title}"? This can't be undone.`)) {
      onDelete(task.id)
    }
  }

  function handleToggleChecklistItem(itemId) {
    const updated = checklist.map((item) => (item.id === itemId ? { ...item, done: !item.done } : item))
    onUpdate(task.id, { checklist: updated })
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
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadCompletionAttachment(task.id, file)
      await onUpdate(task.id, { completion_attachment_url: url, completion_attachment_name: file.name })
    } catch (err) {
      alert(err.message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  function handleRemoveAttachment(e) {
    e.stopPropagation()
    onUpdate(task.id, { completion_attachment_url: null, completion_attachment_name: null })
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
          <span className="task-priority-dot" style={{ background: PRIORITY_COLOR[task.priority] }} />
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
        {task.due_date && (
          <span className={`task-due ${overdue ? 'task-due-overdue' : ''}`}>{dueLabel(task)}</span>
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
          <ChecklistView items={checklist} onToggle={handleToggleChecklistItem} />
          {task.recurrence !== 'none' && (
            <p className="task-recurrence">Repeats {task.recurrence}</p>
          )}
          {!sourceLabel && !task.notes && !checklist.length && task.recurrence === 'none' && !creatorName && (
            <p className="task-notes-empty">No additional details.</p>
          )}

          <div className="task-row-actions">
            <button onClick={() => setEditing(true)}>Edit</button>
            {task.status === 'done' && hasSubmission && (
              <button onClick={() => setViewSubmissionOpen(true)}>View submission</button>
            )}
            {task.status === 'done' && (
              <button onClick={() => setSubmitOpen(true)}>{hasSubmission ? 'Edit submission' : 'Submit'}</button>
            )}
            <button className="task-delete" onClick={handleDelete}>
              Delete
            </button>
          </div>
        </div>
      )}

      {viewSubmissionOpen && (
        <Modal onClose={() => setViewSubmissionOpen(false)}>
          <div className="submission-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Submission</h2>
            {task.completion_note && <p className="task-submission-note-text">{task.completion_note}</p>}
            {task.completion_attachment_url &&
              (isImageAttachment(task.completion_attachment_name) ? (
                <div className="task-submission-image">
                  <img src={task.completion_attachment_url} alt={task.completion_attachment_name || 'Attachment'} />
                </div>
              ) : (
                <a
                  className="task-submission-file-link"
                  href={task.completion_attachment_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  📎 {task.completion_attachment_name || 'View attachment'}
                </a>
              ))}
            <div className="new-task-actions">
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
            <label>
              Link, note, or details
              <input
                type="text"
                placeholder="Link, note, or details…"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
              />
            </label>

            {task.completion_attachment_url ? (
              <div className="task-submission-image">
                {isImageAttachment(task.completion_attachment_name) ? (
                  <img src={task.completion_attachment_url} alt={task.completion_attachment_name || 'Attachment'} />
                ) : (
                  <a
                    className="task-submission-file-link"
                    href={task.completion_attachment_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    📎 {task.completion_attachment_name || 'View attachment'}
                  </a>
                )}
                <button type="button" onClick={handleRemoveAttachment}>
                  Remove attachment
                </button>
              </div>
            ) : (
              <label className="task-submission-upload">
                {uploading ? 'Uploading…' : '+ Attach a file'}
                <input type="file" onChange={handleAttachmentUpload} hidden />
              </label>
            )}

            <div className="new-task-actions">
              <button
                type="button"
                onClick={() => {
                  setNoteDraft(task.completion_note || '')
                  setSubmitOpen(false)
                }}
              >
                Cancel
              </button>
              <button type="button" onClick={handleSaveNote}>
                Save
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

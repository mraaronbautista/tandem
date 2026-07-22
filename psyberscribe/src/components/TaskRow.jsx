import { useState } from 'react'
import { isOverdue } from '../lib/tasks'
import { PRIORITY_COLOR } from '../lib/priorityColors'
import { WHO_LABEL, WHO_COLOR } from '../lib/whoLabels'
import { splitDueDateInZone, DEFAULT_TIMEZONE } from '../lib/timezone'
import TaskForm from './TaskForm'
import ChecklistView from './ChecklistView'

const SOURCE_LABEL = { teams: 'Teams', email: 'Email', none: null }
const DATE_TIME_FORMAT = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }

// Editing/assigning a task stays explicit about which zone the time is
// in (so you can target Ada's zone precisely) — but glancing at the list
// should show what time it lands at in whoever is actually looking right
// now, in their own device's local time. No zone label needed here since
// it's always "your" time, unambiguous by definition.
function localLabel(isoString) {
  return new Date(isoString).toLocaleString([], DATE_TIME_FORMAT)
}

export default function TaskRow({ task, onStatusChange, onUpdate, onDelete, memberName, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const [editing, setEditing] = useState(false)
  const overdue = isOverdue(task)
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
    <div className={`task-row ${task.status === 'done' ? 'task-row-done' : ''}`} onClick={() => setOpen((v) => !v)}>
      <div className="task-row-main">
        <input
          type="checkbox"
          className="task-done-checkbox"
          checked={task.status === 'done'}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onStatusChange(task.id, task.status === 'done' ? 'to_do' : 'done')}
        />
        <span className="task-priority-dot" style={{ background: PRIORITY_COLOR[task.priority] }} />
        <span className="task-who-badge" style={{ background: WHO_COLOR[task.who] }}>
          {WHO_LABEL[task.who]}
        </span>
        <span className="task-title">{task.title}</span>
        {hasNotes && <span className="task-notes-icon" title="Has notes">📝</span>}
        {checklist.length > 0 && (
          <span className="task-checklist-badge" title="Subtasks">
            ☑ {checklistDone}/{checklist.length}
          </span>
        )}
        {task.status === 'done' && task.completed_at ? (
          <span className="task-due">Completed {localLabel(task.completed_at)}</span>
        ) : (
          task.due_date && (
            <span className={`task-due ${overdue ? 'task-due-overdue' : ''}`}>{localLabel(task.due_date)}</span>
          )
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
            <button className="task-delete" onClick={handleDelete}>
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

import PrivateAttachment from './PrivateAttachment'
import { useEffect, useRef, useState } from 'react'
import { isOverdue, isAllDayTask, formatDuration, fetchMembersWhoCanViewTask } from '../lib/tasks'
import { PRIORITY_COLOR, PRIORITY_LABEL } from '../lib/priorityColors'
import { assigneeBadge } from '../lib/whoLabels'
import { splitDueDateInZone, DEFAULT_TIMEZONE, zoneAbbreviation, zoneLabel } from '../lib/timezone'
import { isImageAttachment } from '../lib/attachments'
import { sendTaskNudge, sendTaskCompletedNotify } from '../lib/manualNotify'
import { Pencil, Paperclip, Copy, Eye, Trash2, Bell, AlertTriangle, StickyNote, CheckSquare, MessageCircle, Repeat2, ChevronDown, ChevronUp, Pin } from 'lucide-react'
import TaskForm, { recurrenceLabel as getRecurrenceLabel } from './TaskForm'
import ChecklistView from './ChecklistView'
import TaskClarifications from './TaskClarifications'
import Modal from './Modal'
import ModalCard from './ModalCard'
import TaskIcon from './TaskIcon'
import PriorityBadge from './PriorityBadge'
import AssigneePicker from './AssigneePicker'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'
import { useConfirm } from '../lib/confirmContext'
import { readableTextColor } from '../lib/colorContrast'

// Auto-dismiss window for the post-completion Notify prompt — same 8s
// Projects' own undo-on-remove banner uses, long enough to actually
// register and act on, short enough not to linger once ignored.
const COMPLETION_NOTIFY_TIMEOUT_MS = 8000

// The fields a "this and future tasks" edit can carry to the rest of a
// repeating series, with how each is named in the question. Schedule fields
// (date, time, zone, Repeats) are deliberately absent: the template-edit
// trigger in the database already owns those.
const SERIES_FIELDS = {
  title: 'the title',
  priority: 'the priority',
  icon: 'the icon',
  assignee_ids: 'who it is for',
  duration_minutes: 'how long it takes',
  source: 'where it came from',
  source_note: 'where it came from',
  notes: 'the notes',
  checklist: 'the checklist',
}

// '' and null both mean "nothing here" (the form saves blank text as null).
function sameFieldValue(a, b) {
  const blank = (v) => (v === '' || v === undefined ? null : v)
  return JSON.stringify(blank(a)) === JSON.stringify(blank(b))
}

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
function dueLabel(task, displayTimezone) {
  const timeZone = isAllDayTask(task) ? task.due_timezone || DEFAULT_TIMEZONE : displayTimezone
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
  onUpdateSeries,
  onDelete,
  onDuplicate,
  onArchiveToBoard,
  memberName,
  members = [],
  meId,
  defaultOpen = false,
  overlappingIds,
  hidePriorityDot = false,
  displayTimezone = DEFAULT_TIMEZONE,
}) {
  const confirm = useConfirm()
  const [open, setOpen] = useState(defaultOpen)
  const [editing, setEditing] = useState(false)
  const [viewSubmissionOpen, setViewSubmissionOpen] = useState(false)
  const [nudging, setNudging] = useState(false)
  const [nudgeSent, setNudgeSent] = useState(false)
  const [notesExpanded, setNotesExpanded] = useState(false)
  const [deleteRecurringOpen, setDeleteRecurringOpen] = useState(false)
  // Set when a save changed shared fields of a repeating task and the person
  // still has to say whether it is for this task only or this and later ones.
  const [scopePending, setScopePending] = useState(null)
  // Post-completion "Notify" prompt — null when not showing. `eligible`
  // is pre-filtered to members who can actually view this task, aren't
  // the assignee, aren't an admin (already covered by the automatic
  // completion ping — see notify-task-events), and aren't the viewer
  // themselves; `selected` defaults to the task's creator if they made
  // the cut, since they're the one most likely waiting to hear back.
  const [completionNotify, setCompletionNotify] = useState(null)
  const [notifySending, setNotifySending] = useState(false)
  const swipeStartRef = useRef(null)
  const attachments = task.completion_attachments || []
  const hasSubmission = Boolean(task.completion_note || attachments.length)
  const overdue = isOverdue(task)
  const overlapping = overlappingIds?.has(task.id) ?? false
  const hasNotes = Boolean(task.notes)
  const hasLongNotes = task.notes && (task.notes.length > 240 || task.notes.split('\n').length > 4)
  const sourceLabel = SOURCE_LABEL[task.source]
  const creatorName = memberName(task.created_by)
  const badge = assigneeBadge(members, task.assignee_ids)
  // Nudging yourself makes no sense — same "assigning yourself a task
  // doesn't ping you, since you already know" reasoning notify-task-events
  // already uses. Shows whenever the viewer isn't one of the task's own
  // assignees — for a multi-assignee task that still includes the viewer,
  // this stays hidden (nudging a task you're already on yourself doesn't
  // fit "still on your plate?" the way it would for someone not on it).
  const canNudge = overdue && !(task.assignee_ids || []).includes(meId)
  const checklist = task.checklist || []
  const checklistDone = checklist.filter((item) => item.done).length
  const recurrence = task.recurrence ?? 'none'
  const recurrenceLabel = getRecurrenceLabel(recurrence, task.recurrence_days || [])
  const clarifications = task.clarifications || []
  // A question directed at whoever's looking right now — an in-app
  // reminder that doesn't depend on the push notification having been
  // seen (or not dismissed). Excludes anything marked resolved (a plain
  // comment someone decided doesn't need a reply) — otherwise those would
  // flag this badge forever, since `answer` never gets set for them.
  const hasQuestionForMe = clarifications.some((c) => !c.answer && !c.resolved && c.askedBy !== meId)

  async function handleDelete(e) {
    e.stopPropagation()
    if (recurrence !== 'none') {
      setDeleteRecurringOpen(true)
      return
    }
    const ok = await confirm({
      title: `Delete "${task.title}"?`,
      message: "This can't be undone. To keep a record of it instead, use Send to board.",
      confirmLabel: 'Delete task',
    })
    if (ok) onDelete(task.id)
  }

  function handleDuplicate(e) {
    e.stopPropagation()
    onDuplicate(task)
  }

  // Archives this task and pins it to Cork Board in one motion — see
  // archiveTaskToBoard() in corkNotes.js. Reversible (the pin's own
  // "Restore to Today" button un-archives this exact task later), same
  // "no confirm needed" reasoning cork_notes' own Archive button already
  // follows for the identical reason.
  function handleArchiveToBoard(e) {
    e.stopPropagation()
    onArchiveToBoard(task)
  }

  // nudgeSent is purely a local "yep, that went through" confirmation —
  // doesn't read overdue_nudge_sent_at back (fetched now for Inbox's
  // Nudges section — see tasks.js's getNudgedTasks — but still not
  // surfaced as an "already nudged" indicator on the row itself) and
  // resets on the next render of this task from anywhere else, same
  // low-stakes as any other fire-and-forget notification button in this
  // app (Nudge Aaron, Ask a question) not tracking its own delivery
  // state persistently.
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

  // Appends new steps to the end of the existing checklist, in the same
  // { id, text, done, blocked, blockedReason } shape ChecklistEditor builds.
  function handleAddChecklistItems(texts) {
    const added = texts.map((text) => ({ id: crypto.randomUUID(), text, done: false, blocked: false, blockedReason: '' }))
    return onUpdate(task.id, { checklist: [...checklist, ...added] }, { throwOnError: true })
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
    // Marking done opens the completion composer right away, instead of
    // making you dig into the row separately.
    if (next === 'done') {
      setOpen(true)
      loadCompletionNotify()
    } else {
      // Unchecking cancels an in-flight or showing prompt — it's no
      // longer a completion worth flagging to anyone.
      setCompletionNotify(null)
    }
  }

  // Fire-and-forget on purpose — a failed/slow lookup here should never
  // block or visibly interrupt the actual completion, which already
  // happened via onStatusChange above. Shows nothing if nobody besides
  // the admin (already covered automatically) and the assignee(s) can
  // even see this task.
  async function loadCompletionNotify() {
    try {
      const viewerIds = await fetchMembersWhoCanViewTask(task.id)
      const eligible = members.filter(
        (m) => viewerIds.includes(m.id) && m.id !== meId && !task.assignee_ids?.includes(m.id) && !m.is_admin,
      )
      if (eligible.length === 0) return
      const defaultSelected = eligible.some((m) => m.id === task.created_by) ? [task.created_by] : []
      setCompletionNotify({ eligible, selected: defaultSelected })
    } catch {
      // Best-effort, same reasoning every other push in this app treats
      // delivery as non-critical — the task is already marked done
      // regardless of whether this lookup succeeds.
    }
  }

  async function handleSendCompletionNotify() {
    if (!completionNotify?.selected.length) return
    setNotifySending(true)
    try {
      await sendTaskCompletedNotify(task.id, task.title, completionNotify.selected)
    } catch {
      // Best-effort, see loadCompletionNotify above.
    } finally {
      setNotifySending(false)
      setCompletionNotify(null)
    }
  }

  // Auto-dismiss if left untouched — same shape Projects' own
  // undo-on-remove banner uses, so the prompt doesn't linger forever if
  // nobody needed notifying this time.
  useEffect(() => {
    if (!completionNotify) return
    const timer = window.setTimeout(() => setCompletionNotify(null), COMPLETION_NOTIFY_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [completionNotify])

  function handleSwipeStart(e) {
    if (!open || e.touches.length !== 1) return
    const touch = e.touches[0]
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY }
  }

  function handleSwipeEnd(e) {
    const start = swipeStartRef.current
    swipeStartRef.current = null
    if (!start || !e.changedTouches.length) return
    const touch = e.changedTouches[0]
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (deltaY < 80 || deltaY < Math.abs(deltaX) * 1.25) return

    // Prevent the touch's synthetic click from immediately reopening the
    // task after the swipe closes it. The gesture starts on the compact
    // header only, so scrolling back through a long note remains normal.
    e.preventDefault()
    setOpen(false)
    setNotesExpanded(false)
  }

  function handleSaveCompletion(note, files) {
    return onUpdate(task.id, {
      completion_note: note.trim() || null,
      completion_attachments: files,
    }, { throwOnError: true })
  }

  const scopeModal = scopePending && (
      <Modal onClose={() => setScopePending(null)}>
          <ModalCard>
            <h2>Change this repeating task?</h2>
            <p>
              You changed {[...new Set(Object.keys(scopePending.changed).map((k) => SERIES_FIELDS[k]))].join(', ')}.
              Choose whether that applies to only this task, or to this one and every later task in the series.
            </p>
            <SubmissionActions>
              <SubmissionButton onClick={() => setScopePending(null)}>Cancel</SubmissionButton>
              <SubmissionButton
                onClick={async () => {
                  const { values } = scopePending
                  setScopePending(null)
                  await onUpdate(task.id, values)
                  setEditing(false)
                }}
              >
                Only this task
              </SubmissionButton>
              <SubmissionButton
                variant="primary"
                onClick={async () => {
                  const { values, changed } = scopePending
                  setScopePending(null)
                  await onUpdate(task.id, values)
                  await onUpdateSeries(task.id, changed)
                  setEditing(false)
                }}
              >
                This and future tasks
              </SubmissionButton>
            </SubmissionActions>
          </ModalCard>
        </Modal>
      )

  if (editing) {
    return (
      <>
      <div className="task-row task-row-editing" onClick={(e) => e.stopPropagation()}>
        <TaskForm
          autoFocus={false}
          submitLabel="Save changes"
          members={members}
          initialValues={{ ...task, ...splitDueDateInZone(task.due_date, task.due_timezone || DEFAULT_TIMEZONE) }}
          onCancel={() => setEditing(false)}
          onSubmit={async (values) => {
            // A repeating task asks first when a shared field changed: the
            // other copies would otherwise quietly keep the old value.
            const changed = {}
            if (task.recurrence_series_id && onUpdateSeries) {
              for (const key of Object.keys(SERIES_FIELDS)) {
                if (!sameFieldValue(values[key], task[key])) changed[key] = values[key]
              }
            }
            if (Object.keys(changed).length) {
              setScopePending({ values, changed })
              return
            }
            await onUpdate(task.id, values)
            setEditing(false)
          }}
        />
      </div>
      {scopeModal}
      </>
    )
  }

  return (
    <div
      className="task-row border-l-[3px]"
      style={{ borderLeftColor: overlapping ? '#e0a83e' : PRIORITY_COLOR[task.priority] }}
      onClick={() => setOpen((v) => !v)}
    >
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1.5"
        onTouchStart={handleSwipeStart}
        onTouchEnd={handleSwipeEnd}
        onTouchCancel={() => { swipeStartRef.current = null }}
      >
        {/* Was a plain PriorityDot — priority itself moved to the row's
            own left border (matching DayTimeline.jsx's block, which
            already worked this way) once this slot became the task icon,
            so swapping the dot out for an icon here doesn't leave
            priority with no visual signal at all. */}
        {!hidePriorityDot && <TaskIcon task={task} title={PRIORITY_LABEL[task.priority]} />}
        <span className="task-who-badge" style={{ background: badge.color, color: readableTextColor(badge.color) }}>
          {badge.label}
        </span>
        <span className={`min-w-0 flex-[1_1_140px] text-sm font-medium text-text-h ${task.status === 'done' ? 'line-through opacity-75' : ''}`}>{task.title}</span>
        {overlapping && (
          <span className="flex flex-none items-center gap-0.5 text-[11px] font-semibold whitespace-nowrap text-notice-text" title="Overlaps another task's time">
            <AlertTriangle size={12} /> Overlap
          </span>
        )}
        <PriorityBadge priority={task.priority} />
        {hasNotes && (
          <span className="opacity-80" title="Has notes">
            <StickyNote size={13} />
          </span>
        )}
        {checklist.length > 0 && (
          <span className="flex items-center gap-0.5 text-xs whitespace-nowrap opacity-75" title="Subtasks">
            <CheckSquare size={13} /> {checklistDone}/{checklist.length}
          </span>
        )}
        {recurrence !== 'none' && recurrenceLabel && (
          <span
            className="flex flex-none items-center gap-1 rounded-full border border-border bg-pill-bg px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-text-h"
            title={`Repeats ${recurrenceLabel.toLowerCase()}`}
          >
            <Repeat2 size={12} aria-hidden="true" />
            {recurrenceLabel}
          </span>
        )}
        {hasQuestionForMe && (
          <span className="opacity-80" title="Has something for you to reply to">
            <MessageCircle size={13} />
          </span>
        )}
        {task.due_date && (
          <span className={`text-xs whitespace-nowrap ${overdue ? 'font-semibold text-overdue-text opacity-100' : 'opacity-80'}`}>{dueLabel(task, displayTimezone)}</span>
        )}
        {/* Names the zone dueLabel above is already showing the time in
            (see localLabel) — the two have to agree, since a badge next
            to a time that's actually in some other zone reads as if the
            badge's zone is what's displayed. All Day tasks skip this: the
            zone only affects which calendar day midnight falls on for
            them, a much lower-stakes mistake than a timed task landing
            hours off, so it's not worth a badge on every all-day item. */}
        {task.due_date && !isAllDayTask(task) && (
          <span className="task-zone-badge" title={`Displayed in ${zoneLabel(displayTimezone)}`}>
            {zoneAbbreviation(displayTimezone)}
          </span>
        )}
        {task.status === 'done' && task.completed_at && (
          <span className="text-[11px] whitespace-nowrap opacity-80">Completed {localLabel(task.completed_at)}</span>
        )}
        {/* Moved from leading to trailing (ml-auto pins it to the row's
            right edge, same "checkbox on the right" placement Structured
            uses) — purely a position change, same checkbox/behavior. */}
        <input
          type="checkbox"
          className="task-done-checkbox ml-auto"
          checked={task.status === 'done'}
          onClick={(e) => e.stopPropagation()}
          onChange={handleStatusToggle}
        />
      </div>

      {open && (
        <div className="mt-2.5 cursor-default border-t border-border pt-2.5 text-[13px] [&_p]:mb-1.5" onClick={(e) => e.stopPropagation()}>
          {completionNotify && (
            <div className="mb-2.5 flex flex-col gap-1.5 rounded-[8px] border border-border bg-pill-bg px-2.5 py-2">
              <span className="text-[13px] opacity-80">Notify someone this is done?</span>
              <AssigneePicker
                members={completionNotify.eligible}
                value={completionNotify.selected}
                onChange={(next) => setCompletionNotify((prev) => (prev ? { ...prev, selected: next } : prev))}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="vault-copy"
                  onClick={() => setCompletionNotify(null)}
                  disabled={notifySending}
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  className="vault-copy"
                  onClick={handleSendCompletionNotify}
                  disabled={notifySending || completionNotify.selected.length === 0}
                >
                  {notifySending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          )}
          {creatorName && (
            <p className="text-xs opacity-80">Added by {creatorName}</p>
          )}
          {sourceLabel && (
            <p>
              <strong>Source:</strong> {sourceLabel}
              {task.source_note ? ` — ${task.source_note}` : ''}
            </p>
          )}
          {task.notes && (
            <div className="mb-2">
              <p
                className={`break-words whitespace-pre-wrap ${
                  hasLongNotes && !notesExpanded
                    ? 'overflow-hidden text-ellipsis [-webkit-box-orient:vertical] [-webkit-line-clamp:4] [display:-webkit-box]'
                    : ''
                }`}
              >
                {task.notes}
              </p>
              {hasLongNotes && (
                <button
                  type="button"
                  className="mt-1 flex cursor-pointer items-center gap-1 rounded-full border-0 bg-transparent px-0 py-1 text-xs font-medium text-accent-text"
                  onClick={() => setNotesExpanded((value) => !value)}
                  aria-expanded={notesExpanded}
                >
                  {notesExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  {notesExpanded ? 'Collapse note' : 'Show full note'}
                </button>
              )}
            </div>
          )}
          <ChecklistView items={checklist} onItemChange={handleChecklistItemChange} />
          {recurrence !== 'none' && recurrenceLabel && (
            <p>Repeats {recurrenceLabel.toLowerCase()}</p>
          )}
          {!sourceLabel && !task.notes && !checklist.length && recurrence === 'none' && !creatorName && (
            <p className="task-notes-empty">No additional details.</p>
          )}

          <TaskClarifications
            clarifications={clarifications}
            onChange={handleClarificationsChange}
            meId={meId}
            memberName={memberName}
            members={members}
            assigneeIds={task.assignee_ids}
            taskTitle={task.title}
            taskId={task.id}
            onAddChecklistItems={handleAddChecklistItems}
            taskDone={task.status === 'done'}
            completionNote={task.completion_note || ''}
            completionAttachments={attachments}
            onSaveCompletion={handleSaveCompletion}
            extraActions={
              // Icon + visible text on every button, not icon-only with a
              // title tooltip — a tooltip only ever shows on hover, which
              // mobile (this app's primary surface) structurally never
              // gets, so a first-time user previously saw meaningless bare
              // icons until they actually tapped one. Matches the pattern
              // StaffClockView.jsx already established correctly (Play +
              // "Start", Square + "Stop", etc.) — copied here, not a new
              // convention. flex-wrap since up to 6 of these can show at
              // once (a done task with a submission); wrapping to a second
              // line reads fine, an overflowing or clipped row doesn't.
              <div className="flex flex-wrap gap-2 pointer-coarse:[&_button]:min-h-10 max-[480px]:[&_button]:min-h-10 [&_button]:inline-flex [&_button]:cursor-pointer [&_button]:items-center [&_button]:gap-1.5 [&_button]:rounded-sm [&_button]:border [&_button]:border-border [&_button]:bg-pill-bg [&_button]:px-3 [&_button]:py-1.5 [&_button]:text-xs [&_button]:text-text-h [&_button]:transition-all [&_button]:duration-[120ms] [&_button]:ease-tactile [&_button:active]:scale-[0.96] [&_button:disabled]:cursor-default [&_button:disabled]:opacity-50">
                <button onClick={() => setEditing(true)} title="Edit" aria-label="Edit">
                  <Pencil width={15} height={15} />
                  Edit
                </button>
                <button onClick={handleDuplicate} title="Duplicate" aria-label="Duplicate">
                  <Copy width={15} height={15} />
                  Duplicate
                </button>
                {onArchiveToBoard && (
                  <button onClick={handleArchiveToBoard} title="Send to board" aria-label="Send to board">
                    <Pin width={15} height={15} />
                    Send to board
                  </button>
                )}
                {canNudge && (
                  <button
                    onClick={handleNudge}
                    disabled={nudging || nudgeSent}
                    title={nudgeSent ? 'Nudge sent' : 'Nudge — still on your plate?'}
                    aria-label={nudgeSent ? 'Nudge sent' : 'Nudge — still on your plate?'}
                  >
                    <Bell width={15} height={15} />
                    {nudgeSent ? 'Nudge sent' : 'Nudge'}
                  </button>
                )}
                {task.status === 'done' && hasSubmission && (
                  <button onClick={() => setViewSubmissionOpen(true)} title="View submission" aria-label="View submission">
                    <Eye width={15} height={15} />
                    View submission
                  </button>
                )}
                <button className="!text-overdue-text" onClick={handleDelete} title="Delete" aria-label="Delete">
                  <Trash2 width={15} height={15} />
                  Delete
                </button>
              </div>
            }
          />
        </div>
      )}

      {viewSubmissionOpen && (
        <Modal onClose={() => setViewSubmissionOpen(false)}>
          <ModalCard>
            <h2>Submission</h2>
            {task.completion_note && <p className="task-submission-note-text">{task.completion_note}</p>}
            {attachments.length > 0 && (
              <div className="task-submission-attachments">
                {attachments.map((a, i) =>
                  isImageAttachment(a.name) ? (
                    <div className="task-submission-attachment task-submission-attachment-image" key={i}>
                      <PrivateAttachment image url={a.url} alt={a.name || 'Attachment'} />
                    </div>
                  ) : (
                    <PrivateAttachment
                      className="task-submission-attachment task-submission-file-link"
                      url={a.url}
                      target="_blank"
                      rel="noreferrer"
                      key={i}
                    >
                      <span className="task-submission-file-icon">
                        <Paperclip size={13} />
                      </span>
                      <span className="task-submission-file-name">{a.name || 'View attachment'}</span>
                    </PrivateAttachment>
                  ),
                )}
              </div>
            )}
            <SubmissionActions>
              <SubmissionButton onClick={() => setViewSubmissionOpen(false)}>Close</SubmissionButton>
            </SubmissionActions>
          </ModalCard>
        </Modal>
      )}

      {scopeModal}

      {deleteRecurringOpen && (
        <Modal onClose={() => setDeleteRecurringOpen(false)}>
          <ModalCard>
            <h2>Delete recurring task?</h2>
            <p>Choose whether to remove only this occurrence or stop this schedule from this task onward.</p>
            <SubmissionActions>
              <SubmissionButton onClick={() => setDeleteRecurringOpen(false)}>Cancel</SubmissionButton>
              <SubmissionButton
                variant="destructive"
                onClick={() => {
                  setDeleteRecurringOpen(false)
                  onDelete(task.id, 'occurrence')
                }}
              >
                Only this task
              </SubmissionButton>
              <SubmissionButton
                variant="destructive"
                onClick={() => {
                  setDeleteRecurringOpen(false)
                  onDelete(task.id, 'future')
                }}
              >
                This and future tasks
              </SubmissionButton>
            </SubmissionActions>
          </ModalCard>
        </Modal>
      )}

    </div>
  )
}

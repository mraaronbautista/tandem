import { isAllDayTask } from '../lib/tasks'
import { PRIORITY_COLOR, PRIORITY_LABEL } from '../lib/priorityColors'
import { DEFAULT_TIMEZONE, splitDueDateInZone } from '../lib/timezone'
import TaskRow from './TaskRow'

export default function TimelineRow({ task, time, isLast, ...taskRowProps }) {
  const isDone = task.status === 'done'
  // Once done, `time` is the real completed_at moment (see TaskBoard.jsx),
  // which is more useful here than "All day" — only a still-open All Day
  // task, still genuinely showing its placeholder due_date, gets the
  // "All day" label instead of the literal midnight it's stored at.
  const isAllDay = !isDone && isAllDayTask(task)
  // Shown in the task's own due_timezone, matching the task-zone-badge
  // rendered just below this by the nested TaskRow (see dueLabel there
  // for the full reasoning) — a still-open task's `time` here is its
  // due_date, so the two labels have to agree on which zone they're in.
  // completed_at has no due_timezone concept of its own (it's just when
  // the task actually got finished), so that one stays viewer-local.
  const timeZone = task.due_timezone || DEFAULT_TIMEZONE
  const label = isAllDay
    ? 'All day'
    : isDone
      ? new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : new Date(time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone })

  // A still-open task with a real duration gets its own start/end dots
  // (and both time labels) instead of a single point — done tasks show
  // `time` as a single completed_at instant regardless of any duration
  // the task has, and an All Day task has no duration by definition (see
  // isAllDayTask), so neither case has a real span to show.
  const dotColor = PRIORITY_COLOR[task.priority]
  const dotTitle = PRIORITY_LABEL[task.priority]
  const hasSpan = !isDone && !isAllDay && task.duration_minutes
  // A duration long enough to land on a different calendar day than the
  // start (now possible up to a week — see TaskForm.jsx) needs its date
  // shown too, not just a bare time — two same-looking clock times with
  // no date would misread as same-day for a multi-day span. Compared as
  // calendar dates in due_timezone (hasSpan implies !isDone, so `time`
  // is always a due_date here), not browser-local, for the same reason
  // the labels themselves are zone-aware.
  const spanEnd = hasSpan ? new Date(new Date(time).getTime() + task.duration_minutes * 60000) : null
  const spansDays =
    hasSpan && splitDueDateInZone(time, timeZone).due_date !== splitDueDateInZone(spanEnd.toISOString(), timeZone).due_date
  const endTimeLabel = hasSpan
    ? spanEnd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone })
    : null
  const endLabel =
    hasSpan && spansDays
      ? `${spanEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone })}, ${endTimeLabel}`
      : endTimeLabel

  return (
    <div className="timeline-row">
      <div className="timeline-time">
        <span>{label}</span>
        {hasSpan && <span className="timeline-time-end">{endLabel}</span>}
      </div>
      <div className="timeline-rail">
        <span className="timeline-dot" style={{ background: dotColor }} title={dotTitle} />
        {hasSpan && (
          <>
            <span className="timeline-span-connector" />
            <span className="timeline-dot timeline-dot-end" style={{ background: dotColor }} title={dotTitle} />
          </>
        )}
        {!isLast && <span className="timeline-connector" />}
      </div>
      <div className="timeline-content">
        <TaskRow task={task} hidePriorityDot {...taskRowProps} />
      </div>
    </div>
  )
}

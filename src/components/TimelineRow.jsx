import { isAllDayTask } from '../lib/tasks'
import { PRIORITY_COLOR, PRIORITY_LABEL } from '../lib/priorityColors'
import TaskRow from './TaskRow'

export default function TimelineRow({ task, time, isLast, ...taskRowProps }) {
  // Once done, `time` is the real completed_at moment (see TaskBoard.jsx),
  // which is more useful here than "All day" — only a still-open All Day
  // task, still genuinely showing its placeholder due_date, gets the
  // "All day" label instead of the literal midnight it's stored at.
  const isAllDay = task.status !== 'done' && isAllDayTask(task)
  const label = isAllDay
    ? 'All day'
    : new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  // A still-open task with a real duration gets its own start/end dots
  // (and both time labels) instead of a single point — done tasks show
  // `time` as a single completed_at instant regardless of any duration
  // the task has, and an All Day task has no duration by definition (see
  // isAllDayTask), so neither case has a real span to show.
  const dotColor = PRIORITY_COLOR[task.priority]
  const dotTitle = PRIORITY_LABEL[task.priority]
  const hasSpan = task.status !== 'done' && !isAllDay && task.duration_minutes
  const endLabel = hasSpan
    ? new Date(new Date(time).getTime() + task.duration_minutes * 60000).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })
    : null

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

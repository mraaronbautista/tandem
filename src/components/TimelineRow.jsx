import { isAllDayTask } from '../lib/tasks'
import { PRIORITY_COLOR } from '../lib/priorityColors'
import TaskRow from './TaskRow'

export default function TimelineRow({ task, time, isLast, ...taskRowProps }) {
  // Once done, `time` is the real completed_at moment (see TaskBoard.jsx),
  // which is more useful here than "All day" — only a still-open All Day
  // task, still genuinely showing its placeholder due_date, gets the
  // "All day" label instead of the literal midnight it's stored at.
  const label =
    task.status !== 'done' && isAllDayTask(task)
      ? 'All day'
      : new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  return (
    <div className="timeline-row">
      <div className="timeline-time">{label}</div>
      <div className="timeline-rail">
        <span className="timeline-dot" style={{ background: PRIORITY_COLOR[task.priority] }} />
        {!isLast && <span className="timeline-connector" />}
      </div>
      <div className="timeline-content">
        <TaskRow task={task} hidePriorityDot {...taskRowProps} />
      </div>
    </div>
  )
}

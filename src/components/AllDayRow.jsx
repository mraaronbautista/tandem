import { PRIORITY_COLOR } from '../lib/priorityColors'
import { WHO_LABEL, WHO_COLOR } from '../lib/whoLabels'

// .allday-row/-chip/-chip-body/-chip-dot/-chip-title (App.css) had exactly
// one consumer — this component. .task-done-checkbox and .task-who-badge
// are shared by several other components and are kept as literal class
// names, unconverted. .allday-chip-body's [font-family:inherit]/
// [line-height:inherit] replicate the original's `font: inherit` (a
// <button> doesn't inherit font by default without Preflight, which this
// app doesn't have) — using `inherit` rather than a hardcoded value
// matches the original's actual semantics (follow the ambient value,
// wherever this renders) rather than a snapshot of today's numbers.
export default function AllDayRow({ tasks, onSelect, onStatusChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {tasks.map((task) => (
        <div
          key={task.id}
          className="flex items-center gap-2 rounded-full border border-border bg-card-bg px-3 py-1.5 max-w-[240px]"
        >
          <input
            type="checkbox"
            className="task-done-checkbox"
            checked={task.status === 'done'}
            onChange={() => onStatusChange(task.id, task.status === 'done' ? 'to_do' : 'done')}
          />
          <button
            type="button"
            className="flex min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-[13px] text-text-h [font-family:inherit] [line-height:inherit]"
            onClick={() => onSelect(task)}
          >
            <span className="h-2 w-2 flex-none rounded-full" style={{ background: PRIORITY_COLOR[task.priority] }} />
            <span className="task-who-badge" style={{ background: WHO_COLOR[task.who] }}>
              {WHO_LABEL[task.who]}
            </span>
            <span className="truncate">{task.title}</span>
          </button>
        </div>
      ))}
    </div>
  )
}

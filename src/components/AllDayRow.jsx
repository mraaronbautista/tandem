import { PRIORITY_COLOR } from '../lib/priorityColors'
import { WHO_LABEL, WHO_COLOR } from '../lib/whoLabels'

export default function AllDayRow({ tasks, onSelect, onStatusChange }) {
  return (
    <div className="allday-row">
      {tasks.map((task) => (
        <div key={task.id} className="allday-chip">
          <input
            type="checkbox"
            className="task-done-checkbox"
            checked={task.status === 'done'}
            onChange={() => onStatusChange(task.id, task.status === 'done' ? 'to_do' : 'done')}
          />
          <button type="button" className="allday-chip-body" onClick={() => onSelect(task)}>
            <span className="allday-chip-dot" style={{ background: PRIORITY_COLOR[task.priority] }} />
            <span className="task-who-badge" style={{ background: WHO_COLOR[task.who] }}>
              {WHO_LABEL[task.who]}
            </span>
            <span className="allday-chip-title">{task.title}</span>
          </button>
        </div>
      ))}
    </div>
  )
}

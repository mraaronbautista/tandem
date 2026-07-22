import TaskRow from './TaskRow'

export default function TimelineRow({ task, time, isLast, ...taskRowProps }) {
  const label = new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  return (
    <div className="timeline-row">
      <div className="timeline-time">{label}</div>
      <div className="timeline-rail">
        <span className="timeline-dot" />
        {!isLast && <span className="timeline-connector" />}
      </div>
      <div className="timeline-content">
        <TaskRow task={task} {...taskRowProps} />
      </div>
    </div>
  )
}

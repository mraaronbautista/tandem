import { useMemo } from 'react'
import { isAllDayTask } from '../lib/tasks'
import { PRIORITY_COLOR } from '../lib/priorityColors'
import { WHO_LABEL, WHO_COLOR } from '../lib/whoLabels'
import AllDayRow from './AllDayRow'

const PX_PER_MINUTE = 1.2
// Point-in-time tasks (no duration) get sized as if they were this long,
// purely for a legible minimum block height — not a real duration, and
// not what getOverlappingTaskIds uses to decide the "⚠ Overlap" badge.
const POINT_TASK_MINUTES = 30
const MIN_BLOCK_HEIGHT = 34
// Half an hour of breathing room before the first task / after the last,
// so a block isn't flush against the timeline's own top/bottom edge.
const PAD_MINUTES = 30

function roundDownToHour(date) {
  const d = new Date(date)
  d.setMinutes(0, 0, 0)
  return d
}

function roundUpToHour(date) {
  const d = new Date(date)
  if (d.getMinutes() > 0 || d.getSeconds() > 0 || d.getMilliseconds() > 0) d.setHours(d.getHours() + 1)
  d.setMinutes(0, 0, 0)
  return d
}

// Classic "meeting rooms" interval layout: sweeps tasks in start order,
// grouping any that overlap into a cluster, then greedily assigns each a
// column — the first column whose current occupant has already ended, or
// a new one if none are free. Every item in a cluster gets the same
// totalCols (the max simultaneous overlap within it), which is what
// drives each block's width (100% / totalCols) below.
function assignColumns(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end)
  const result = []
  let cluster = []
  let clusterEnd = null

  function flushCluster() {
    if (!cluster.length) return
    const columnEnds = []
    const withCols = cluster.map((item) => {
      let col = columnEnds.findIndex((end) => item.start >= end)
      if (col === -1) {
        col = columnEnds.length
        columnEnds.push(item.end)
      } else {
        columnEnds[col] = item.end
      }
      return { ...item, col }
    })
    const totalCols = columnEnds.length
    for (const item of withCols) result.push({ ...item, totalCols })
    cluster = []
  }

  for (const item of sorted) {
    if (cluster.length && item.start < clusterEnd) {
      cluster.push(item)
      if (item.end > clusterEnd) clusterEnd = item.end
    } else {
      flushCluster()
      cluster = [item]
      clusterEnd = item.end
    }
  }
  flushCluster()
  return result
}

// Day mode's task list, drawn as a real time-scaled timeline rather than
// a flat stack of rows (see TimelineRow.jsx, still used for Overdue and
// for Week mode's day-sections) — tasks are positioned by actual start
// time and sized by actual duration, and two that overlap render in
// side-by-side columns instead of just carrying an "⚠ Overlap" badge
// with nothing visually linking them. Scoped to Day mode only; a scaled
// view per day for Week mode's 7 sections is a separate, bigger project.
//
// A still-open task pinned to this date with no specific time
// (isAllDayTask) has nothing meaningful to place on a minute scale — it
// renders in its own compact strip above the scaled area instead, via
// AllDayRow.jsx (same {tasks, onSelect, onStatusChange} shape as the
// page's actual All Day section, just a different subset of tasks: these
// still have a real due_date, All Day's don't).
//
// Auto-fits the scale to this day's own earliest start / latest end
// (rounded out to the hour, plus half an hour of padding) rather than a
// fixed midnight-to-midnight axis — a typical daytime-only schedule
// would otherwise be a small cluster of blocks lost in a mostly-empty
// 24-hour column.
//
// Tapping a block opens the peek modal (onSelect) rather than expanding
// details inline the way TaskRow normally does — a block's height is
// fixed to its time span, and full task details (notes, checklist,
// clarifications) don't fit inside that without breaking the layout.
export default function DayTimeline({ tasks, onSelect, onStatusChange, overlappingIds }) {
  const untimed = tasks.filter((t) => t.status !== 'done' && isAllDayTask(t))
  const timed = tasks.filter((t) => !(t.status !== 'done' && isAllDayTask(t)))

  const layout = useMemo(() => {
    if (!timed.length) return null

    const items = timed.map((task) => {
      const start = new Date(task.status === 'done' ? task.completed_at : task.due_date)
      const end = new Date(start.getTime() + (task.duration_minutes || POINT_TASK_MINUTES) * 60000)
      return { task, start, end }
    })

    const earliestStart = new Date(Math.min(...items.map((i) => i.start.getTime())))
    const latestEnd = new Date(Math.max(...items.map((i) => i.end.getTime())))
    const scaleStart = roundDownToHour(new Date(earliestStart.getTime() - PAD_MINUTES * 60000))
    const scaleEnd = roundUpToHour(new Date(latestEnd.getTime() + PAD_MINUTES * 60000))
    const totalMinutes = (scaleEnd.getTime() - scaleStart.getTime()) / 60000

    const positioned = assignColumns(items).map(({ task, start, end, col, totalCols }) => ({
      task,
      col,
      totalCols,
      top: ((start.getTime() - scaleStart.getTime()) / 60000) * PX_PER_MINUTE,
      height: Math.max(MIN_BLOCK_HEIGHT, ((end.getTime() - start.getTime()) / 60000) * PX_PER_MINUTE),
    }))

    const hourMarks = []
    for (let m = 0; m <= totalMinutes; m += 60) {
      hourMarks.push({
        top: m * PX_PER_MINUTE,
        label: new Date(scaleStart.getTime() + m * 60000).toLocaleTimeString([], { hour: 'numeric' }),
      })
    }

    return { positioned, hourMarks, height: totalMinutes * PX_PER_MINUTE }
  }, [timed])

  return (
    <div className="day-timeline-wrap">
      {untimed.length > 0 && <AllDayRow tasks={untimed} onSelect={onSelect} onStatusChange={onStatusChange} />}

      {layout && (
        <div className="day-timeline" style={{ height: layout.height }}>
          <div className="day-timeline-hours">
            {layout.hourMarks.map((h) => (
              <span key={h.top} className="day-timeline-hour-label" style={{ top: h.top }}>
                {h.label}
              </span>
            ))}
          </div>

          <div className="day-timeline-track">
            {layout.hourMarks.map((h) => (
              <span key={h.top} className="day-timeline-hour-line" style={{ top: h.top }} />
            ))}

            {layout.positioned.map(({ task, top, height, col, totalCols }) => {
              const overlapping = overlappingIds?.has(task.id) ?? false
              const classes = ['day-timeline-block']
              if (overlapping) classes.push('day-timeline-block-overlapping')
              if (task.status === 'done') classes.push('day-timeline-block-done')
              return (
                <div
                  key={task.id}
                  className={classes.join(' ')}
                  style={{
                    top,
                    height,
                    left: `${(col / totalCols) * 100}%`,
                    width: `${100 / totalCols}%`,
                    borderLeftColor: overlapping ? '#e0a83e' : PRIORITY_COLOR[task.priority],
                  }}
                >
                  <input
                    type="checkbox"
                    className="task-done-checkbox"
                    checked={task.status === 'done'}
                    onChange={() => onStatusChange(task.id, task.status === 'done' ? 'to_do' : 'done')}
                  />
                  <button type="button" className="day-timeline-block-body" onClick={() => onSelect(task)}>
                    <span className="task-who-badge" style={{ background: WHO_COLOR[task.who] }}>
                      {WHO_LABEL[task.who]}
                    </span>
                    <span className="day-timeline-block-title">{task.title}</span>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

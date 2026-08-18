import { useMemo } from 'react'
import { isAllDayTask, formatDuration } from '../lib/tasks'
import { PRIORITY_COLOR, PRIORITY_LABEL } from '../lib/priorityColors'
import { WHO_LABEL, WHO_COLOR } from '../lib/whoLabels'
import { zoneAbbreviation, zoneLabel } from '../lib/timezone'
import AllDayRow from './AllDayRow'

const PX_PER_MINUTE = 1.2
// Point-in-time tasks (no duration) get sized as if they were this long,
// purely for a legible minimum block height — not a real duration, and
// not what getOverlappingTaskIds uses to decide the "⚠ Overlap" badge.
const POINT_TASK_MINUTES = 30
// Tall enough for a title to wrap to its full 2 lines (see
// .day-timeline-block-title's line-clamp) without the block's own fixed
// height clipping the second line off partway through — a hard 1-line
// ellipsis on a title like "Hi Aaron I need a chapel for my husband's
// service..." threw away most of it with no way to read the rest short
// of clicking in, which defeats the point of a glanceable block.
const MIN_BLOCK_HEIGHT = 46
// Breathing room added around each busy window (see buildWindows below)
// so a block isn't flush against the window's own top/bottom edge.
const PAD_MINUTES = 20
// A real gap between tasks shorter than this still renders at the normal
// proportional scale (a 20-40min gap between two tasks is normal daily
// texture, not something worth collapsing). Anything longer collapses
// into a fixed-height marker instead — otherwise a single early-morning
// task and a single evening one would force a mostly-empty multi-hour
// scroll between them, burying whatever's on the other side of the gap.
const GAP_THRESHOLD_MINUTES = 90
const GAP_MARKER_HEIGHT = 30

// "Completed 10:00 PM" for a finished task (start is completed_at, a
// single instant — a range would misleadingly imply it was still in
// progress the whole time), "10:00–10:40 PM" for a real duration, or
// just "10:00 PM" for a point-in-time task — never the fake
// POINT_TASK_MINUTES sizing used purely for a legible minimum block
// height, which isn't a real duration worth stating as one.
function blockTimeLabel(task, start, end) {
  const fmt = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (task.status === 'done') return `Completed ${fmt(start)}`
  if (task.duration_minutes) return `${fmt(start)}–${fmt(end)}`
  return fmt(start)
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

// Merges task intervals into "busy windows" — any two tasks (or an
// already-merged window and the next task) less than GAP_THRESHOLD_
// MINUTES apart join the same window; anything further apart starts a
// new one. What's left between windows is exactly the gaps worth
// collapsing.
function buildWindows(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start)
  const windows = []
  for (const item of sorted) {
    const last = windows[windows.length - 1]
    if (last && (item.start.getTime() - last.end.getTime()) / 60000 <= GAP_THRESHOLD_MINUTES) {
      if (item.end > last.end) last.end = item.end
    } else {
      windows.push({ start: item.start, end: item.end })
    }
  }
  return windows
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
// The scale isn't one continuous line from the first task to the last —
// long empty stretches (see GAP_THRESHOLD_MINUTES) collapse into a fixed-
// height "X gap" marker instead of taking up their real proportional
// height, which otherwise buried a later task at the bottom of a long,
// mostly-empty scroll whenever the day had a big hole in it (e.g. one
// task at 12:15 AM and the next at 11 PM). Busy stretches still lay out
// at the normal per-minute scale; only the empty space between them
// compresses.
//
// Tapping a block opens the peek modal (onSelect) rather than expanding
// details inline the way TaskRow normally does — a block's height is
// fixed to its time span, and full task details (notes, checklist,
// clarifications) don't fit inside that without breaking the layout.
export default function DayTimeline({ tasks, onSelect, onStatusChange, overlappingIds, meId }) {
  const untimed = tasks.filter((t) => t.status !== 'done' && isAllDayTask(t))
  const timed = tasks.filter((t) => !(t.status !== 'done' && isAllDayTask(t)))

  const layout = useMemo(() => {
    if (!timed.length) return null

    const items = timed.map((task) => {
      const start = new Date(task.status === 'done' ? task.completed_at : task.due_date)
      const end = new Date(start.getTime() + (task.duration_minutes || POINT_TASK_MINUTES) * 60000)
      return { task, start, end }
    })

    // Windows merge based on the tasks' own real start/end times, before
    // any padding is added — padding is cosmetic and shouldn't influence
    // whether two tasks count as "close together."
    const windows = buildWindows(items).map((w) => ({
      start: new Date(w.start.getTime() - PAD_MINUTES * 60000),
      end: new Date(w.end.getTime() + PAD_MINUTES * 60000),
    }))

    // Lays out windows and the collapsed-gap markers between them along
    // one pixel axis, then timeToPx maps any real Date within a window
    // back to its position on that axis — every task's start/end always
    // falls inside some window since windows were built from exactly
    // those times, so this never needs a fallback case.
    let cursor = 0
    const windowLayouts = []
    const gapMarkers = []
    windows.forEach((w, i) => {
      const durationMin = (w.end.getTime() - w.start.getTime()) / 60000
      windowLayouts.push({ start: w.start, end: w.end, pxStart: cursor })
      cursor += durationMin * PX_PER_MINUTE

      const next = windows[i + 1]
      if (next) {
        const gapMinutes = (next.start.getTime() - w.end.getTime()) / 60000
        if (gapMinutes > 0) {
          gapMarkers.push({ top: cursor, minutes: gapMinutes })
          cursor += GAP_MARKER_HEIGHT
        }
      }
    })
    const totalHeight = cursor

    function timeToPx(date) {
      const t = date.getTime()
      const w = windowLayouts.find((win) => t >= win.start.getTime() && t <= win.end.getTime())
      return w.pxStart + ((t - w.start.getTime()) / 60000) * PX_PER_MINUTE
    }

    const positioned = assignColumns(items).map(({ task, start, end, col, totalCols }) => ({
      task,
      start,
      end,
      col,
      totalCols,
      top: timeToPx(start),
      height: Math.max(MIN_BLOCK_HEIGHT, timeToPx(end) - timeToPx(start)),
    }))

    const hourMarks = []
    for (const w of windowLayouts) {
      for (let h = roundUpToHour(w.start); h <= w.end; h = new Date(h.getTime() + 60 * 60000)) {
        hourMarks.push({ top: timeToPx(h), label: h.toLocaleTimeString([], { hour: 'numeric' }) })
      }
    }

    return { positioned, hourMarks, gapMarkers, height: totalHeight }
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

            {layout.gapMarkers.map((g) => (
              <div key={g.top} className="day-timeline-gap" style={{ top: g.top, height: GAP_MARKER_HEIGHT }}>
                <span className="day-timeline-gap-line" />
                <span className="day-timeline-gap-label">{formatDuration(Math.round(g.minutes))} gap</span>
                <span className="day-timeline-gap-line" />
              </div>
            ))}

            {layout.positioned.map(({ task, start, end, top, height, col, totalCols }) => {
              const overlapping = overlappingIds?.has(task.id) ?? false
              const classes = ['day-timeline-block']
              if (overlapping) classes.push('day-timeline-block-overlapping')
              if (task.status === 'done') classes.push('day-timeline-block-done')
              const checklist = task.checklist || []
              const checklistDone = checklist.filter((item) => item.done).length
              const hasNotes = Boolean(task.notes)
              // Same rule as TaskRow.jsx's own 💬 badge — an unanswered,
              // unresolved message directed at whoever's looking right now.
              const hasQuestionForMe = (task.clarifications || []).some(
                (c) => !c.answer && !c.resolved && c.askedBy !== meId,
              )
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
                  title={PRIORITY_LABEL[task.priority]}
                >
                  <input
                    type="checkbox"
                    className="task-done-checkbox"
                    checked={task.status === 'done'}
                    onChange={() => onStatusChange(task.id, task.status === 'done' ? 'to_do' : 'done')}
                  />
                  {/* Two rows, not one — title always shows (as before);
                      everything else is "as much as fits" rather than a
                      fixed set, since a block's height is whatever its
                      real time span happens to be. The parent's own
                      overflow: hidden clips this second row away on the
                      shortest blocks (a bare 15-30min task) without any
                      extra logic needed to detect that case. */}
                  <button type="button" className="day-timeline-block-body" onClick={() => onSelect(task)}>
                    <span className="day-timeline-block-top">
                      <span className="task-who-badge" style={{ background: WHO_COLOR[task.who] }}>
                        {WHO_LABEL[task.who]}
                      </span>
                      <span className="day-timeline-block-title">{task.title}</span>
                    </span>
                    <span className="day-timeline-block-meta">
                      <span>{blockTimeLabel(task, start, end)}</span>
                      {!isAllDayTask(task) && (
                        <span className="task-zone-badge" title={`Set in ${zoneLabel(task.due_timezone)}`}>
                          {zoneAbbreviation(task.due_timezone)}
                        </span>
                      )}
                      {checklist.length > 0 && (
                        <span className="day-timeline-block-checklist" title="Subtasks">
                          ☑ {checklistDone}/{checklist.length}
                        </span>
                      )}
                      {hasNotes && (
                        <span title="Has notes" aria-label="Has notes">
                          📝
                        </span>
                      )}
                      {hasQuestionForMe && (
                        <span title="Has something for you to reply to" aria-label="Has something for you to reply to">
                          💬
                        </span>
                      )}
                    </span>
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

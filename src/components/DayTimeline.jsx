import { useMemo } from 'react'
import { isAllDayTask, formatDuration } from '../lib/tasks'
import { PRIORITY_COLOR, PRIORITY_LABEL } from '../lib/priorityColors'
import { WHO_LABEL, WHO_COLOR } from '../lib/whoLabels'
import { zoneAbbreviation, zoneLabel, DEFAULT_TIMEZONE } from '../lib/timezone'
import AllDayRow from './AllDayRow'

const PX_PER_MINUTE = 1.2
// Point-in-time tasks (no duration) get sized as if they were this long,
// purely for a legible minimum block height — not a real duration, and
// not what getOverlappingTaskIds uses to decide the "⚠ Overlap" badge.
const POINT_TASK_MINUTES = 30
// Tall enough for a title to wrap to its full 2 lines (see
// .day-timeline-block-title's line-clamp) *and* for the right-hand
// date/time/zone column's own 2 lines (date above, time+zone-badge
// below — the badge's border+padding needs a bit more room than plain
// text) to fit without either getting clipped by the block's own fixed
// height. Verified empirically against both, not just estimated —46
// fit the title alone but clipped the date+time+badge column once that
// was added.
const MIN_BLOCK_HEIGHT = 58
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
//
// Formatted in the task's own due_timezone, not the viewer's — the
// block's *position* on the timeline is deliberately viewer-local
// (it's placed where this lands in the day the viewer is actually
// looking at), but the time/zone badge's whole job is "can I trust
// this was scheduled right in the zone it says it's in," which a
// silently-converted time right next to that zone's abbreviation
// actively defeats: a task set for 10 PM–2 AM Eastern showed as
// "10:00 AM–2:00 PM" next to an "ET" badge for a viewer ~12 hours
// away, reading as if 10 AM–2 PM *was* Eastern time. A completed
// task shows completed_at in the viewer's own zone instead — that's
// when it was actually finished in the real world, not tied to
// whatever zone the original due time was set in.
function blockTimeLabel(task, start, end, dueTimeZone) {
  if (task.status === 'done') {
    const fmt = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    return `Completed ${fmt(start)}`
  }
  const fmt = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: dueTimeZone })
  if (task.duration_minutes) return `${fmt(start)}–${fmt(end)}`
  return fmt(start)
}

// "Tue 08/18/26" — same zone basis as blockTimeLabel above — a task set
// for late evening in a zone hours ahead of the viewer's can land on a
// different calendar date there than the block's own viewer-local
// position on the day grid might suggest. toLocaleDateString inserts a
// comma after the weekday by default ("Tue, 08/18/26"); stripped since
// the requested format is space-separated.
function blockDateLabel(task, start, dueTimeZone) {
  const opts = { weekday: 'short', year: '2-digit', month: '2-digit', day: '2-digit' }
  if (task.status !== 'done') opts.timeZone = dueTimeZone
  return start.toLocaleDateString('en-US', opts).replace(', ', ' ')
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
//
// Clusters on clusterEnd, not each item's real end — every block renders
// at least MIN_BLOCK_HEIGHT tall regardless of its real/synthetic
// duration (see clusterEnd's own definition below), and this needs to
// see that same effective span to decide who actually needs a separate
// column. Using the raw end here let two tasks whose real times didn't
// overlap still end up sharing one column with visually colliding
// rendered boxes once each was clamped up to MIN_BLOCK_HEIGHT — most
// visible among several tasks completed within a short window of each
// other, where completed_at's synthetic point-task span is often
// shorter than MIN_BLOCK_HEIGHT actually renders as.
function assignColumns(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.clusterEnd - b.clusterEnd)
  const result = []
  let cluster = []
  let clusterMax = null

  function flushCluster() {
    if (!cluster.length) return
    const columnEnds = []
    const withCols = cluster.map((item) => {
      let col = columnEnds.findIndex((end) => item.start >= end)
      if (col === -1) {
        col = columnEnds.length
        columnEnds.push(item.clusterEnd)
      } else {
        columnEnds[col] = item.clusterEnd
      }
      return { ...item, col }
    })
    const totalCols = columnEnds.length
    for (const item of withCols) result.push({ ...item, totalCols })
    cluster = []
  }

  for (const item of sorted) {
    if (cluster.length && item.start < clusterMax) {
      cluster.push(item)
      if (item.clusterEnd > clusterMax) clusterMax = item.clusterEnd
    } else {
      flushCluster()
      cluster = [item]
      clusterMax = item.clusterEnd
    }
  }
  flushCluster()
  return result
}

// Merges task intervals into "busy windows" — any two tasks (or an
// already-merged window and the next task) less than GAP_THRESHOLD_
// MINUTES apart join the same window; anything further apart starts a
// new one. What's left between windows is exactly the gaps worth
// collapsing. Uses clusterEnd (see assignColumns above) so a window
// reserves enough pixel space for every block's real rendered height,
// not just its raw duration.
function buildWindows(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start)
  const windows = []
  for (const item of sorted) {
    const last = windows[windows.length - 1]
    if (last && (item.start.getTime() - last.end.getTime()) / 60000 <= GAP_THRESHOLD_MINUTES) {
      if (item.clusterEnd > last.end) last.end = item.clusterEnd
    } else {
      windows.push({ start: item.start, end: item.clusterEnd })
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
      // The floor every block actually renders at (MIN_BLOCK_HEIGHT),
      // expressed as a Date so clustering/window logic can compare it
      // against other tasks' real times directly — see assignColumns.
      const minEnd = new Date(start.getTime() + (MIN_BLOCK_HEIGHT / PX_PER_MINUTE) * 60000)
      const clusterEnd = end > minEnd ? end : minEnd
      return { task, start, end, clusterEnd }
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
                  {/* Time/zone live in their own fixed right-hand column
                      (day-timeline-block-time), not stacked below the
                      title — a title long enough to wrap its full 2 lines
                      would otherwise eat all the block's vertical room
                      and push the time/zone out entirely, which is
                      exactly backwards: those are the two things worth
                      the most "can I trust this is scheduled right at a
                      glance" value. Checklist/notes/question indicators
                      stay in a secondary row below the title — genuinely
                      optional context, fine to lose on the shortest
                      blocks the same way it always has been. */}
                  <button type="button" className="day-timeline-block-body" onClick={() => onSelect(task)}>
                    <span className="day-timeline-block-main">
                      <span className="day-timeline-block-top">
                        <span className="task-who-badge" style={{ background: WHO_COLOR[task.who] }}>
                          {WHO_LABEL[task.who]}
                        </span>
                        <span className="day-timeline-block-title">{task.title}</span>
                      </span>
                      {(checklist.length > 0 || hasNotes || hasQuestionForMe) && (
                        <span className="day-timeline-block-meta">
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
                            <span
                              title="Has something for you to reply to"
                              aria-label="Has something for you to reply to"
                            >
                              💬
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                    <span className="day-timeline-block-time">
                      <span className="day-timeline-block-date">
                        {blockDateLabel(task, start, task.due_timezone || DEFAULT_TIMEZONE)}
                      </span>
                      <span className="day-timeline-block-time-row">
                        <span>{blockTimeLabel(task, start, end, task.due_timezone || DEFAULT_TIMEZONE)}</span>
                        {!isAllDayTask(task) && (
                          <span className="task-zone-badge" title={`Set in ${zoneLabel(task.due_timezone)}`}>
                            {zoneAbbreviation(task.due_timezone)}
                          </span>
                        )}
                      </span>
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

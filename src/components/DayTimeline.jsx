import { useMemo } from 'react'
import { CheckSquare, StickyNote, MessageCircle } from 'lucide-react'
import { isAllDayTask, formatDuration } from '../lib/tasks'
import { PRIORITY_COLOR, PRIORITY_LABEL } from '../lib/priorityColors'
import { WHO_LABEL, WHO_COLOR } from '../lib/whoLabels'
import { zoneAbbreviation, zoneLabel, splitDueDateInZone, DEFAULT_TIMEZONE } from '../lib/timezone'
import AllDayRow from './AllDayRow'
import TaskIcon from './TaskIcon'

// 2.5 (150px/hour), not the original 1.2 (72px/hour) — too cramped to
// read comfortably on a phone, and worse, it made MIN_BLOCK_HEIGHT's
// fixed 58px floor (see below) equivalent to ~48 real minutes. Since
// assignColumns has to cluster on that floored height, not each task's
// real end (see its own comment below for why), two genuinely separate
// point-in-time tasks as little as 20-30 minutes apart — e.g. one at
// 1:30 AM, another at 2:00 AM — were landing inside the same 48-minute
// "cluster" purely because of the legibility floor, and rendering side
// by side in split columns as if they actually conflicted. At 2.5px/min
// the same 58px floor is only ~23 real minutes, well under
// POINT_TASK_MINUTES (30) — so a point task's own synthetic 30-minute
// span is what actually ends up driving clusterEnd, not the floor, and
// two tasks a real 30+ minutes apart stop spuriously colliding. A task
// with a real stated duration is affected the same way: at the old
// scale, a real 30-minute task (e.g. "2:30–3:00 AM") still got its
// clusterEnd floored up to 48 minutes' worth of layout space even
// though the label next to it said 30 — the rendered block was taller
// than the time it claimed to cover. 30 real minutes already clears the
// new, smaller floor, so the block's height and its own label agree.
const PX_PER_MINUTE = 2.5
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
// was added. A fixed pixel value, not minutes — see PX_PER_MINUTE above
// for why its real-minute equivalent matters just as much as its own
// value.
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
// Even a short positive gap needs enough room to carry its duration
// label. Without this floor, a 5-minute gap was only 12.5px tall and the
// label either collided with a block or had to disappear.
const GAP_LABEL_MIN_HEIGHT = 22
// Fixed height reserved between two stacked blocks that are a *genuine*
// overlap (both ids present in overlappingIds — real durations that
// actually intersect, not just close enough to trip the legibility
// floor) — see the "Tasks are overlapping" label below. Blocks in the
// same stack that don't clear that bar still render directly flush
// against each other, no label, same as any other back-to-back pair.
const OVERLAP_LABEL_HEIGHT = 22
// Task cards are deliberately fixed-height. The timeline is an agenda
// overview, so elapsed hours belong in the start/end label rather than
// being represented as empty vertical space inside the card.
const TASK_BLOCK_HEIGHT = MIN_BLOCK_HEIGHT

// "Completed 10:00 PM" for a finished task — always the real
// completed_at instant, read straight off the task rather than derived
// from `start` (which is always due_date now — see the layout useMemo
// below, and tasks.js's getTasksForDay for why a task's *position*
// no longer follows it to wherever it actually got finished). The two
// are deliberately decoupled: the block still sits where it was
// scheduled, but the label states honestly when it was actually done,
// even if that's a different day entirely. "10:00–10:40 PM" for a real
// duration, or just "10:00 PM" for a point-in-time task — never the
// fake POINT_TASK_MINUTES sizing used purely for a legible minimum block
// height, which isn't a real duration worth stating as one.
//
// Formatted in the task's own due_timezone, not the viewer's, for the
// still-open cases — the time/zone badge's whole job is "can I trust
// this was scheduled right in the zone it says it's in," which a
// silently-converted time right next to that zone's abbreviation
// actively defeats: a task set for 10 PM–2 AM Eastern showed as
// "10:00 AM–2:00 PM" next to an "ET" badge for a viewer ~12 hours
// away, reading as if 10 AM–2 PM *was* Eastern time. "Completed" shows
// completed_at in the viewer's own zone instead — that's when it was
// actually finished in the real world, not tied to whatever zone the
// original due time was set in.
// A task whose real duration (not its compact render height) crosses
// into another calendar day gets a compact day offset after its end
// time: "10:55 PM–2:00 AM +1". Longer tasks naturally become +2, +3,
// and so on. Compared in due_timezone, matching every other zone-aware
// label here (blockDateLabel, the badge).
function blockTimeLabel(task, start, end, displayTimezone) {
  if (task.status === 'done') {
    const fmt = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: displayTimezone })
    return `Completed ${fmt(new Date(task.completed_at))}`
  }
  const fmt = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (!task.duration_minutes) return fmt(start)
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
  const dayOffset = Math.round((endDay - startDay) / 86400000)
  return (
    <>
      {fmt(start)}–{fmt(end)}
      {dayOffset > 0 && <sup className="day-timeline-day-offset">+{dayOffset}</sup>}
    </>
  )
}

// "Tue 08/18/26" — start is always due_date now (see blockTimeLabel
// above), so this always reads in due_timezone regardless of done
// status; a task set for late evening in a zone hours ahead of the
// viewer's can still land on a different calendar date there than
// where the block's own position (also due_date-based) might suggest.
// toLocaleDateString inserts a comma after the weekday by default
// ("Tue, 08/18/26"); stripped since the requested format is
// space-separated.
function blockDateLabel(start) {
  const opts = { weekday: 'short', year: '2-digit', month: '2-digit', day: '2-digit' }
  return start.toLocaleDateString('en-US', opts).replace(', ', ' ')
}

// A Date carrying the wall-clock fields for an instant in the selected
// display timezone. The timeline layout uses Date arithmetic/getHours,
// which otherwise follow the device timezone and would not move when the
// user's saved default changes.
function wallClockDate(isoString, timeZone) {
  const { due_date, due_time } = splitDueDateInZone(isoString, timeZone)
  return new Date(`${due_date}T${due_time}:00`)
}

function roundUpToHour(date) {
  const d = new Date(date)
  if (d.getMinutes() > 0 || d.getSeconds() > 0 || d.getMilliseconds() > 0) d.setHours(d.getHours() + 1)
  d.setMinutes(0, 0, 0)
  return d
}

// Sweeps tasks in start order, grouping any that are "close enough" —
// see clusterEnd's own definition below — into a cluster. Used to be the
// first half of a "meeting rooms" side-by-side-columns layout; now every
// member of a cluster renders full-width, stacked one after another
// instead (see layoutClusters below and Part B of the plan this came
// from — Structured's own timeline doesn't split overlapping tasks into
// narrower columns either, it keeps them full-width and labels the
// overlap in plain text).
//
// Clusters on clusterEnd, not each item's real end — every block renders
// at least MIN_BLOCK_HEIGHT tall regardless of its real/synthetic
// duration (see clusterEnd's own definition below), and this still needs
// to see that same effective span to decide who actually needs to stack
// directly against the previous item. Using the raw end here let two
// tasks whose real times didn't overlap still end up with visually
// colliding rendered boxes once each was clamped up to MIN_BLOCK_HEIGHT
// — most visible among several point tasks due within a short window of
// each other, where the synthetic POINT_TASK_MINUTES span is often
// shorter than MIN_BLOCK_HEIGHT actually renders as.
function groupIntoClusters(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.clusterEnd - b.clusterEnd)
  const clusters = []
  let current = []
  let clusterMax = null

  for (const item of sorted) {
    if (current.length && item.start < clusterMax) {
      current.push(item)
      if (item.clusterEnd > clusterMax) clusterMax = item.clusterEnd
    } else {
      if (current.length) clusters.push(current)
      current = [item]
      clusterMax = item.clusterEnd
    }
  }
  if (current.length) clusters.push(current)
  return clusters
}

// Lays every cluster out top to bottom in one sequential sweep, rather
// than mapping arbitrary real timestamps onto one shared linear pixel
// axis the way the original single-item design could (a plain
// `timeToPx(date)` function). Once a cluster can occupy a *different*
// amount of vertical space than its own real elapsed time — stacking N
// members takes N block-heights, not the real time between the first
// start and the last end — no single real timestamp reliably maps to
// one pixel position across a cluster boundary any more (a task
// starting shortly after a big stack would land *inside* that stack's
// own rendered range under the old linear-window math). Walking
// cluster-by-cluster and accumulating pixel position directly sidesteps
// that instead of trying to patch it.
//
// Cross-cluster gaps use each cluster's real chronological end (the max
// of its members' real `end`, not the MIN_BLOCK_HEIGHT-floored
// clusterEnd) — using the floored version here would reintroduce the
// exact "legibility floor treated as real busy time" distortion Part A
// of this file's own PX_PER_MINUTE fix already went after, just between
// clusters instead of within one.
//
// overlappingIds (getOverlappingTaskIds's own result, passed straight
// through as a prop) is what decides where the "Tasks are overlapping"
// label actually appears — keyed off real, duration-based conflicts
// only, not just "close enough to need stacking." Two point tasks 25
// minutes apart still stack (there's no room to render them at their
// real proportional distance without colliding), but they aren't a
// genuine scheduling conflict, so no label between them; a real
// duration pair that actually intersects gets one. Every positive empty
// stretch between clusters gets a labelled gap marker: short gaps retain
// their proportional height (with a small legibility floor), while long
// ones collapse to GAP_MARKER_HEIGHT.
function layoutClusters(clusters, overlappingIds) {
  let cursor = PAD_MINUTES * PX_PER_MINUTE
  const positioned = []
  const gapMarkers = []
  const hourMarks = []
  const overlapLabels = []
  let prevRealEnd = null
  // A gap segment's own tick loop and the cluster right after it can
  // both land a tick on the exact same hour — the gap's inclusive
  // upper bound is that cluster's own start, which is also where the
  // cluster's tick loop starts counting from. Deduping by real time
  // (not by pixel top, which is also identical in that case) keeps
  // each hour appearing once, regardless of which segment generated it.
  const seenHourTimes = new Set()

  function pushHourTicks(fromReal, toReal, pxAtFrom) {
    for (let h = roundUpToHour(fromReal); h <= toReal; h = new Date(h.getTime() + 3600000)) {
      const t = h.getTime()
      if (seenHourTimes.has(t)) continue
      seenHourTimes.add(t)
      hourMarks.push({
        top: pxAtFrom + ((t - fromReal.getTime()) / 60000) * PX_PER_MINUTE,
        label: h.toLocaleTimeString([], { hour: 'numeric' }),
      })
    }
  }

  clusters.forEach((cluster) => {
    const clusterStart = cluster[0].start

    if (prevRealEnd) {
      const gapMinutes = (clusterStart.getTime() - prevRealEnd.getTime()) / 60000
      if (gapMinutes > 0) {
        const collapsed = gapMinutes > GAP_THRESHOLD_MINUTES
        const proportionalHeight = gapMinutes * PX_PER_MINUTE
        const markerHeight = collapsed ? GAP_MARKER_HEIGHT : Math.max(proportionalHeight, GAP_LABEL_MIN_HEIGHT)
        if (!collapsed) pushHourTicks(prevRealEnd, clusterStart, cursor)
        // Collapsed: fixed-height marker, no hour ticks inside it (same
        // reasoning as skipping ticks inside a multi-item stack below —
        // there's no real per-pixel time correspondence in a
        // deliberately-compressed placeholder either). The marker's own
        // dashed .day-timeline-gap-line already gives this stretch the
        // connecting-rail treatment, so no separate railSegment here.
        gapMarkers.push({ top: cursor, height: markerHeight, minutes: gapMinutes })
        cursor += markerHeight
      }
    }

    const clusterPxStart = cursor
    // Task cards are fixed-height, so there is intentionally no hourly
    // grid inside them. Their start/end label carries the exact timing.

    let stackTop = clusterPxStart
    let clusterRealEnd = cluster[0].end
    cluster.forEach((item, idx) => {
      // Checked against every earlier member of this stack, not just the
      // item directly above it — a stack can hold more than 2 tasks (this
      // is a two-person board; a third, unrelated task easily sorts
      // in between two people's genuinely-conflicting ones by start
      // time), and the immediate-neighbor-only version of this check
      // missed a real conflict whenever that happened, even though both
      // tasks' own amber borders (driven by the same overlappingIds
      // prop, checked independently per block below) still rendered
      // correctly. Still requires both ids in overlappingIds (not just a
      // recomputed time-overlap) so this stays consistent with that
      // detector's own filters — e.g. a point task with no real
      // duration_minutes never counts, matching getOverlappingTaskIds.
      const conflictsWithEarlier = cluster.slice(0, idx).some(
        (other) =>
          overlappingIds?.has(other.task.id) &&
          overlappingIds?.has(item.task.id) &&
          other.task.who === item.task.who &&
          item.start.getTime() < other.end.getTime() &&
          other.start.getTime() < item.end.getTime(),
      )
      if (conflictsWithEarlier) {
        overlapLabels.push({ top: stackTop, height: OVERLAP_LABEL_HEIGHT })
        stackTop += OVERLAP_LABEL_HEIGHT
      }
      const height = TASK_BLOCK_HEIGHT
      positioned.push({ ...item, top: stackTop, height })
      stackTop += height
      if (item.end > clusterRealEnd) clusterRealEnd = item.end
    })

    cursor = stackTop
    prevRealEnd = clusterRealEnd
  })

  return {
    positioned,
    hourMarks,
    gapMarkers,
    overlapLabels,
    height: cursor + PAD_MINUTES * PX_PER_MINUTE,
  }
}

// Day mode's task list, drawn as a real time-scaled timeline rather than
// a flat stack of rows (see TimelineRow.jsx, still used for Overdue and
// for Week mode's day-sections) — tasks are positioned by actual start
// time and sized by actual duration. Two that are close enough to need
// stacking render full-width, one after another (not split into
// narrower side-by-side columns — see groupIntoClusters/layoutClusters
// below), and a genuine overlap (real, duration-based conflicts only,
// via the overlappingIds prop) gets an explicit "Tasks are overlapping"
// label between them instead of relying on an "⚠ Overlap" badge alone.
// Scoped to Day mode only; a scaled view per day for Week mode's 7
// sections is a separate, bigger project.
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
export default function DayTimeline({ tasks, onSelect, onStatusChange, overlappingIds, meId, displayTimezone = DEFAULT_TIMEZONE }) {
  const untimed = tasks.filter((t) => t.status !== 'done' && isAllDayTask(t))
  const timed = tasks.filter((t) => !(t.status !== 'done' && isAllDayTask(t)))

  const layout = useMemo(() => {
    if (!timed.length) return null

    const items = timed.map((task) => {
      // Always due_date, even once done — a task's position on the
      // timeline stays where it was scheduled regardless of when it
      // actually got finished (see getTasksForDay in tasks.js). The
      // label still states the real completed_at separately —
      // blockTimeLabel reads that straight off `task`, not `start`.
      const start = wallClockDate(task.due_date, displayTimezone)
      const end = new Date(start.getTime() + (task.duration_minutes || POINT_TASK_MINUTES) * 60000)
      // The floor every block actually renders at (MIN_BLOCK_HEIGHT),
      // expressed as a Date so clustering/window logic can compare it
      // against other tasks' real times directly. Real duration still
      // drives overlap grouping even though every card has one height.
      const minEnd = new Date(start.getTime() + (MIN_BLOCK_HEIGHT / PX_PER_MINUTE) * 60000)
      const clusterEnd = end > minEnd ? end : minEnd
      const truncated = Boolean(task.duration_minutes) && end > minEnd
      return { task, start, end, truncated, clusterEnd }
    })

    return layoutClusters(groupIntoClusters(items), overlappingIds)
  }, [timed, overlappingIds, displayTimezone])

  return (
    <div className="day-timeline-wrap">
      {untimed.length > 0 && <AllDayRow tasks={untimed} onSelect={onSelect} onStatusChange={onStatusChange} />}

      {layout && (
        <div className="day-timeline" style={{ height: layout.height }}>
          <div className="day-timeline-hours">
            <span
              className="day-timeline-time-rail"
              style={{
                top: layout.positioned[0].top + 10,
                height:
                  Math.max(...layout.positioned.map((item) => item.top + item.height)) -
                  (layout.positioned[0].top + 10),
              }}
              aria-hidden="true"
            />
            {layout.gapMarkers.map((gap) => (
              <span
                key={`time-gap-${gap.top}`}
                className="day-timeline-time-rail-gap"
                style={{ top: gap.top, height: gap.height }}
                aria-hidden="true"
              />
            ))}
            {layout.positioned.map((item) => (
              <span
                key={`time-dot-${item.task.id}`}
                className="day-timeline-time-dot"
                style={{ top: item.top + 10, background: PRIORITY_COLOR[item.task.priority] }}
                aria-hidden="true"
              />
            ))}
            {layout.hourMarks
              .filter((h) => !layout.positioned.some((item) => Math.abs(item.top - h.top) < 8))
              .map((h) => (
              <span key={h.top} className="day-timeline-hour-label" style={{ top: h.top }}>
                {h.label}
              </span>
              ))}
            {layout.positioned.map((item) => (
              <span key={`task-time-${item.task.id}`} className="day-timeline-task-time-label" style={{ top: item.top }}>
                {item.start.toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: item.start.getMinutes() ? '2-digit' : undefined,
                })}
              </span>
            ))}
          </div>

          <div className="day-timeline-track">
            {layout.hourMarks.map((h) => (
              <span key={h.top} className="day-timeline-hour-line" style={{ top: h.top }} />
            ))}

            {layout.gapMarkers.map((g) => (
              <div key={g.top} className="day-timeline-gap" style={{ top: g.top, height: g.height }}>
                <span className="day-timeline-gap-line" />
                <span className="day-timeline-gap-label">{formatDuration(Math.round(g.minutes))} gap</span>
                <span className="day-timeline-gap-line" />
              </div>
            ))}

            {/* A genuine scheduling conflict within a stack — both tasks
                keyed off the real, duration-based overlappingIds prop,
                not just "close enough to need stacking" (see
                layoutClusters). Plain text between the two blocks, no
                extra rail treatment — the label itself is the stronger
                signal here. */}
            {layout.overlapLabels.map((o) => (
              <div key={`overlap-${o.top}`} className="day-timeline-overlap-label" style={{ top: o.top, height: o.height }}>
                Tasks are overlapping
              </div>
            ))}

            {layout.positioned.map(({ task, start, end, truncated, top, height }) => {
              const overlapping = overlappingIds?.has(task.id) ?? false
              const classes = ['day-timeline-block']
              if (overlapping) classes.push('day-timeline-block-overlapping')
              if (task.status === 'done') classes.push('day-timeline-block-done')
              if (truncated) classes.push('day-timeline-block-truncated')
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
                    borderLeftColor: overlapping ? '#e0a83e' : PRIORITY_COLOR[task.priority],
                  }}
                  title={PRIORITY_LABEL[task.priority]}
                >
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
                        <TaskIcon task={task} size={13} className="mt-[3px]" title={PRIORITY_LABEL[task.priority]} />
                        <span className="task-who-badge" style={{ background: WHO_COLOR[task.who] }}>
                          {WHO_LABEL[task.who]}
                        </span>
                        <span className="day-timeline-block-title">{task.title}</span>
                      </span>
                      {(checklist.length > 0 || hasNotes || hasQuestionForMe) && (
                        <span className="day-timeline-block-meta">
                          {checklist.length > 0 && (
                            <span className="day-timeline-block-checklist inline-flex items-center gap-0.5" title="Subtasks">
                              <CheckSquare size={12} /> {checklistDone}/{checklist.length}
                            </span>
                          )}
                          {hasNotes && (
                            <span title="Has notes" aria-label="Has notes">
                              <StickyNote size={12} />
                            </span>
                          )}
                          {hasQuestionForMe && (
                            <span
                              title="Has something for you to reply to"
                              aria-label="Has something for you to reply to"
                            >
                              <MessageCircle size={12} />
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                    <span className="day-timeline-block-time">
                      <span className="day-timeline-block-date">
                        {blockDateLabel(start)}
                      </span>
                      <span className="day-timeline-block-time-row">
                        <span>{blockTimeLabel(task, start, end, displayTimezone)}</span>
                        {!isAllDayTask(task) && (
                          <span className="task-zone-badge" title={`Displayed in ${zoneLabel(displayTimezone)}`}>
                            {zoneAbbreviation(displayTimezone)}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                  {/* Trailing, not leading — same "checkbox on the right"
                      placement TaskRow.jsx's collapsed row now uses. */}
                  <input
                    type="checkbox"
                    className="task-done-checkbox"
                    checked={task.status === 'done'}
                    onChange={() => onStatusChange(task.id, task.status === 'done' ? 'to_do' : 'done')}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

import { supabase } from './supabaseClient'
import { splitDueDateInZone, DEFAULT_TIMEZONE } from './timezone'

const TASK_COLUMNS =
  'id, title, who, status, priority, icon, due_date, due_timezone, duration_minutes, source, source_note, notes, checklist, recurrence, created_by, created_at, updated_at, completed_at, completion_note, completion_attachments, clarifications, overdue_nudge_sent_at'

export async function fetchTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .order('due_date', { ascending: true, nullsFirst: false })

  if (error) throw error
  return data
}

export async function createTask(task) {
  const { data, error } = await supabase.from('tasks').insert(task).select(TASK_COLUMNS).single()
  if (error) throw error
  return data
}

export async function updateTask(id, patch) {
  const { data, error } = await supabase
    .from('tasks')
    .update(patch)
    .eq('id', id)
    .select(TASK_COLUMNS)
    .single()

  if (error) throw error
  return data
}

export async function deleteTask(id) {
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw error
}

// Human label for a task's duration, e.g. 90 -> "1.5 hr", 45 -> "45 min",
// 4320 -> "3 days". A day-plus span reads as days (+ a leftover hr/min
// remainder, if any) rather than e.g. "72 hr" — clearer once durations
// can run multi-day (see TaskForm.jsx's DURATION_OPTIONS/end-time cap).
export function formatDuration(minutes) {
  if (!minutes) return ''
  if (minutes >= 1440) {
    const days = Math.floor(minutes / 1440)
    const remainder = minutes % 1440
    const dayLabel = `${days} day${days > 1 ? 's' : ''}`
    return remainder ? `${dayLabel} ${formatDuration(remainder)}` : dayLabel
  }
  if (minutes % 60 === 0) return `${minutes / 60} hr`
  if (minutes > 60) return `${(minutes / 60).toFixed(1)} hr`
  return `${minutes} min`
}

// Task IDs whose time span overlaps another active task belonging to the
// same person — e.g. breakfast 9:00–9:15 and a shower 9:10–10:00. Only
// tasks with both a due_date and a duration_minutes actually occupy a
// span; point-in-time tasks (no duration) can't conflict with anything.
// Done tasks are excluded — a finished task isn't a live conflict anymore.
// Scoped per-person (`who`), not per currently-viewed tab, since two
// different people having tasks at the same time isn't a real conflict.
export function getOverlappingTaskIds(tasks) {
  // isAllDayTask() excluded explicitly — a multi-day All Day task now
  // also has a (whole-day-multiple) duration, but a date range isn't a
  // scheduled block the way a timed task's span is, so it shouldn't
  // trip overlap detection against anything. duration_minutes is no
  // longer required here (see the aEnd/bEnd fallback below) — a point
  // task used to be excluded from this Set entirely, on either side of
  // a pair, which meant one landing squarely inside another same-person
  // task's real duration (e.g. a point task at 11:30 PM inside a task
  // that runs 11 PM-midnight) never got flagged at all: no ⚠ badge, no
  // amber border, no "Tasks are overlapping" label on the Timeline,
  // even though it's a genuine conflict.
  const timed = tasks.filter((t) => t.status !== 'done' && t.due_date && !isAllDayTask(t))
  const overlapping = new Set()

  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i]
      const b = timed[j]
      if (a.who !== b.who) continue
      // Two tasks with no real duration of their own are each just a
      // single instant — flagging them only when they land on the
      // exact same millisecond isn't a meaningful conflict worth
      // warning about, so this still needs at least one side to have a
      // real span.
      if (!a.duration_minutes && !b.duration_minutes) continue

      const aStart = new Date(a.due_date).getTime()
      // A point task's own end is just its start — a zero-width
      // instant — which the interval-overlap check below already
      // handles correctly (it's "inside" another task's real span
      // whenever that span's start is before it and its end is after),
      // no separate branch needed for the point-vs-duration case.
      const aEnd = a.duration_minutes ? aStart + a.duration_minutes * 60000 : aStart
      const bStart = new Date(b.due_date).getTime()
      const bEnd = b.duration_minutes ? bStart + b.duration_minutes * 60000 : bStart

      if (aStart < bEnd && bStart < aEnd) {
        overlapping.add(a.id)
        overlapping.add(b.id)
      }
    }
  }

  return overlapping
}

// A task created via TaskForm's "All day" checkbox with a specific date
// still gets a real due_date (so it lands in that day's own list via
// getTasksForDay/groupTasksByDay below, rather than floating in the
// separate dateless All Day bucket TaskBoard.jsx renders) — stored at
// exactly midnight in the zone it was set in, with no duration, the one
// combination a genuinely timed task would never intentionally produce.
// There's no dedicated column for this (a deliberate frontend-only
// heuristic, not a schema change), so display code checks this instead of
// rendering a literal "12:00 AM". Checked against due_timezone — the zone
// it was actually set in — rather than the viewer's own local zone, so it
// reads the same for both Ada and Aaron regardless of who's looking; a
// viewer-local check would misfire since their timezones differ by half a
// day. The one accepted tradeoff: a task genuinely, deliberately due at
// exactly midnight with no duration would also read as "All day".
//
// A whole-day-multiple duration (1440, 2880, ...) also still counts as
// All Day — TaskForm.jsx's End date field sets exactly that (see
// daysBetweenDateStrs there) for a task spanning multiple days, e.g. a
// 3-day span with no specific time. A genuinely timed task starting at
// midnight would essentially never land on an exact multiple of a full
// day, so this doesn't meaningfully widen the existing "accepted
// tradeoff" above.
export function isAllDayTask(task) {
  if (!task.due_date) return false
  if (task.duration_minutes && task.duration_minutes % 1440 !== 0) return false
  const { due_time } = splitDueDateInZone(task.due_date, task.due_timezone || DEFAULT_TIMEZONE)
  return due_time === '00:00'
}

export function isOverdue(task) {
  if (!task.due_date || task.status === 'done') return false
  // An All Day task is due sometime that whole day (or, now, its whole
  // span), not at the literal midnight instant it's stored at — without
  // this it'd read as overdue for nearly 24 hours a day, almost as soon
  // as it's created. duration_minutes (already a multiple of a day, or
  // absent) extends that grace to cover a multi-day span's actual length
  // instead of just one flat day regardless of how many it spans.
  if (isAllDayTask(task)) return new Date(task.due_date).getTime() + (task.duration_minutes || 1440) * 60000 <= Date.now()
  return new Date(task.due_date).getTime() < Date.now()
}

// Calendar day (as "YYYY-MM-DD") that `date` falls on in the viewer's own
// local timezone. Used for viewer-local events such as completion timestamps
// and for turning the selected calendar Date into a stable comparison key.
function localDayKey(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// Timed tasks follow the viewer's chosen display timezone. All Day tasks
// remain attached to the calendar date they were created for rather than
// shifting dates, since they represent a day rather than a clock instant.
function taskDueDayKey(task, displayTimezone) {
  const timeZone = isAllDayTask(task) ? task.due_timezone || DEFAULT_TIMEZONE : displayTimezone
  return splitDueDateInZone(task.due_date, timeZone).due_date
}

// Overdue is a "right now" concept, not tied to whichever day is being
// browsed — only ever shown alongside today's view, regardless of due date.
export function getOverdueTasks(tasks, displayTimezone) {
  const nowIso = new Date().toISOString()

  return tasks
    .filter((t) => {
      if (t.status === 'done' || !t.due_date) return false
      const timeZone = isAllDayTask(t) ? t.due_timezone || DEFAULT_TIMEZONE : displayTimezone
      const todayInDisplayZone = splitDueDateInZone(nowIso, timeZone).due_date
      return taskDueDayKey(t, displayTimezone) < todayInDisplayZone
    })
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
}

// A known start-of-period date for the household's actual biweekly
// payroll cycle (confirmed against a real cutoff: paid Aug 12 for
// Jul 26-Aug 8, paid Aug 26 for Aug 9-22) — a Sunday, same as every
// other 14-day boundary counted from it. Fixed-anchor rather than
// "whichever Sunday starts the current week, doubled": without a single
// shared reference point, there's no way to tell which of the two
// candidate Sundays a 14-day cycle should start on, and picking wrong
// would silently misalign every later cutoff too.
// Exported so src/lib/staff.js can anchor payroll-cadence periods to the
// same real biweekly cutoff EOD reports already use, rather than a second,
// independently-drifting anchor.
export const BIWEEKLY_ANCHOR = new Date(2026, 6, 26)

// Start of the current (offset 0) or a past (`offset` whole periods back
// — -1 means "one period ago", etc.) day/week/month/biweekly bucket, in
// the viewer's own local timezone. Week starts Sunday, matching
// DateStrip's weekday order. Biweekly counts whole 14-day blocks elapsed
// since BIWEEKLY_ANCHOR, so every cycle stays aligned to that one fixed
// reference no matter how far past it "now" is — same reasoning as
// rentals.js's addCalendarMonths always computing from a booking's
// original check-in rather than the previous cycle. `setDate(1)` before
// applying a month offset (rather than after) matters: shifting months
// from an arbitrary day-of-month can land on the wrong month when the
// target month has fewer days (e.g. Aug 31 minus a month isn't a real
// date in some months) — day 1 always exists, so pinning to it first
// makes the offset safe regardless of today's date-of-month.
// Exported so src/lib/staff.js can reuse the week/month/biweekly cases for
// payroll-cadence periods instead of reimplementing this same calendar math.
export function startOfPeriod(period, offset = 0) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (period === 'day') d.setDate(d.getDate() + offset)
  if (period === 'week') d.setDate(d.getDate() - d.getDay() + offset * 7)
  if (period === 'month') {
    d.setDate(1)
    d.setMonth(d.getMonth() + offset)
  }
  if (period === 'biweekly') {
    const daysSinceAnchor = Math.floor((d.getTime() - BIWEEKLY_ANCHOR.getTime()) / 86400000)
    const cyclesElapsed = Math.floor(daysSinceAnchor / 14)
    d.setTime(BIWEEKLY_ANCHOR.getTime())
    d.setDate(d.getDate() + (cyclesElapsed + offset) * 14)
  }
  return d
}

// A short label for a day/week/month/biweekly bucket — "This month" for
// the current one (offset 0), the actual date/range otherwise, so
// EndOfDayReportForm.jsx can make clear which bucket a backdated report
// is actually landing on (see getCompletedInPeriod/reportDateForPeriod
// below) rather than leaving it implicit the way "this ___" phrasing
// already does for the current period.
export function periodBucketLabel(period, offset = 0) {
  const start = startOfPeriod(period, offset)
  if (period === 'day') {
    return offset === 0 ? 'Today' : start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  }
  if (period === 'week') {
    if (offset === 0) return 'This week'
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    const startLabel = start.toLocaleDateString([], { month: 'short', day: 'numeric' })
    const endLabel = end.toLocaleDateString([], { month: 'short', day: 'numeric' })
    return `${startLabel} – ${endLabel}`
  }
  if (period === 'month') {
    return offset === 0 ? 'This month' : start.toLocaleDateString([], { month: 'long', year: 'numeric' })
  }
  if (period === 'biweekly') {
    return offset === 0 ? 'This pay period' : start.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return ''
}

// The report_date to bucket an eod_reports row under, in the submitter's
// own local timezone — passed explicitly rather than relying on the
// database's `current_date` default, which evaluates in UTC and would be
// wrong for a meaningful part of every day for Aaron (UTC+8).
export function reportDateForPeriod(period, offset = 0) {
  return localDayKey(startOfPeriod(period, offset))
}

// Completed tasks belonging to a given `who` within a day/week/month
// bucket — the starting draft for a fresh end-of-day/week/month report.
// The current bucket (offset 0) is still bounded by "now", same as
// before (the period isn't over yet); a past bucket (offset < 0, e.g.
// submitting August's report in September because it got missed) is
// bounded by the start of the *next* bucket instead, so it doesn't
// silently pull in everything completed between then and today too.
export function getCompletedInPeriod(tasks, whoKey, period, offset = 0) {
  const start = startOfPeriod(period, offset)
  const end = offset === 0 ? new Date() : startOfPeriod(period, offset + 1)
  return tasks.filter((t) => {
    if (t.who !== whoKey || t.status !== 'done' || !t.completed_at) return false
    const completedAt = new Date(t.completed_at)
    return completedAt >= start && completedAt < end
  })
}

// Like getCompletedInPeriod, but only tasks completed after `since` — used
// when appending to an already-started report, so a second session's
// draft doesn't re-list what an earlier session already reported.
export function getCompletedSince(tasks, whoKey, since) {
  const now = new Date()
  return tasks.filter((t) => {
    if (t.who !== whoKey || t.status !== 'done' || !t.completed_at) return false
    const completedAt = new Date(t.completed_at)
    return completedAt > since && completedAt <= now
  })
}

// Everything due on a given day, done or not — a task stays exactly
// where it was scheduled regardless of when it actually got finished.
// This used to move a completed task to whichever day it was actually
// completed on instead (a household split across timezones means Ada
// assigning something at 3pm her time can land on what's already
// "yesterday" on your calendar, and a task pinned to that original, now-
// past day made it look like nothing got done today even though it
// did) — but relocating a task away from the day it was set for read as
// its own kind of wrong, like the day it was actually scheduled for
// didn't get credit for it. See getCompletedToday below for how "what
// got finished today" is now surfaced instead, without moving anything.
export function getTasksForDay(tasks, date, displayTimezone) {
  const dayKey = localDayKey(date)

  return tasks
    .filter((t) => t.due_date && taskDueDayKey(t, displayTimezone) === dayKey)
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
}

// Tasks completed today (the viewer's own local calendar day), regardless
// of which day they were originally due — the "what actually got done
// today" signal, now that getTasksForDay above always keeps a task on
// its own due day instead of following it to wherever it got finished.
// Surfaced as its own small, separate indicator (TaskBoard.jsx) rather
// than folded back into the day's task list, so a task never has to
// choose between "where it was scheduled" and "credit for finishing it
// today" — it can show both, in two different places, instead of only
// ever being findable in one.
export function getCompletedToday(tasks, displayTimezone) {
  const todayKey = splitDueDateInZone(new Date().toISOString(), displayTimezone).due_date
  return tasks
    .filter(
      (t) =>
        t.status === 'done' &&
        t.completed_at &&
        splitDueDateInZone(t.completed_at, displayTimezone).due_date === todayKey,
    )
    .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))
}

// `count` consecutive day-granularity Date objects starting at `date` —
// the shared building block behind the Multi-Day (3) and Week (7) view
// modes below.
export function getDaysStartingAt(date, count) {
  const days = []
  for (let i = 0; i < count; i++) {
    const d = new Date(date)
    d.setDate(d.getDate() + i)
    days.push(d)
  }
  return days
}

// The 7 days (Sun-Sat) of the calendar week containing `date` — same week
// start as startOfPeriod('week') above and DateStrip's weekday order.
export function getWeekDays(date) {
  const start = new Date(date)
  start.setDate(start.getDate() - start.getDay())
  return getDaysStartingAt(start, 7)
}

// Shared with InboxView.jsx (which writes to it) and TaskBoard.jsx's nav
// badge (which reads it via hasUnseenInboxItems below) — a single key so
// both stay in sync without importing each other.
export const INBOX_LAST_VIEWED_KEY = 'inbox-last-viewed-at'

// Priority for sorting getInboxItems below — needs-a-reply first (most
// actionable), then answered, then finished (already resolved, lowest
// priority — closer to an archive than an inbox).
const INBOX_KIND_ORDER = { question: 0, answer: 1, finished: 2 }

// Flattens every task's clarifications jsonb into a single list of things
// worth surfacing to `meId` in the Inbox tab: questions directed at them
// (not yet answered or resolved), answers to questions they themselves
// asked, and their own questions someone else marked resolved without
// answering (a plain comment that didn't need a reply — see
// TaskClarifications.jsx's handleResolve). The `question` condition
// matches TaskRow.jsx's own hasQuestionForMe exactly — both `question`
// and `finished` are inherently self-clearing (a question stops being
// "pending" the moment it's answered or resolved), so neither needs
// separate read/seen tracking; only `answer` does (see
// hasUnseenInboxItems below).
export function getInboxItems(tasks, meId) {
  const items = []
  for (const task of tasks) {
    for (const c of task.clarifications || []) {
      if (c.resolved) {
        if (c.askedBy === meId) {
          items.push({
            kind: 'finished',
            taskId: task.id,
            taskTitle: task.title,
            clarificationId: c.id,
            text: c.question,
            otherPersonId: c.resolvedBy,
            at: c.resolvedAt,
          })
        }
      } else if (!c.answer && c.askedBy !== meId) {
        items.push({
          kind: 'question',
          taskId: task.id,
          taskTitle: task.title,
          clarificationId: c.id,
          text: c.question,
          otherPersonId: c.askedBy,
          at: c.askedAt,
        })
      } else if (c.answer && c.askedBy === meId) {
        items.push({
          kind: 'answer',
          taskId: task.id,
          taskTitle: task.title,
          clarificationId: c.id,
          text: c.answer,
          otherPersonId: c.answeredBy,
          at: c.answeredAt,
        })
      }
    }
  }
  items.sort((a, b) => {
    const order = INBOX_KIND_ORDER[a.kind] - INBOX_KIND_ORDER[b.kind]
    return order !== 0 ? order : new Date(b.at) - new Date(a.at)
  })
  return items
}

// Whether the Inbox nav item should show its unread dot: any pending
// question (always "unseen" until answered or resolved), or any answer
// newer than the last time the Inbox tab itself was open. `finished`
// items deliberately don't count — resolving a comment is a quiet action
// (see handleResolve), not something worth flagging back to whoever
// asked it, the same reasoning the resolve action itself skips a push
// notification for.
export function hasUnseenInboxItems(tasks, meId, lastViewedAt) {
  return getInboxItems(tasks, meId).some(
    (item) =>
      item.kind === 'question' ||
      (item.kind === 'answer' && (!lastViewedAt || new Date(item.at) > new Date(lastViewedAt))),
  )
}

// Completed tasks that carry a proof-of-completion note or attachment,
// newest first — the same discoverability gap Inbox's clarification
// sections close, just for submissions instead of comments. Before
// this, the only way to notice one was stumbling onto that task's own
// detail view, or catching the push notification before it scrolled
// away. Not scoped to `meId` like getInboxItems above — a submission is
// mutually visible regardless of who completed the task or who's
// looking, same as everything else in this app.
export function getCompletedSubmissions(tasks) {
  return tasks
    .filter((t) => t.status === 'done' && (t.completion_note || t.completion_attachments?.length))
    .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))
}

// Tasks whose 🔔 overdue nudge (TaskRow.jsx's per-task nudge button, or
// the same-column automatic 3-day cron nudge — see manual-notify/
// notify-reminders) has actually fired, newest first — the same
// discoverability gap the sections above close, just for "did this land"
// instead of a conversation or a completion. Full history, same
// reasoning as submissions: a task can go on to get completed (or nudged
// again by a later cycle, overwriting this same column) without aging
// out of findability here in the meantime. Not scoped to a viewer like
// getCompletedSubmissions above — mutually visible regardless of who
// sent or received the nudge.
export function getNudgedTasks(tasks) {
  return tasks
    .filter((t) => t.overdue_nudge_sent_at)
    .sort((a, b) => new Date(b.overdue_nudge_sent_at) - new Date(a.overdue_nudge_sent_at))
}

// Buckets tasks by the calendar day they're due in each task's saved
// timezone (same rule as getTasksForDay above) into a Map of
// 'YYYY-MM-DD' -> tasks[] — for
// rendering many days at once (Month view) without re-scanning the whole
// task list once per day the way calling getTasksForDay in a loop would.
// All Day tasks with no date (due_date null) naturally fall out of every
// bucket, same as they're excluded from getTasksForDay.
export function groupTasksByDay(tasks, displayTimezone) {
  const map = new Map()
  for (const t of tasks) {
    if (!t.due_date) continue
    const key = taskDueDayKey(t, displayTimezone)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(t)
  }
  return map
}

import { supabase } from './supabaseClient'
import { splitDueDateInZone, DEFAULT_TIMEZONE } from './timezone'

const TASK_COLUMNS =
  'id, title, who, status, priority, due_date, due_timezone, duration_minutes, source, source_note, notes, checklist, recurrence, created_by, created_at, updated_at, completed_at, completion_note, completion_attachments, clarifications'

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
  // trip overlap detection against anything.
  const timed = tasks.filter((t) => t.status !== 'done' && t.due_date && t.duration_minutes && !isAllDayTask(t))
  const overlapping = new Set()

  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i]
      const b = timed[j]
      if (a.who !== b.who) continue

      const aStart = new Date(a.due_date).getTime()
      const aEnd = aStart + a.duration_minutes * 60000
      const bStart = new Date(b.due_date).getTime()
      const bEnd = bStart + b.duration_minutes * 60000

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
// local timezone — bucketing matches the display, which now always shows
// times converted to whoever is actually looking, in their own local time.
function localDayKey(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// Overdue is a "right now" concept, not tied to whichever day is being
// browsed — only ever shown alongside today's view, regardless of due date.
export function getOverdueTasks(tasks) {
  const todayKey = localDayKey(new Date())

  return tasks
    .filter((t) => t.status !== 'done' && t.due_date && localDayKey(new Date(t.due_date)) < todayKey)
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
}

// Start of the current day/week/month, in the viewer's own local
// timezone. Week starts Sunday, matching DateStrip's weekday order.
function startOfPeriod(period) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (period === 'week') d.setDate(d.getDate() - d.getDay())
  if (period === 'month') d.setDate(1)
  return d
}

// The report_date to bucket an eod_reports row under, in the submitter's
// own local timezone — passed explicitly rather than relying on the
// database's `current_date` default, which evaluates in UTC and would be
// wrong for a meaningful part of every day for Aaron (UTC+8).
export function reportDateForPeriod(period) {
  return localDayKey(startOfPeriod(period))
}

// Completed tasks belonging to a given `who` within the current day/week/
// month — the starting draft for a fresh end-of-day/week/month report.
export function getCompletedInPeriod(tasks, whoKey, period) {
  const start = startOfPeriod(period)
  const now = new Date()
  return tasks.filter((t) => {
    if (t.who !== whoKey || t.status !== 'done' || !t.completed_at) return false
    const completedAt = new Date(t.completed_at)
    return completedAt >= start && completedAt <= now
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

// Everything that "belongs" to a given day: tasks due that day if still
// not done, plus tasks actually completed that day regardless of when
// they were originally due. That last part matters for a household
// split across timezones — Ada assigning something at 3pm her time can
// land on what's already "yesterday" on your calendar, and if a
// completed task stayed pinned to that original (now past) day, it'd
// look like nothing got done today even though it did. The label still
// always shows the original due time (see TaskRow's dueLabel) plus a
// small "Completed" tag — only which day's list it appears in follows
// completion time, not the label itself.
export function getTasksForDay(tasks, date) {
  const dayKey = localDayKey(date)

  return tasks
    .filter((t) => {
      if (t.status === 'done') return t.completed_at && localDayKey(new Date(t.completed_at)) === dayKey
      return t.due_date && localDayKey(new Date(t.due_date)) === dayKey
    })
    .sort((a, b) => {
      const at = a.status === 'done' ? a.completed_at : a.due_date
      const bt = b.status === 'done' ? b.completed_at : b.due_date
      return new Date(at) - new Date(bt)
    })
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

// Every day (1st through last) in the calendar month containing `date`.
export function getMonthDays(date) {
  const year = date.getFullYear()
  const month = date.getMonth()
  const numDays = new Date(year, month + 1, 0).getDate()
  return Array.from({ length: numDays }, (_, i) => new Date(year, month, i + 1))
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

// Buckets tasks by the local day they belong to (same done/not-done rule
// as getTasksForDay: done tasks by completed_at, others by due_date) into
// a Map of 'YYYY-MM-DD' -> tasks[] — for rendering many days at once
// (Month view) without re-scanning the whole task list once per day the
// way calling getTasksForDay in a loop would. All Day tasks (due_date
// null, never done via a specific day) naturally fall out of every
// bucket, same as they're excluded from getTasksForDay.
export function groupTasksByDay(tasks) {
  const map = new Map()
  for (const t of tasks) {
    const at = t.status === 'done' ? t.completed_at : t.due_date
    if (!at) continue
    const key = localDayKey(new Date(at))
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(t)
  }
  return map
}

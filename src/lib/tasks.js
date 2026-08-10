import { supabase } from './supabaseClient'

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

// Human label for a task's duration, e.g. 90 -> "1.5 hr", 45 -> "45 min".
export function formatDuration(minutes) {
  if (!minutes) return ''
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
  const timed = tasks.filter((t) => t.status !== 'done' && t.due_date && t.duration_minutes)
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

export function isOverdue(task) {
  if (!task.due_date || task.status === 'done') return false
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

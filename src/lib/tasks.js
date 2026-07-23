import { supabase } from './supabaseClient'

const TASK_COLUMNS =
  'id, title, who, status, priority, due_date, due_timezone, duration_minutes, source, source_note, notes, checklist, recurrence, created_by, created_at, updated_at, completed_at, completion_note, completion_attachment_url, completion_attachment_name'

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

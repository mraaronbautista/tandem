import { supabase } from './supabaseClient'

const TASK_COLUMNS =
  'id, title, who, status, priority, due_date, due_timezone, duration_minutes, source, source_note, notes, checklist, recurrence, created_by, created_at, updated_at, completed_at'

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

// Everything that "belongs" to a given day: tasks due that day, whether or
// not they're done — completing a task keeps it anchored to its original
// due time rather than jumping to whenever it was checked off, so a task's
// position on the board doesn't move out from under you the moment you
// finish it. Tasks with no due_date at all (all-day) fall back to the day
// they were completed, purely so a finished all-day task doesn't vanish
// with nowhere left to show it.
export function getTasksForDay(tasks, date) {
  const dayKey = localDayKey(date)

  return tasks
    .filter((t) => {
      if (t.due_date) return localDayKey(new Date(t.due_date)) === dayKey
      if (t.status === 'done') return t.completed_at && localDayKey(new Date(t.completed_at)) === dayKey
      return false
    })
    .sort((a, b) => {
      const at = a.due_date || a.completed_at
      const bt = b.due_date || b.completed_at
      return new Date(at) - new Date(bt)
    })
}

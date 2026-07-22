import { supabase } from './supabaseClient'

const TASK_COLUMNS =
  'id, title, who, status, priority, due_date, due_timezone, source, source_note, notes, checklist, recurrence, created_by, created_at, updated_at, completed_at'

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

// Everything that "belongs" to a given day: tasks due that day if they're
// still not done, plus tasks actually completed that day regardless of when
// they were originally due — a done task's home becomes the day it was
// finished, not its original due date, so completing a recurring task
// doesn't pile years of history onto one date. Sorted by whichever
// timestamp is relevant to that task.
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

import { supabase } from './supabaseClient'
import { updateTask } from './tasks'

// RLS already scopes the select to "own or shared" (see schema.sql), so
// this returns exactly what the caller is allowed to see with no extra
// filtering needed client-side.
const CORK_NOTE_COLUMNS = 'id, author_id, body, shared, comments, created_at, archived, archived_task_id, roadmap_items'

export async function fetchCorkNotes() {
  const { data, error } = await supabase
    .from('cork_notes')
    .select(CORK_NOTE_COLUMNS)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

// archived_task_id is optional — set only by archiveTaskToBoard() below,
// null for every ordinary pin composed by hand. roadmap_items is likewise
// optional — an empty array (the column's own default) for every pin that
// isn't a roadmap; CorkBoardView.jsx's compose form only passes a non-empty
// one when the roadmap-steps textarea actually has content.
export async function createCorkNote({ body, shared, author_id, archived_task_id = null, roadmap_items }) {
  const { data, error } = await supabase
    .from('cork_notes')
    .insert({ body, shared, author_id, archived_task_id, ...(roadmap_items && { roadmap_items }) })
    .select(CORK_NOTE_COLUMNS)
    .single()
  if (error) throw error
  return data
}

export async function updateCorkNote(id, patch) {
  const { data, error } = await supabase
    .from('cork_notes')
    .update(patch)
    .eq('id', id)
    .select(CORK_NOTE_COLUMNS)
    .single()
  if (error) throw error
  return data
}

// Appends a comment via the add_cork_note_comment() RPC rather than a
// plain update() — the update RLS policy is author-only (see schema.sql),
// so a comment from the *other* member on a shared pin has to go through
// a function that can write to a row it doesn't own without opening up
// the ability to edit the pin's own body/shared columns.
export async function addCorkNoteComment(noteId, body) {
  const { data, error } = await supabase.rpc('add_cork_note_comment', { p_note_id: noteId, p_body: body })
  if (error) throw error
  return data
}

export async function deleteCorkNote(id) {
  const { error } = await supabase.from('cork_notes').delete().eq('id', id)
  if (error) throw error
}

// "Send to board" — archives the task (see tasks.archived in schema.sql)
// and creates a linked pin as the discoverable record and restore point,
// rather than a separate "Archived tasks" screen. Two plain sequential
// writes, not a transaction: both tables already grant members
// unrestricted access to their own half of this, and a partial failure
// here (pin created, task update fails, or vice versa) is a rare,
// recoverable case, not worth an RPC for. Defaults the pin private
// (shared: false) — same default every other new pin gets — the author
// can toggle it Shared afterward with the same control every other own
// pin already has.
export async function archiveTaskToBoard(task, authorId) {
  const pin = await createCorkNote({ body: task.title, shared: false, author_id: authorId, archived_task_id: task.id })
  await updateTask(task.id, { archived: true })
  return pin
}

// The reverse — un-archives the linked task and archives this pin in the
// same motion, since the pin's one job (holding the restore point) is
// done once the task is back on the timeline. Not gated to the pin's own
// author — a shared archived-task pin can be restored by whoever's
// looking at it, same reasoning Focus Today already isn't author-gated
// either (CorkBoardView.jsx). Never called against a pin whose
// archived_task_id has gone null (the original task was hard-deleted
// since archiving, via the column's own `on delete set null`) —
// CorkBoardView.jsx only ever shows the Restore button while it's set.
export async function restoreArchivedTask(pin) {
  await updateTask(pin.archived_task_id, { archived: false })
  await updateCorkNote(pin.id, { archived: true })
}

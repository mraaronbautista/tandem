import { supabase } from './supabaseClient'

// RLS already scopes the select to "own or shared" (see schema.sql), so
// this returns exactly what the caller is allowed to see with no extra
// filtering needed client-side.
const CORK_NOTE_COLUMNS = 'id, author_id, body, shared, comments, created_at'

export async function fetchCorkNotes() {
  const { data, error } = await supabase
    .from('cork_notes')
    .select(CORK_NOTE_COLUMNS)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createCorkNote({ body, shared, author_id }) {
  const { data, error } = await supabase
    .from('cork_notes')
    .insert({ body, shared, author_id })
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

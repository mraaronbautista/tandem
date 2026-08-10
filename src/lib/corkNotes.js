import { supabase } from './supabaseClient'

// RLS already scopes the select to "own or shared" (see schema.sql), so
// this returns exactly what the caller is allowed to see with no extra
// filtering needed client-side.
export async function fetchCorkNotes() {
  const { data, error } = await supabase
    .from('cork_notes')
    .select('id, author_id, body, shared, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createCorkNote({ body, shared, author_id }) {
  const { data, error } = await supabase
    .from('cork_notes')
    .insert({ body, shared, author_id })
    .select('id, author_id, body, shared, created_at')
    .single()
  if (error) throw error
  return data
}

export async function updateCorkNote(id, patch) {
  const { data, error } = await supabase
    .from('cork_notes')
    .update(patch)
    .eq('id', id)
    .select('id, author_id, body, shared, created_at')
    .single()
  if (error) throw error
  return data
}

export async function deleteCorkNote(id) {
  const { error } = await supabase.from('cork_notes').delete().eq('id', id)
  if (error) throw error
}

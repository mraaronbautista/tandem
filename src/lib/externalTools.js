import { supabase } from './supabaseClient'

// The outside tools this member may open from Settings (today: Dallas
// Property Finder). The rows come from the external_tools table, whose
// row-level security returns a row only to the members listed on it — the
// tool's address is never in the app's code, so it is not sitting in a public
// JavaScript file. See supabase/add-external-tools.sql.
//
// Deliberately NOT cached between calls: a second person signing in on the
// same device without a reload must not be handed the previous person's list.
//
// Any failure returns an empty list rather than an error. This is a
// convenience on the side of the app, and before the SQL has been run the
// table simply does not exist — Settings should look exactly as it always did
// in that case, not show a failure.
export async function fetchExternalTools() {
  const { data, error } = await supabase
    .from('external_tools')
    .select('id, title, description, url')
    .order('sort_order')
    .order('title')
  if (error) {
    console.warn('External tools unavailable:', error.message)
    return []
  }
  return data || []
}

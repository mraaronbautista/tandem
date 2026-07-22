import { supabase } from './supabaseClient'

export async function fetchMembers() {
  const { data, error } = await supabase.from('members').select('id, display_name')
  if (error) throw error
  return data
}

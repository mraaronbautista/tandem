import { supabase } from './supabaseClient'

export async function fetchMembers() {
  const { data, error } = await supabase.from('members').select('id, display_name, working_since, default_timezone')
  if (error) throw error
  return data
}

export async function updateWorkingStatus(memberId, working) {
  const { error } = await supabase
    .from('members')
    .update({ working_since: working ? new Date().toISOString() : null })
    .eq('id', memberId)
  if (error) throw error
}

export async function updateDefaultTimezone(memberId, timezone) {
  const { error } = await supabase.from('members').update({ default_timezone: timezone }).eq('id', memberId)
  if (error) throw error
}

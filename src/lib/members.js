import { supabase } from './supabaseClient'

export async function fetchMembers() {
  // color/permissions/is_admin were missing here for a while — nothing
  // broke server-side (RLS still enforced the real permissions), but
  // every client-side read of them (hasPermission() gating the nav,
  // me.is_admin, badge colors) was silently working off `undefined`.
  const { data, error } = await supabase
    .from('members')
    .select('id, display_name, working_since, default_timezone, color, permissions, is_admin')
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

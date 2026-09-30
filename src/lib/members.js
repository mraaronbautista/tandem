import { supabase } from './supabaseClient'

export async function fetchMembers() {
  // color/permissions/is_admin were missing here for a while — nothing
  // broke server-side (RLS still enforced the real permissions), but
  // every client-side read of them (hasPermission() gating the nav,
  // me.is_admin, badge colors) was silently working off `undefined`.
  const { data, error } = await supabase
    .from('members')
    .select(
      'id, display_name, working_since, working_status, working_status_until, default_timezone, color, permissions, is_admin',
    )
  if (error) throw error
  return data
}

// Going online always resets to Available with no expiry (a fresh
// session shouldn't inherit whatever busy/in-meeting state a previous
// one happened to end on); going offline clears all three fields
// together, so there's never a stored status/expiry left dangling for
// someone who's actually offline.
export async function updateWorkingStatus(memberId, working) {
  const { error } = await supabase
    .from('members')
    .update(
      working
        ? { working_since: new Date().toISOString(), working_status: 'available', working_status_until: null }
        : { working_since: null, working_status: null, working_status_until: null },
    )
    .eq('id', memberId)
  if (error) throw error
}

// Switching available/busy/in_meeting while already online — deliberately
// leaves working_since untouched, so changing status mid-session doesn't
// reset how long you've actually been working.
export async function setAvailability(memberId, status, until) {
  const { error } = await supabase
    .from('members')
    .update({ working_status: status, working_status_until: until })
    .eq('id', memberId)
  if (error) throw error
}

export async function updateDefaultTimezone(memberId, timezone) {
  const { error } = await supabase.from('members').update({ default_timezone: timezone }).eq('id', memberId)
  if (error) throw error
}

// My Profile's own-field edits — display_name/color are unguarded by
// guard_member_privilege_columns() (that trigger only blocks
// permissions/is_admin, see schema.sql), so a plain .update() through the
// existing "members can update own working status" row-scoped policy is
// enough; no RPC needed, unlike setMemberPermissions()/upsertTaskAccess().
export async function updateMemberProfile(memberId, { displayName, color }) {
  const { error } = await supabase
    .from('members')
    .update({ display_name: displayName, color })
    .eq('id', memberId)
  if (error) throw error
}

// Own password change — same as staff.js's changeOwnPassword(): GoTrue
// trusts the active session for auth.updateUser(), no current-password
// re-entry or Edge Function needed.
export async function changeOwnPassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}

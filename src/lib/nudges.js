import { supabase } from './supabaseClient'

// Full history of person-level 👋 nudges (see manual-notify's 'nudge'
// branch, the only write path — there's no client-facing insert here).
// Not scoped to a viewer, same reasoning every other Inbox source
// (getNudgedTasks, getCompletedSubmissions) already uses — mutual
// visibility, this is a shared log, not a per-person mailbox.
export async function fetchMemberNudges() {
  const { data, error } = await supabase
    .from('member_nudges')
    .select('id, sender_id, target_id, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

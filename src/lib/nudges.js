import { supabase } from './supabaseClient'

// Full history of person-level 👋 nudges (see manual-notify's 'nudge'
// branch, the only write path — there's no client-facing insert here).
// Fetches every nudge any member can read under member_nudges' own
// is_member() RLS, same as fetchTasks() pulling every RLS-visible task
// regardless of who it's ultimately relevant to — InboxView.jsx is what
// narrows this down to nudges the current viewer actually sent or
// received before rendering it, not this function.
export async function fetchMemberNudges() {
  const { data, error } = await supabase
    .from('member_nudges')
    .select('id, sender_id, target_id, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

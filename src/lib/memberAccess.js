import { supabase } from './supabaseClient'

// Feature keys members.permissions can deny — mirrors has_permission()'s
// feature-name comment in schema.sql. 'reports' gates *submitting* an
// EOD/EOW/EOM report, not reading them (EodReportsList.jsx has no
// permission gate — reports stay mutually visible).
export const PERMISSION_FEATURES = ['rentals', 'vault', 'staff', 'reports', 'workingStatus']

// The only controlled write path for members.permissions (see
// set_member_permissions() in schema.sql) — a guard trigger blocks a
// plain .update() on this column outside this RPC.
export async function setMemberPermissions(targetId, permissions) {
  const { data, error } = await supabase.rpc('set_member_permissions', {
    target_id: targetId,
    new_permissions: permissions,
  })
  if (error) throw error
  return data
}

// Every task_access row where `viewerId` is the one granted access —
// i.e. what viewerId may currently see/do regarding everyone else's
// tasks. Readable for any viewer by an admin caller (a new RLS policy
// added alongside this feature); a non-admin can only read their own
// outgoing grants this way, same shape, no separate function needed.
export async function fetchTaskAccessFor(viewerId) {
  const { data, error } = await supabase.from('task_access').select('*').eq('viewer_id', viewerId)
  if (error) throw error
  return data
}

// The only write path for task_access (see upsert_task_access() in
// schema.sql) — no direct table RLS write policy exists, by design.
export async function upsertTaskAccess(viewerId, targetId, { level, canCreate, canDelete, canReassign }) {
  const { data, error } = await supabase.rpc('upsert_task_access', {
    p_viewer_id: viewerId,
    p_target_id: targetId,
    p_level: level,
    p_can_create: canCreate,
    p_can_delete: canDelete,
    p_can_reassign: canReassign,
  })
  if (error) throw error
  return data
}

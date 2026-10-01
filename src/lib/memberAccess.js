import { supabase } from './supabaseClient'

// Feature keys members.permissions can deny — mirrors has_permission()'s
// feature-name comment in schema.sql. 'reports' gates *submitting* an
// EOD/EOW/EOM report — who can *read* someone's reports is a separate
// concern, report_access (see fetchReportAccessFor/setReportAccess
// below), not this deny-list. 'vault' used to be here — a single blanket
// on/off flag, retired once a second vault needed per-vault access
// (vault_access in schema.sql) rather than one flag that couldn't
// express "trusted with the healthcare vault but not the household one."
export const PERMISSION_FEATURES = ['rentals', 'staff', 'reports', 'workingStatus']

// Shared between MemberAccessForm.jsx (editing an existing member) and
// AddMemberForm.jsx (creating a new one) — one copy so the two forms
// can't drift into describing the same permission key differently.
export const FEATURE_LABELS = {
  rentals: 'Rentals',
  staff: 'Staff',
  // Gates *submitting* a report, not reading one — see report_access for
  // who can read a member's already-submitted reports.
  reports: 'Submit EOD/EOW/EOM reports',
  workingStatus: 'Set own working status (online/busy/in a meeting)',
}

// Ada/Aaron's existing colors plus a few unused suggestions, same list
// README.md's onboarding SQL snippet already documents — kept in sync by
// hand, since there's no single source of truth for "colors already in
// use" beyond querying live members (AddMemberForm.jsx does that to pick
// a sensible default, this is just the fixed palette to pick from).
export const MEMBER_COLOR_PALETTE = ['#a8567e', '#4a7ba6', '#7d6ab8', '#4a9d6f', '#c17a3a']

// The one path for creating a brand-new member — see
// create-member-account/index.ts for why this has to be an Edge Function
// (auth.admin.createUser() needs the service-role key) rather than a
// plain client insert. Mirrors staff.js's createStaffAccount() exactly.
export async function createMemberAccount({ username, password, displayName, color, permissions }) {
  const { data, error } = await supabase.functions.invoke('create-member-account', {
    body: { username, password, displayName, color, permissions },
  })
  if (error) throw error
  return data
}

// Admin resetting another member's username/password — mirrors staff.js's
// updateStaffCredentials() exactly, targeting members instead. Same
// write-only reasoning: there's no way to read back a member's current
// username (their auth.users row isn't queryable through the anon
// client), so leaving a field blank is the only way to say "keep this
// one unchanged."
export async function updateMemberCredentials({ memberId, newUsername, newPassword }) {
  const { data, error } = await supabase.functions.invoke('update-member-credentials', {
    body: { memberId, newUsername, newPassword },
  })
  if (error) throw error
  return data
}

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

// Every report_access row where `viewerId` is the one granted access —
// i.e. whose reports viewerId may currently read. Same shape as
// fetchTaskAccessFor, same admin-can-read-anyone's-outgoing-grants RLS
// policy backing it.
export async function fetchReportAccessFor(viewerId) {
  const { data, error } = await supabase.from('report_access').select('*').eq('viewer_id', viewerId)
  if (error) throw error
  return data
}

// The only write path for report_access (see set_report_access() in
// schema.sql) — a plain presence grant, so this is just "add or remove
// the row," not a level change the way upsertTaskAccess has to express.
export async function setReportAccess(viewerId, targetId, canView) {
  const { error } = await supabase.rpc('set_report_access', {
    p_viewer_id: viewerId,
    p_target_id: targetId,
    p_can_view: canView,
  })
  if (error) throw error
}

// Every priorities_access row where `viewerId` is the one granted
// access — same shape as fetchReportAccessFor, now that priorities are
// genuinely per-person (see priorities_access in schema.sql) rather
// than one shared note.
export async function fetchPrioritiesAccessFor(viewerId) {
  const { data, error } = await supabase.from('priorities_access').select('*').eq('viewer_id', viewerId)
  if (error) throw error
  return data
}

// The only write path for priorities_access (see set_priorities_access()
// in schema.sql) — same plain presence-grant shape as setReportAccess.
export async function setPrioritiesAccess(viewerId, targetId, canView) {
  const { error } = await supabase.rpc('set_priorities_access', {
    p_viewer_id: viewerId,
    p_target_id: targetId,
    p_can_view: canView,
  })
  if (error) throw error
}

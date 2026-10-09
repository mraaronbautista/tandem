// Same deny-list rule has_permission() applies in the database (schema.sql):
// an absent key or an explicit true means allowed, only an explicit false
// denies. Used by the Edge Functions that act with the service-role key and
// so cannot lean on row-level security to enforce a feature permission.
//
// A missing member is never allowed, so a caller that forgets to check for
// "not a member" first still fails closed.
export function featureAllowed(
  member: { permissions?: Record<string, unknown> | null } | null | undefined,
  feature: string,
): boolean {
  if (!member) return false
  const value = member.permissions?.[feature]
  // The database casts the stored value to boolean, so the text "false" also
  // denies there; match it so the two checks can never disagree.
  if (value === false) return false
  if (typeof value === 'string' && ['false', 'f', 'no', 'n', 'off', '0'].includes(value.trim().toLowerCase())) return false
  return true
}

export const STAFF_ACCESS_DENIED = "You don't have access to staff accounts."

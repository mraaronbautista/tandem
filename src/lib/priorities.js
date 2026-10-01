import { supabase } from './supabaseClient'

export async function createPriorities(setBy, period, body) {
  const { data, error } = await supabase
    .from('priorities')
    .insert({ set_by: setBy, period, body })
    .select('id, set_by, period, body, created_at')
    .single()
  if (error) throw error
  return data
}

// Most recent entry per period ('day'/'week'/'month'), scoped to one
// specific person — each save is a new row (see schema.sql), so
// "current" priorities is just that person's own latest one for that
// period. Used to return the single most-recently-saved row per period
// *regardless of who set it*, back when priorities were one shared note
// — that broke once priorities became genuinely per-person (see
// priorities_access in schema.sql): a viewer without access to the
// actual most recent setter would've silently had RLS skip straight to
// an older row they *could* see, surfacing as "current" with nothing
// indicating it was stale. Always pass the specific person whose
// priorities you want — PrioritiesForm.jsx's own "Last set" reference
// is always the signed-in member's own, never whoever happened to save
// most recently team-wide.
export async function fetchLatestPriorities(setBy) {
  const { data, error } = await supabase
    .from('priorities')
    .select('id, set_by, period, body, created_at')
    .eq('set_by', setBy)
    .order('created_at', { ascending: false })
  if (error) throw error

  const latest = {}
  for (const row of data) {
    if (!latest[row.period]) latest[row.period] = row
  }
  return latest
}

// The other half of making priorities per-person: priorities_access lets
// an admin grant someone visibility into a teammate's priorities, but
// granting it is meaningless without somewhere to actually look — this
// is that somewhere. One unfiltered query (RLS already scopes the
// result to "my own rows, plus anyone's I have priorities_access to" —
// see schema.sql — so no separate access-roster fetch is needed first),
// grouped client-side into the latest row per (set_by, period) pair.
// PrioritiesForm.jsx uses this to show each accessible teammate's
// current priorities read-only, next to your own compose form.
export async function fetchLatestPrioritiesForTeam() {
  const { data, error } = await supabase
    .from('priorities')
    .select('id, set_by, period, body, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error

  const latest = {}
  for (const row of data) {
    const key = `${row.set_by}:${row.period}`
    if (!latest[key]) latest[key] = row
  }
  return latest
}

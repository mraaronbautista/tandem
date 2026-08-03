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

// Most recent entry per period ('day'/'week'/'month') — each save is a
// new row (see schema.sql), so "current" priorities is just the latest
// one for that period.
export async function fetchLatestPriorities() {
  const { data, error } = await supabase
    .from('priorities')
    .select('id, set_by, period, body, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error

  const latest = {}
  for (const row of data) {
    if (!latest[row.period]) latest[row.period] = row
  }
  return latest
}

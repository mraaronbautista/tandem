import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

// 'loading' | 'member' | 'staff' | 'blocked'. Runs after a session
// exists, deciding which of App.jsx's three authenticated UIs to
// render — TaskBoard assumes every session belongs to a `members` row
// (its own `me` lookup is only `me?.`-guarded, not "member not found"
// guarded), so without this a staff session reaching TaskBoard today
// would silently render the full app shell with every RLS-gated fetch
// quietly coming back empty, not an actual error. Each table's RLS
// only ever lets a caller see their own row in the table they don't
// belong to, so the two checks below are independent, not a join.
// 'blocked' covers both "recognized by neither table" and "a
// deactivated staff row" — either way there's a real state to render
// instead of a half-working screen.
export function useAccountRole(session) {
  const [role, setRole] = useState('loading')

  useEffect(() => {
    if (!session) return
    let cancelled = false
    setRole('loading')

    Promise.all([
      supabase.from('members').select('id').eq('id', session.user.id).maybeSingle(),
      supabase.from('staff').select('id, active').eq('id', session.user.id).maybeSingle(),
    ]).then(([{ data: member, error: memberError }, { data: staff, error: staffError }]) => {
      if (cancelled) return
      if (memberError || staffError) {
        setRole('blocked')
        return
      }
      if (member) setRole('member')
      else if (staff?.active) setRole('staff')
      else setRole('blocked')
    })

    return () => {
      cancelled = true
    }
    // Keyed on the user id, not the session object itself — a token
    // refresh produces a new session object with the same user id, and
    // re-running this (and flashing back to 'loading') on every refresh
    // would be a visible regression for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id])

  return role
}

import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { fetchRentalVisits } from './rentalVisits'
import { friendlyError } from './friendlyError'

// One shared list of visits for the Rentals screen: the unit cards read it
// for their "N visits" badge and the activity sheet reads it for the timeline.
// Refetches when the phone wakes up or reconnects, since a suspended app can
// miss live updates (same reasoning as useRentalContacts).
export function useRentalVisits() {
  const [visits, setVisits] = useState(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    let cancelled = false
    let generation = 0
    async function load() {
      const version = ++generation
      try {
        const rows = await fetchRentalVisits()
        if (!cancelled && version === generation) { setVisits(rows); setError('') }
      } catch (err) {
        if (!cancelled && version === generation) {
          setError(['42P01', 'PGRST205'].includes(err.code)
            ? 'Visits are not set up yet. Ask Aaron to run the visits SQL (add-rental-visits.sql), then try again.'
            : friendlyError(err))
        }
      }
    }
    function refreshWhenVisible() {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)
    window.addEventListener('online', refreshWhenVisible)
    load()
    const channel = supabase.channel('rental-visits-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_visits' }, load)
      .subscribe((status) => {
        if (!cancelled && status === 'SUBSCRIBED') load()
      })
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
      window.removeEventListener('online', refreshWhenVisible)
      supabase.removeChannel(channel)
    }
  }, [reloadKey])
  return { visits, error, reload: () => setReloadKey((key) => key + 1) }
}

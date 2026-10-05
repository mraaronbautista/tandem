import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { fetchRentalContacts, fetchContactProperties } from './rentalContacts'
import { friendlyError } from './friendlyError'

export function useRentalContacts() {
  const [contacts, setContacts] = useState(null)
  const [properties, setProperties] = useState([])
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    let cancelled = false
    let generation = 0
    async function load() {
      const version = ++generation
      try {
        const [people, units] = await Promise.all([fetchRentalContacts(), fetchContactProperties()])
        if (!cancelled && version === generation) { setContacts(people); setProperties(units); setError('') }
      } catch (err) {
        if (!cancelled && version === generation) setError(['42P01', 'PGRST205'].includes(err.code)
          ? 'Contacts are not set up yet. Ask Aaron to run the property contacts setup SQL, then try again.' : friendlyError(err))
      }
    }
    load()
    const channel = supabase.channel('rental-contacts-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_contacts' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_contact_links' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_properties' }, load)
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [reloadKey])
  return { contacts, properties, error, reload: () => setReloadKey((key) => key + 1) }
}

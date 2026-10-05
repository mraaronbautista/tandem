import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { fetchRentalContacts, fetchContactProperties, fetchRentalLocations } from './rentalContacts'
import { friendlyError } from './friendlyError'

export function useRentalContacts() {
  const [contacts, setContacts] = useState(null)
  const [properties, setProperties] = useState([])
  const [locations, setLocations] = useState([])
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    let cancelled = false
    let generation = 0
    async function load() {
      const version = ++generation
      try {
        const [people, units, sites] = await Promise.all([fetchRentalContacts(), fetchContactProperties(), fetchRentalLocations()])
        if (!cancelled && version === generation) { setContacts(people.map((contact) => ({ ...contact, rental_contact_links: contact.rental_contact_links.map((link) => ({ ...link, location_id: units.find((unit) => unit.id === link.property_id)?.work_site_id })) }))); setProperties(units); setLocations(sites); setError('') }
      } catch (err) {
        if (!cancelled && version === generation) setError(['42P01', 'PGRST200', 'PGRST202', 'PGRST205'].includes(err.code)
          ? 'Contacts are not set up yet. Ask Aaron to run the location contacts setup SQL, then try again.' : friendlyError(err))
      }
    }
    load()
    const channel = supabase.channel('rental-contacts-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_contacts' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_contact_links' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_properties' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_contact_location_links' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_location_changes' }, load)
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [reloadKey])
  return { contacts, properties, locations, error, reload: () => setReloadKey((key) => key + 1) }
}

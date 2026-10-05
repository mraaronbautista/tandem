import { supabase } from './supabaseClient'

export const CONTACT_KINDS = { tenant: 'Tenant', vendor: 'Vendor', other: 'Other' }
export function filterRentalContacts(contacts, { search = '', kind = 'all', includeArchived = false, propertyId = null, workSiteId = null, locationId = '', service = '' } = {}) {
  const query = search.trim().toLowerCase()
  const digits = query.replace(/\D/g, '')
  return contacts.filter((contact) => {
    if (!includeArchived && !contact.active) return false
    if (kind !== 'all' && contact.kind !== kind) return false
    if (propertyId && !contact.rental_contact_links.some((link) => link.property_id === propertyId) && !(workSiteId && contact.kind !== 'tenant' && (contact.rental_contact_location_links || []).some((link) => link.work_site_id === workSiteId))) return false
    if (locationId && !(contact.rental_contact_location_links || []).some((link) => link.work_site_id === locationId) && !contact.rental_contact_links.some((link) => link.location_id === locationId)) return false
    if (service && ![contact.trade, ...contact.rental_contact_links.map((link) => link.role), ...(contact.rental_contact_location_links || []).map((link) => link.role)].some((role) => role.toLowerCase().includes(service.toLowerCase()))) return false
    const text = [contact.name, contact.organization, contact.trade, contact.email, contact.phone, contact.phone_alt].join(' ').toLowerCase()
    return !query || text.includes(query) || (digits.length >= 3 && /^[+()\d\s.-]+$/.test(query) && [contact.phone, contact.phone_alt].some((phone) => phone.replace(/\D/g, '').includes(digits)))
  })
}
export async function fetchRentalContacts() {
  const { data, error } = await supabase.from('rental_contacts').select('*, rental_contact_links(property_id, role), rental_contact_location_links(work_site_id, role)').order('name')
  if (error) throw error
  return data.map((contact) => ({ ...contact, rental_contact_links: contact.rental_contact_links || [] }))
}
export async function fetchContactProperties() {
  const { data, error } = await supabase.from('rental_properties').select('id, unit_name, company, active, work_site_id').order('unit_name')
  if (error) throw error
  return data
}
export async function saveRentalContact(id, details, links, locationLinks = []) {
  const { data, error } = await supabase.rpc('save_rental_contact_coverage', { contact_id: id || null, details, links, location_links: locationLinks })
  if (error) throw error
  return data
}
export async function setRentalContactActive(id, active) {
  const { data, error } = await supabase.from('rental_contacts').update({ active, updated_at: new Date().toISOString() }).eq('id', id).select('id').single()
  if (error) throw error
  return data
}

export async function fetchRentalLocations() {
  const { data, error } = await supabase.rpc('get_rental_locations')
  if (error) throw error
  return data
}

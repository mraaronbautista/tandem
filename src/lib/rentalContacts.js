import { supabase } from './supabaseClient'

export const CONTACT_KINDS = { tenant: 'Tenant', vendor: 'Vendor', other: 'Other' }
export function filterRentalContacts(contacts, { search = '', kind = 'all', includeArchived = false, propertyId = null } = {}) {
  const query = search.trim().toLowerCase()
  const digits = query.replace(/\D/g, '')
  return contacts.filter((contact) => {
    if (!includeArchived && !contact.active) return false
    if (kind !== 'all' && contact.kind !== kind) return false
    if (propertyId && !contact.rental_contact_links.some((link) => link.property_id === propertyId)) return false
    const text = [contact.name, contact.organization, contact.trade, contact.email, contact.phone, contact.phone_alt].join(' ').toLowerCase()
    return !query || text.includes(query) || (digits.length >= 3 && /^[+()\d\s.-]+$/.test(query) && [contact.phone, contact.phone_alt].some((phone) => phone.replace(/\D/g, '').includes(digits)))
  })
}
export async function fetchRentalContacts() {
  const { data, error } = await supabase.from('rental_contacts').select('*, rental_contact_links(property_id, role)').order('name')
  if (error) throw error
  return data.map((contact) => ({ ...contact, rental_contact_links: contact.rental_contact_links || [] }))
}
export async function fetchContactProperties() {
  const { data, error } = await supabase.from('rental_properties').select('id, unit_name, company, active').order('unit_name')
  if (error) throw error
  return data
}
export async function saveRentalContact(id, details, links) {
  const { data, error } = await supabase.rpc('save_rental_contact', { contact_id: id || null, details, links })
  if (error) throw error
  return data
}
export async function setRentalContactActive(id, active) {
  const { data, error } = await supabase.from('rental_contacts').update({ active, updated_at: new Date().toISOString() }).eq('id', id).select('id').single()
  if (error) throw error
  return data
}

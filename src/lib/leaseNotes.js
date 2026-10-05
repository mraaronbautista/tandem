import { supabase } from './supabaseClient'

export async function fetchLeaseNotes(propertyId) {
  // Page to avoid Supabase's default 1,000-row cap silently truncating history.
  const result = []
  for (let start = 0; ; start += 500) {
    const { data, error } = await supabase.from('rental_lease_notes').select('*').eq('property_id', propertyId)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(start, start + 499)
    if (error) throw error
    result.push(...data)
    if (data.length < 500) return result
  }
}
export async function addLeaseNote(propertyId, bookingId, body) {
  const { data, error } = await supabase.from('rental_lease_notes').insert({ property_id: propertyId, booking_id: bookingId, body }).select().single()
  if (error) throw error
  return data
}
export async function updateLeaseNote(id, change) {
  const { data, error } = await supabase.from('rental_lease_notes').update(change).eq('id', id).select().single()
  if (error) throw error
  return data
}

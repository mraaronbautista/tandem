import { supabase } from './supabaseClient'

export async function fetchRentalProperties(company) {
  const { data, error } = await supabase
    .from('rental_properties')
    .select('id, company, unit_name, address, monthly_rent, color, active')
    .eq('company', company)
    .eq('active', true)
    .order('monthly_rent', { ascending: false })
  if (error) throw error
  return data
}

export async function fetchRentalExpenses(company) {
  const { data, error } = await supabase
    .from('rental_expenses')
    .select('id, company, label, amount')
    .eq('company', company)
    .order('amount', { ascending: false })
  if (error) throw error
  return data
}

// rangeStart/rangeEnd are 'YYYY-MM-DD' strings; returns bookings that
// overlap [rangeStart, rangeEnd) at all, i.e. check_in < rangeEnd and
// check_out >= rangeStart. check_out is the last occupied day (inclusive),
// not a hotel-style departure day.
export async function fetchRentalBookings(company, rangeStart, rangeEnd) {
  const { data, error } = await supabase
    .from('rental_bookings')
    .select('id, property_id, guest_name, check_in, check_out, rental_properties!inner(company)')
    .eq('rental_properties.company', company)
    .lt('check_in', rangeEnd)
    .gte('check_out', rangeStart)
  if (error) throw error
  return data
}

async function hasOverlappingBooking(propertyId, checkIn, checkOut) {
  const { data, error } = await supabase
    .from('rental_bookings')
    .select('id')
    .eq('property_id', propertyId)
    .lte('check_in', checkOut)
    .gte('check_out', checkIn)
    .limit(1)
  if (error) throw error
  return data.length > 0
}

export async function createRentalBooking({ property_id, guest_name, check_in, check_out, created_by }) {
  // A unit can't be rented to two guests at once — check before inserting
  // rather than relying on a DB constraint, so the error message can name
  // the actual problem instead of a generic conflict.
  if (await hasOverlappingBooking(property_id, check_in, check_out)) {
    throw new Error('This unit already has a booking that overlaps those dates.')
  }
  const { data, error } = await supabase
    .from('rental_bookings')
    .insert({ property_id, guest_name, check_in, check_out, created_by })
    .select('id, property_id, guest_name, check_in, check_out')
    .single()
  if (error) throw error
  return data
}

export async function deleteRentalBooking(id) {
  const { error } = await supabase.from('rental_bookings').delete().eq('id', id)
  if (error) throw error
}

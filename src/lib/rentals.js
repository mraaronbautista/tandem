import { supabase } from './supabaseClient'

function pad(n) {
  return String(n).padStart(2, '0')
}

// 'YYYY-MM-DD' bounds for a calendar month as [start, end) — end is the
// 1st of the following month, exclusive.
export function monthRangeStrings(monthDate) {
  const year = monthDate.getFullYear()
  const month = monthDate.getMonth()
  const start = `${year}-${pad(month + 1)}-01`
  const next = new Date(year, month + 1, 1)
  const end = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-01`
  return { start, end }
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

// Rent is paid upfront in ~30-day cycles starting at check-in (a security
// deposit / Airbnb-style upfront payment, not a smooth per-calendar-day
// accrual) — so a booking spanning Aug 15 - Dec 30 generates charges on
// Aug 15, Sep 14, Oct 14, Nov 13, Dec 13, not one per calendar month it
// happens to touch. A guest who checked in Aug 15 hasn't paid anything
// new by Sep 1 — that's still covered by the Aug 15 charge.
export function chargeDatesForBooking(booking) {
  const dates = []
  let d = booking.check_in
  while (d <= booking.check_out) {
    dates.push(d)
    d = addDays(d, 30)
  }
  return dates
}

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

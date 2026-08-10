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

// 'YYYY-MM-DD' for the current date in the browser's local timezone.
export function todayDateStr() {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// Parsed as local, not UTC — a bare 'YYYY-MM-DD' parsed via `new Date()`
// would otherwise shift a day depending on the browser's timezone offset.
export function formatDateStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// Rent is paid upfront in ~30-day cycles starting at check-in (a security
// deposit / Airbnb-style upfront payment, not a smooth per-calendar-day
// accrual) — so a booking spanning Aug 15 - Dec 30 generates charges on
// Aug 15, Sep 14, Oct 14, Nov 13, Dec 13, not one per calendar month it
// happens to touch. A guest who checked in Aug 15 hasn't paid anything
// new by Sep 1 — that's still covered by the Aug 15 charge.
//
// A later cycle only counts if there's an actual day of stay left beyond
// it: a 31-day stay (e.g. Aug 7 - Sep 6) has its would-be second cycle
// land exactly on check_out itself (Aug 7 + 30 = Sep 6) with zero days of
// occupancy past it, so no second charge happens — the trailing single
// day is absorbed into the first cycle rather than billed again.
export function chargeDatesForBooking(booking) {
  const dates = [booking.check_in]
  let d = addDays(booking.check_in, 30)
  while (d < booking.check_out) {
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
    .select('id, property_id, guest_name, check_in, check_out, status, rental_properties!inner(company)')
    .eq('rental_properties.company', company)
    .lt('check_in', rangeEnd)
    .gte('check_out', rangeStart)
  if (error) throw error
  return data
}

// Bookings still relevant "at a glance" — anything not fully in the past
// (check_out >= today) — regardless of which calendar month is currently
// being browsed elsewhere in the UI. Backs the Overview tab, which shows
// current/next occupancy per unit rather than one month at a time.
export async function fetchUpcomingRentalBookings(company) {
  const { data, error } = await supabase
    .from('rental_bookings')
    .select('id, property_id, guest_name, check_in, check_out, status, rental_properties!inner(company)')
    .eq('rental_properties.company', company)
    .gte('check_out', todayDateStr())
    .order('check_in', { ascending: true })
  if (error) throw error
  return data
}

// One unit's status right now: either the booking covering today
// (occupied through its check_out), the nearest upcoming booking (vacant
// until it starts), or fully vacant with nothing on the books.
export function unitOccupancyStatus(bookings, propertyId) {
  const todayStr = todayDateStr()
  const unitBookings = bookings.filter((b) => b.property_id === propertyId)
  const current = unitBookings.find(
    (b) => b.status === 'confirmed' && b.check_in <= todayStr && b.check_out >= todayStr,
  )
  if (current) return { occupied: true, through: current.check_out, guest: current.guest_name }
  const next = unitBookings.find((b) => b.check_in > todayStr)
  if (next) {
    return { occupied: false, next: { checkIn: next.check_in, guest: next.guest_name, pending: next.status === 'pending' } }
  }
  return { occupied: false, next: null }
}

// Multiple milestones can share the same underlying accumulating savings
// (e.g. a $20k short-term goal, then $75k for the actual down payment) —
// ordered ascending so the nearer milestone shows first. saved_amount is
// a plain manually-maintained number (see the column comment in
// schema.sql for why this isn't derived from bookings).
export async function fetchSavingsGoals(company) {
  const { data, error } = await supabase
    .from('rental_savings_goal')
    .select('id, company, label, target_amount, saved_amount')
    .eq('company', company)
    .order('target_amount', { ascending: true })
  if (error) throw error
  return data
}

export async function createSavingsGoal(company, { label, target_amount, saved_amount }) {
  const { data, error } = await supabase
    .from('rental_savings_goal')
    .insert({ company, label, target_amount, saved_amount })
    .select('id, company, label, target_amount, saved_amount')
    .single()
  if (error) throw error
  return data
}

export async function updateSavingsGoal(id, { label, target_amount, saved_amount }) {
  const { data, error } = await supabase
    .from('rental_savings_goal')
    .update({ label, target_amount, saved_amount })
    .eq('id', id)
    .select('id, company, label, target_amount, saved_amount')
    .single()
  if (error) throw error
  return data
}

export async function deleteSavingsGoal(id) {
  const { error } = await supabase.from('rental_savings_goal').delete().eq('id', id)
  if (error) throw error
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

export async function createRentalBooking({ property_id, guest_name, check_in, check_out, status, created_by }) {
  // A unit can't be held for two guests at once — check before inserting
  // rather than relying on a DB constraint, so the error message can name
  // the actual problem instead of a generic conflict. A pending request
  // still blocks the dates (you might accept it), so this checks against
  // both pending and confirmed bookings, not just confirmed ones.
  if (await hasOverlappingBooking(property_id, check_in, check_out)) {
    throw new Error('This unit already has a booking that overlaps those dates.')
  }
  const { data, error } = await supabase
    .from('rental_bookings')
    .insert({ property_id, guest_name, check_in, check_out, status: status || 'confirmed', created_by })
    .select('id, property_id, guest_name, check_in, check_out, status')
    .single()
  if (error) throw error
  return data
}

export async function confirmRentalBooking(id) {
  const { error } = await supabase.from('rental_bookings').update({ status: 'confirmed' }).eq('id', id)
  if (error) throw error
}

export async function deleteRentalBooking(id) {
  const { error } = await supabase.from('rental_bookings').delete().eq('id', id)
  if (error) throw error
}

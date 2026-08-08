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

// Computed ("potential") net cash flow for exactly one month — confirmed-
// booking revenue minus fixed overhead. This is only ever a suggestion:
// it doesn't count toward a goal until that month is reconciled via
// rental_savings_month, since a computed surplus isn't necessarily money
// that actually got saved (it might get spent on something else first).
export function potentialSavingsForMonth(bookings, properties, expenses, monthDate) {
  const { start, end } = monthRangeStrings(monthDate)
  const rentByProperty = new Map(properties.map((p) => [p.id, Number(p.monthly_rent)]))
  const overhead = expenses.reduce((sum, e) => sum + Number(e.amount), 0)
  let revenue = 0
  for (const b of bookings.filter((b) => b.status === 'confirmed')) {
    const count = chargeDatesForBooking(b).filter((d) => d >= start && d < end).length
    revenue += count * (rentByProperty.get(b.property_id) || 0)
  }
  return revenue - overhead
}

// Every calendar month from trackingStart ('YYYY-MM-DD', always the 1st)
// through the current real-world month, as Date objects — using today's
// date, not whichever month the calendar happens to be showing, since a
// month that hasn't happened yet can't have anything to reconcile.
export function monthsFrom(trackingStart) {
  const now = new Date()
  const current = new Date(now.getFullYear(), now.getMonth(), 1)
  const [ty, tm] = trackingStart.split('-').map(Number)
  let month = new Date(ty, tm - 1, 1)
  const months = []
  while (month <= current) {
    months.push(month)
    month = new Date(month.getFullYear(), month.getMonth() + 1, 1)
  }
  return months
}

// Sum of *approved* actual savings for months from trackingStart through
// now — an unreconciled month contributes $0 until someone approves or
// edits it (see rental_savings_month), so the total only ever reflects
// money actually confirmed saved, never an assumption.
export function cumulativeSavings(monthRecords, trackingStart) {
  const byMonth = new Map(monthRecords.map((r) => [r.month, r]))
  let total = 0
  for (const month of monthsFrom(trackingStart)) {
    const rec = byMonth.get(monthRangeStrings(month).start)
    if (rec && rec.actual_amount != null) total += Number(rec.actual_amount)
  }
  return total
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

// Full booking history for the company, unscoped by date — used for the
// savings-goal running total, which can reach back further than whatever
// month the calendar is currently showing.
export async function fetchAllRentalBookings(company) {
  const { data, error } = await supabase
    .from('rental_bookings')
    .select('id, property_id, guest_name, check_in, check_out, status, rental_properties!inner(company)')
    .eq('rental_properties.company', company)
  if (error) throw error
  return data
}

// Multiple milestones can share the same underlying accumulating savings
// (e.g. a $20k short-term goal, then $75k for the actual down payment) —
// ordered ascending so the nearer milestone shows first.
export async function fetchSavingsGoals(company) {
  const { data, error } = await supabase
    .from('rental_savings_goal')
    .select('id, company, label, target_amount, tracking_start')
    .eq('company', company)
    .order('target_amount', { ascending: true })
  if (error) throw error
  return data
}

export async function createSavingsGoal(company, { label, target_amount, tracking_start }) {
  const { data, error } = await supabase
    .from('rental_savings_goal')
    .insert({ company, label, target_amount, tracking_start })
    .select('id, company, label, target_amount, tracking_start')
    .single()
  if (error) throw error
  return data
}

export async function updateSavingsGoal(id, { label, target_amount, tracking_start }) {
  const { data, error } = await supabase
    .from('rental_savings_goal')
    .update({ label, target_amount, tracking_start })
    .eq('id', id)
    .select('id, company, label, target_amount, tracking_start')
    .single()
  if (error) throw error
  return data
}

export async function deleteSavingsGoal(id) {
  const { error } = await supabase.from('rental_savings_goal').delete().eq('id', id)
  if (error) throw error
}

export async function fetchSavingsMonths(company) {
  const { data, error } = await supabase
    .from('rental_savings_month')
    .select('id, company, month, actual_amount, approved_at, approved_by')
    .eq('company', company)
  if (error) throw error
  return data
}

// Upserts the reconciled actual amount for a given month — used both for
// "Approve" (actualAmount = the computed potential, taken as-is) and
// "Edit" (actualAmount = whatever was typed in instead).
export async function approveSavingsMonth(company, month, actualAmount, approvedBy) {
  const { data, error } = await supabase
    .from('rental_savings_month')
    .upsert(
      { company, month, actual_amount: actualAmount, approved_at: new Date().toISOString(), approved_by: approvedBy },
      { onConflict: 'company,month' },
    )
    .select('id, company, month, actual_amount, approved_at, approved_by')
    .single()
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

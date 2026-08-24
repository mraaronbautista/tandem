import { supabase } from './supabaseClient'

// Display labels for rental_bookings.source — 'unspecified' isn't a real
// enum value, it's the fallback for bookings that predate this column or
// simply never had a source set.
export const BOOKING_SOURCE_LABEL = {
  airbnb: 'Airbnb',
  furnished_finder: 'Furnished Finder',
  rotating_room: 'RotatingRoom',
  zillow: 'Zillow',
  referral: 'Referral',
  other: 'Other',
  unspecified: 'Not set',
}

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

// N calendar months after dateStr, same day-of-month — not "+30*N days",
// which drifts the billing day earlier every cycle it crosses a
// shorter month (Jan 30 + 30 days lands on Mar 1, not Feb 30). Always
// computed from the ORIGINAL date, not the previous cycle's result, so
// a short month's rollover (see chargeDatesForBooking below) can't
// compound into the next cycle too. JS's own month-overflow handling
// covers the one case with no clean answer — a check-in on the 31st
// hitting a 30-day month — by rolling into early the following month,
// same as most billing systems do when a due day doesn't exist that
// month.
function addCalendarMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1 + months, d)
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

// Rent is paid upfront in monthly cycles anchored to check-in's calendar
// day-of-month (a security deposit / Airbnb-style upfront payment, not a
// smooth per-calendar-day accrual) — so a guest who checked in May 30
// bills on the 30th of every month from then on (May 30, Jun 30, Jul 30,
// ...), not "30 days later" repeatedly, which would drift the billing
// day earlier and earlier across shorter months. A guest who checked in
// Aug 15 hasn't paid anything new by Sep 1 — that's still covered by the
// Aug 15 charge, and their next one lands Sep 15, not "Sep 14" the way
// raw +30-day math would put it.
//
// A later cycle only counts if there's an actual day of stay left beyond
// it: a booking checking out on exactly its next billing day (e.g.
// check-in Aug 7, check-out Sep 7) has that would-be next cycle land
// exactly on check_out itself, with zero days of occupancy past it, so
// no second charge happens — the trailing day is absorbed into the first
// cycle rather than billed again.
export function chargeDatesForBooking(booking) {
  const dates = [booking.check_in]
  let cycle = 1
  let d = addCalendarMonths(booking.check_in, cycle)
  while (d < booking.check_out) {
    dates.push(d)
    cycle += 1
    d = addCalendarMonths(booking.check_in, cycle)
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

export async function createRentalProperty(company, { unit_name, address, monthly_rent, color }) {
  const { data, error } = await supabase
    .from('rental_properties')
    .insert({ company, unit_name, address: address || null, monthly_rent: monthly_rent || null, color })
    .select('id, company, unit_name, address, monthly_rent, color, active')
    .single()
  if (error) throw error
  return data
}

export async function updateRentalProperty(id, { unit_name, address, monthly_rent, color }) {
  const { data, error } = await supabase
    .from('rental_properties')
    .update({ unit_name, address: address || null, monthly_rent: monthly_rent || null, color })
    .eq('id', id)
    .select('id, company, unit_name, address, monthly_rent, color, active')
    .single()
  if (error) throw error
  return data
}

// Soft-hide, not a hard delete (there's a delete RLS policy, but this
// deliberately doesn't use it) — matches the `active` column's own
// comment in schema.sql: a unit taken off the market should keep its
// booking history intact, not cascade-delete it.
export async function archiveRentalProperty(id) {
  const { error } = await supabase.from('rental_properties').update({ active: false }).eq('id', id)
  if (error) throw error
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

export async function createRentalExpense(company, { label, amount }) {
  const { data, error } = await supabase
    .from('rental_expenses')
    .insert({ company, label, amount })
    .select('id, company, label, amount')
    .single()
  if (error) throw error
  return data
}

export async function updateRentalExpense(id, { label, amount }) {
  const { data, error } = await supabase
    .from('rental_expenses')
    .update({ label, amount })
    .eq('id', id)
    .select('id, company, label, amount')
    .single()
  if (error) throw error
  return data
}

export async function deleteRentalExpense(id) {
  const { error } = await supabase.from('rental_expenses').delete().eq('id', id)
  if (error) throw error
}

// rangeStart/rangeEnd are 'YYYY-MM-DD' strings; returns bookings that
// overlap [rangeStart, rangeEnd) at all, i.e. check_in < rangeEnd and
// check_out >= rangeStart. check_out is the last occupied day (inclusive),
// not a hotel-style departure day.
export async function fetchRentalBookings(company, rangeStart, rangeEnd) {
  const { data, error } = await supabase
    .from('rental_bookings')
    .select(
      'id, property_id, guest_name, check_in, check_out, status, source, source_note, notes, rental_properties!inner(company)',
    )
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
    .select(
      'id, property_id, guest_name, check_in, check_out, status, source, source_note, notes, rental_properties!inner(company)',
    )
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

function addDaysStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

function daysBetweenStrs(a, b) {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / 86_400_000)
}

export const MIN_STAY_DAYS = 30

// The next date this unit could actually accept a NEW booking honoring
// the household's 30-day minimum stay — not just "the day after
// checkout." A unit already re-booked soon after its current tenant
// leaves (a fast back-to-back turnover) might not have room for another
// 30-day stay in the gap at all, and "Vacant" alone (unitOccupancyStatus
// above, or the vacant/occupied buckets in RentalFinancials.jsx) doesn't
// capture that — it only reflects whether a booking touches the
// currently-browsed month, not whether the surrounding gap actually
// clears the minimum.
//
// Only CONFIRMED bookings block a gap — a pending request isn't
// guaranteed, so treating it as blocking would understate real
// availability for someone trying to fill a vacancy. `bookings` must be
// the *unscoped* set (see fetchUpcomingRentalBookings), not the
// month-limited one RentalFinancials.jsx otherwise uses, since a
// blocking booking can be months out.
//
// Walks forward through every future confirmed booking in order, looking
// for the first gap of at least `minStayDays`. Returns `{ date }` alone
// when that gap runs past every booking currently on the books (nothing
// left to bound it), or `{ date, until }` when the gap is itself capped
// by a specific future booking's own check-in.
export function nextAvailability(bookings, propertyId, minStayDays = MIN_STAY_DAYS) {
  const todayStr = todayDateStr()
  const confirmed = bookings
    .filter((b) => b.property_id === propertyId && b.status === 'confirmed')
    .sort((a, b) => (a.check_in < b.check_in ? -1 : 1))

  const current = confirmed.find((b) => b.check_in <= todayStr && b.check_out >= todayStr)
  let cursor = current ? addDaysStr(current.check_out, 1) : todayStr

  for (const b of confirmed) {
    if (b.check_in <= cursor) continue // already passed, or is `current` itself
    if (daysBetweenStrs(cursor, b.check_in) >= minStayDays) return { date: cursor, until: b.check_in }
    cursor = addDaysStr(b.check_out, 1)
  }

  return { date: cursor }
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

// excludeId lets an edit check the dates against every OTHER booking
// without the booking's own (unchanged) row always matching itself.
// Exported so RentalBookingForm.jsx can run the same check live, as
// soon as both dates are picked, instead of only finding out about a
// conflict after filling out the rest of the form and hitting submit.
export async function hasOverlappingBooking(propertyId, checkIn, checkOut, excludeId) {
  let query = supabase
    .from('rental_bookings')
    .select('id')
    .eq('property_id', propertyId)
    .lte('check_in', checkOut)
    .gte('check_out', checkIn)
  if (excludeId) query = query.neq('id', excludeId)
  const { data, error } = await query.limit(1)
  if (error) throw error
  return data.length > 0
}

export async function createRentalBooking({
  property_id,
  guest_name,
  check_in,
  check_out,
  status,
  source,
  source_note,
  notes,
  created_by,
}) {
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
    .insert({
      property_id,
      guest_name,
      check_in,
      check_out,
      status: status || 'confirmed',
      source: source || null,
      source_note: source === 'other' ? source_note || null : null,
      notes: notes || null,
      created_by,
    })
    .select('id, property_id, guest_name, check_in, check_out, status, source, source_note, notes')
    .single()
  if (error) throw error
  return data
}

export async function updateRentalBooking(
  id,
  { property_id, guest_name, check_in, check_out, status, source, source_note, notes },
) {
  if (await hasOverlappingBooking(property_id, check_in, check_out, id)) {
    throw new Error('This unit already has a booking that overlaps those dates.')
  }
  const { data, error } = await supabase
    .from('rental_bookings')
    .update({
      property_id,
      guest_name,
      check_in,
      check_out,
      status: status || 'confirmed',
      source: source || null,
      source_note: source === 'other' ? source_note || null : null,
      notes: notes || null,
    })
    .eq('id', id)
    .select('id, property_id, guest_name, check_in, check_out, status, source, source_note, notes')
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

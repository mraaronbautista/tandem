import { supabase } from './supabaseClient'

const STAFF_COLUMNS = 'id, display_name, hourly_rate, emergency_rate, active'
const WORK_SITE_COLUMNS =
  'id, name, address, latitude, longitude, geofence_radius_m, rental_property_id, active'
const TIME_ENTRY_COLUMNS =
  'id, staff_id, work_site_id, rate_type, rate_amount, clock_in_at, clock_in_lat, clock_in_lng, ' +
  'clock_in_accuracy_m, distance_from_site_m, flagged, clock_out_at, clock_out_lat, clock_out_lng, ' +
  'status, approved_by, approved_at, notes, created_at'

// Whole roster (Ada/Aaron's admin dashboard) — includes inactive staff
// so a deactivated account's history still shows a real name, not a
// blank join.
export async function fetchStaffRoster() {
  const { data, error } = await supabase.from('staff').select(STAFF_COLUMNS).order('display_name')
  if (error) throw error
  return data
}

// A signed-in staff account's own row — RLS lets them read this even
// while deactivated (see schema.sql), so StaffClockView.jsx can show a
// clear "you're deactivated" state instead of an empty/ambiguous one.
export async function fetchOwnStaffProfile(id) {
  const { data, error } = await supabase.from('staff').select(STAFF_COLUMNS).eq('id', id).single()
  if (error) throw error
  return data
}

export async function updateStaffProfile(id, { display_name, hourly_rate, emergency_rate }) {
  const { data, error } = await supabase
    .from('staff')
    .update({ display_name, hourly_rate, emergency_rate })
    .eq('id', id)
    .select(STAFF_COLUMNS)
    .single()
  if (error) throw error
  return data
}

// Soft-disable, not a delete — matches archiveRentalProperty's own
// reasoning: keeps time_entries history intact for someone who leaves.
export async function setStaffActive(id, active) {
  const { error } = await supabase.from('staff').update({ active }).eq('id', id)
  if (error) throw error
}

// Same query works for both roles — RLS decides what comes back
// (members: every site; staff: active sites only).
export async function fetchWorkSites() {
  const { data, error } = await supabase.from('work_sites').select(WORK_SITE_COLUMNS).order('name')
  if (error) throw error
  return data
}

export async function createWorkSite({ name, address, latitude, longitude, geofence_radius_m, active }) {
  const { data, error } = await supabase
    .from('work_sites')
    .insert({
      name,
      address: address || null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      geofence_radius_m: geofence_radius_m || 100,
      active,
    })
    .select(WORK_SITE_COLUMNS)
    .single()
  if (error) throw error
  return data
}

export async function updateWorkSite(
  id,
  { name, address, latitude, longitude, geofence_radius_m, active },
) {
  const { data, error } = await supabase
    .from('work_sites')
    .update({
      name,
      address: address || null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      geofence_radius_m,
      active,
    })
    .eq('id', id)
    .select(WORK_SITE_COLUMNS)
    .single()
  if (error) throw error
  return data
}

// A physical clock-in location can contain many rental units, while a
// unit belongs to at most one physical place. Rachel, for example,
// covers four units but only one GPS/geofence.
export async function assignRentalPropertiesToWorkSite(workSiteId, propertyIds) {
  const { error: clearError } = await supabase
    .from('rental_properties')
    .update({ work_site_id: null })
    .eq('work_site_id', workSiteId)
  if (clearError) throw clearError
  if (!propertyIds.length) return
  const { error } = await supabase.from('rental_properties').update({ work_site_id: workSiteId }).in('id', propertyIds)
  if (error) throw error
}

export async function archiveWorkSite(id) {
  const { error } = await supabase.from('work_sites').update({ active: false }).eq('id', id)
  if (error) throw error
}

// The one open (not-yet-clocked-out) entry for a staff member, if any —
// drives StaffClockView.jsx's Start-vs-Stop state. null when nothing is
// open. Relies on time_entries_one_active_per_staff (schema.sql) to
// guarantee this is ever at most one row.
export async function fetchActiveEntry(staffId) {
  const { data, error } = await supabase
    .from('time_entries')
    .select(TIME_ENTRY_COLUMNS)
    .eq('staff_id', staffId)
    .is('clock_out_at', null)
    .maybeSingle()
  if (error) throw error
  return data
}

// rate_amount/distance_from_site_m/flagged are never set here — the
// stamp_time_entry_meta() trigger (schema.sql) stamps all three
// server-side and overwrites anything submitted for them.
export async function clockIn({ staffId, workSiteId, rateType, lat, lng, accuracyM, notes }) {
  const { data, error } = await supabase
    .from('time_entries')
    .insert({
      staff_id: staffId,
      work_site_id: workSiteId,
      rate_type: rateType,
      clock_in_lat: lat,
      clock_in_lng: lng,
      clock_in_accuracy_m: accuracyM ?? null,
      notes: notes || null,
    })
    .select(TIME_ENTRY_COLUMNS)
    .single()
  if (error) throw error
  return data
}

// The only way a staff account can end a shift — see staff_clock_out()
// in schema.sql. lat/lng are optional: a bad GPS fix at the end of a
// shift shouldn't block stopping it.
export async function clockOut({ entryId, lat, lng }) {
  const { data, error } = await supabase.rpc('staff_clock_out', {
    p_entry_id: entryId,
    p_lat: lat ?? null,
    p_lng: lng ?? null,
  })
  if (error) throw error
  return data
}

export async function fetchOwnTimeEntries(staffId, { from, to } = {}) {
  let query = supabase
    .from('time_entries')
    .select(TIME_ENTRY_COLUMNS)
    .eq('staff_id', staffId)
    .order('clock_in_at', { ascending: false })
  if (from) query = query.gte('clock_in_at', from)
  if (to) query = query.lt('clock_in_at', to)
  const { data, error } = await query
  if (error) throw error
  return data
}

// Admin dashboard — joined with the staff/work-site names so
// StaffLogsView.jsx doesn't need a second round-trip per row.
export async function fetchAllTimeEntries({ from, to, status } = {}) {
  let query = supabase
    .from('time_entries')
    .select(`${TIME_ENTRY_COLUMNS}, staff(display_name), work_sites(name)`)
    .order('clock_in_at', { ascending: false })
  if (from) query = query.gte('clock_in_at', from)
  if (to) query = query.lt('clock_in_at', to)
  if (status) query = query.eq('status', status)
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function approveTimeEntry(entryId, approverId) {
  const { error } = await supabase
    .from('time_entries')
    .update({ status: 'approved', approved_by: approverId, approved_at: new Date().toISOString() })
    .eq('id', entryId)
  if (error) throw error
}

// Hours * the rate snapshotted at clock-in — never a stored column, so
// it can't drift if rate_amount is ever corrected before approval.
// Same "derive it, don't store it" reasoning duration_minutes/end-time
// and chargeDatesForBooking() already use elsewhere in this app. null
// while still clocked in (no clock_out_at yet).
export function computeEntryPay(entry) {
  if (!entry.clock_out_at) return null
  const hours = (new Date(entry.clock_out_at) - new Date(entry.clock_in_at)) / 3_600_000
  return hours * Number(entry.rate_amount)
}

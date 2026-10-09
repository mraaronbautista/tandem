import { supabase } from './supabaseClient'
import { addDaysStr } from './unitTimeline'

export const SCHEDULE_DAYS = 60
export const NO_LOCATION = '__none__'

// The house manager's read-only schedule. The database function
// staff_schedule() is the only door: it returns a fixed, small projection
// (tenant first name + last initial, never phone/rent/notes) and refuses
// anyone who is not an active staff account.
export async function fetchStaffSchedule(today, days = SCHEDULE_DAYS) {
  const { data, error } = await supabase.rpc('staff_schedule', { p_from: today, p_days: days })
  if (error) throw error
  return data || []
}

export function isScheduleMissing(err) {
  // PostgREST: function not found in the schema cache.
  return err?.code === 'PGRST202' || err?.code === '42883'
}

// Locations present in the rows, in name order, with "No location" last when
// some rows have none. Used for the filter chips.
export function scheduleLocations(rows) {
  const byId = new Map()
  let hasNone = false
  for (const r of rows) {
    if (r.location_id) byId.set(r.location_id, r.location_name || 'Unnamed location')
    else hasNone = true
  }
  const list = [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  if (hasNone) list.push({ id: NO_LOCATION, name: 'No location' })
  return list
}

// Groups rows by day for the chosen location (null = everything).
export function groupScheduleByDay(rows, locationId = null) {
  const wanted = (r) =>
    !locationId || (locationId === NO_LOCATION ? !r.location_id : r.location_id === locationId)
  const days = new Map()
  for (const r of rows) {
    if (!wanted(r)) continue
    if (!days.has(r.event_date)) days.set(r.event_date, [])
    days.get(r.event_date).push(r)
  }
  return [...days.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, items]) => ({ date, items }))
}

export function dayHeading(dateStr, today) {
  if (dateStr === today) return 'Today'
  if (dateStr === addDaysStr(today, 1)) return 'Tomorrow'
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
}

// Digits (and a leading +) only, safe to put in a tel: link.
export function telHref(phone) {
  const cleaned = String(phone || '').replace(/[^\d+]/g, '')
  return cleaned.replace(/\D/g, '').length >= 7 ? `tel:${cleaned}` : ''
}

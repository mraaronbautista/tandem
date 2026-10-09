// Builds what the "What's happening" sheet shows for one unit: its upcoming
// move-outs and move-ins (from bookings) together with the visits someone
// has scheduled (cleaner, plumber, ...). Pure functions, no Supabase, so the
// rules can be checked on their own.
//
// All dates are plain 'YYYY-MM-DD' strings, like every rental date in this
// app. `check_out` on a booking is the LAST OCCUPIED day, inclusive.

export const CLEANING_NUDGE_DAYS = 21 // only nudge for a move-out this close
const CLEANING_WINDOW_DAYS = 30 // how long after a move-out a cleaning still counts

export function addDaysStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  const pad = (n) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

// Same normalization rentals.js's bookingGuestLabel applies (a booking can
// hold several tenants); kept local so this file stays free of the app's
// Supabase client.
function guestLabel(booking) {
  const names = (booking?.guest_names || []).map((n) => n.trim()).filter(Boolean)
  if (names.length) return names.join(' and ')
  return booking?.guest_name || ''
}

// A visit applies to a unit if it is for that unit, or for the whole location
// the unit belongs to.
export function visitsForUnit(visits, unit) {
  return (visits || []).filter(
    (v) => v.property_id === unit.id || (unit.work_site_id && v.work_site_id === unit.work_site_id),
  )
}

// Visits still ahead (or today) and not done: what the card badge counts.
export function upcomingVisitCount(visits, unit, today) {
  return visitsForUnit(visits, unit).filter((v) => v.status === 'scheduled' && v.visit_date >= today).length
}

export function formatVisitTime(time) {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

const TYPE_ORDER = { 'move-out': 0, visit: 1, available: 2, 'move-in': 3 }

export function buildUnitTimeline({ unit, bookings, visits, today }) {
  const unitBookings = (bookings || []).filter((b) => b.property_id === unit.id)
  const confirmed = unitBookings.filter((b) => b.status === 'confirmed')
  const unitVisits = visitsForUnit(visits, unit)
  const events = []

  for (const b of confirmed) {
    if (b.check_out < today) continue
    const others = confirmed.filter((o) => o.id !== b.id && o.check_in >= b.check_out)
    const next = others.sort((a, c) => a.check_in.localeCompare(c.check_in))[0]

    // "No cleaning booked yet": nothing with "clean" in its type between this
    // move-out and the next move-in (or a month after, if none is booked).
    const windowEnd = next ? next.check_in : addDaysStr(b.check_out, CLEANING_WINDOW_DAYS)
    const soon = b.check_out <= addDaysStr(today, CLEANING_NUDGE_DAYS)
    const hasCleaning = unitVisits.some(
      (v) => /clean/i.test(v.kind) && v.visit_date >= b.check_out && v.visit_date <= windowEnd,
    )
    events.push({
      key: `out-${b.id}`,
      type: 'move-out',
      date: b.check_out,
      guest: guestLabel(b),
      needsCleaning: soon && !hasCleaning,
    })

    const availableOn = addDaysStr(b.check_out, 1)
    if (!next || next.check_in > availableOn) {
      events.push({
        key: `free-${b.id}`,
        type: 'available',
        date: availableOn,
        nextMoveIn: next ? next.check_in : null,
      })
    }
  }

  for (const b of unitBookings) {
    if (b.check_in >= today) {
      events.push({ key: `in-${b.id}`, type: 'move-in', date: b.check_in, guest: guestLabel(b), pending: b.status === 'pending' })
    }
  }

  const past = []
  for (const v of unitVisits) {
    const event = {
      key: `visit-${v.id}`,
      type: 'visit',
      date: v.visit_date,
      time: v.visit_time,
      visit: v,
      overdue: v.status === 'scheduled' && v.visit_date < today,
    }
    if (v.status === 'done') past.push(event)
    else events.push(event)
  }

  const byWhen = (a, b) =>
    a.date.localeCompare(b.date) ||
    TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
    (a.time || '').localeCompare(b.time || '')
  events.sort(byWhen)
  // Missed visits float to the top so they are not buried under later dates.
  events.sort((a, b) => Number(!!b.overdue) - Number(!!a.overdue))
  past.sort((a, b) => byWhen(b, a))
  return { upcoming: events, past }
}

// Types people have used before, most used first, so a typed one-off becomes
// a one-tap chip next time.
export function recentVisitKinds(visits, limit = 6) {
  const counts = new Map()
  for (const v of visits || []) {
    const kind = (v.kind || '').trim()
    if (kind) counts.set(kind, (counts.get(kind) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([k]) => k)
}

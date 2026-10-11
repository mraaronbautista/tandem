// Reminders for the house manager (a staff account, not a member): a visit
// starting in about an hour, a dated visit on the morning of its day, and an
// evening-before digest of tomorrow's move-outs and move-ins.
//
// No imports on purpose, so this can be tested without Deno: the database
// client and the push sender are passed in by notify-reminders.
//
// Rules (agreed with Aaron, Oct 11 2026):
//  * Everything follows the LOCATION's time zone (a unit with no location uses
//    Eastern, like the rest of the app).
//  * A visit with a time reminds ~1 hour before it starts. A visit with only a
//    date reminds at 8 AM on the day (until 5 PM).
//  * Tomorrow's move-outs and move-ins (confirmed bookings, active units) are
//    sent as ONE alert per evening, from 6 PM to 10 PM property time.
//  * A reminder counts as sent only once at least one of his phones took it.
//    If he has no alerts on yet it keeps waiting until its window closes, so
//    turning alerts on at 5:30 PM still gets that evening's reminder.
//  * The "sent" marks are cleared by database triggers when a visit or booking
//    is rescheduled (supabase/add-staff-reminders.sql), so a moved visit
//    reminds again.

export const DEFAULT_ZONE = 'America/New_York'

const ZONE_LABELS: Record<string, string> = {
  'America/New_York': 'ET',
  'America/Chicago': 'CT',
  'America/Denver': 'MT',
  'America/Los_Angeles': 'PT',
  'Asia/Manila': 'PHT',
}

export const HOUR_BEFORE_MINUTES = 60
export const MORNING_START_MINUTES = 8 * 60
export const MORNING_END_MINUTES = 17 * 60
export const EVENING_START_MINUTES = 18 * 60
export const EVENING_END_MINUTES = 22 * 60
const DIGEST_BODY_LIMIT = 180

function pad(n: number) {
  return String(n).padStart(2, '0')
}

export function zoneLabel(tz: string | null | undefined): string {
  return ZONE_LABELS[tz || DEFAULT_ZONE] || ''
}

// Bare calendar arithmetic ('YYYY-MM-DD'), independent of the server's zone.
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

// The wall clock in a zone at an instant: calendar date and minutes since
// midnight.
export function localParts(at: Date, tz: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '0'
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  }
}

// The instant a wall-clock date and time ('HH:MM' or 'HH:MM:SS') happens in a
// zone. Two passes handle a clock change between the guess and the answer.
export function wallClockToInstant(dateStr: string, timeStr: string, tz: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [hh, mm] = timeStr.split(':').map(Number)
  const asUtc = Date.UTC(y, m - 1, d, hh, mm)
  const offsetAt = (ms: number) => {
    const p = localParts(new Date(ms), tz)
    const [py, pm, pd] = p.date.split('-').map(Number)
    return Date.UTC(py, pm - 1, pd, 0, p.minutes) - ms
  }
  let guess = asUtc - offsetAt(asUtc)
  guess = asUtc - offsetAt(guess)
  return new Date(guess)
}

// '14:30:00' -> '2:30 PM'
export function clockText(timeStr: string): string {
  const [hh, mm] = timeStr.split(':').map(Number)
  const h12 = hh % 12 === 0 ? 12 : hh % 12
  return `${h12}:${pad(mm)} ${hh < 12 ? 'AM' : 'PM'}`
}

// First name + last initial ("Jordan K."), the only form of a tenant's name
// staff ever see. Mirrors staff_tenant_label() in the database.
export function tenantLabel(guestNames: string[] | null | undefined, guestName: string | null | undefined): string {
  const names = guestNames?.length ? guestNames : [guestName || '']
  const labels = names
    .map((n) => String(n || '').trim().split(/\s+/).filter(Boolean))
    .filter((parts) => parts.length > 0)
    .map((parts) => (parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`))
  return labels.length ? labels.join(' and ') : 'Tenant'
}

export type Place = { unitName: string | null; locationName: string | null; tz: string }

export type VisitRow = {
  id: string
  kind: string
  who: string | null
  visit_date: string
  visit_time: string | null
  property_id: string | null
  work_site_id: string | null
}

export type BookingRow = {
  id: string
  property_id: string
  guest_name: string | null
  guest_names: string[] | null
  check_in: string
  check_out: string
  staff_moveout_reminder_sent_at: string | null
  staff_movein_reminder_sent_at: string | null
}

export type Property = { id: string; unit_name: string; active: boolean; work_site_id: string | null }
export type Site = { id: string; name: string; timezone: string | null }

export function placeFor(
  visit: { property_id: string | null; work_site_id: string | null },
  properties: Map<string, Property>,
  sites: Map<string, Site>,
): Place | null {
  if (visit.property_id) {
    const p = properties.get(visit.property_id)
    if (!p || !p.active) return null
    const site = p.work_site_id ? sites.get(p.work_site_id) : undefined
    return { unitName: p.unit_name, locationName: site?.name || null, tz: site?.timezone || DEFAULT_ZONE }
  }
  const site = visit.work_site_id ? sites.get(visit.work_site_id) : undefined
  if (!site) return null
  return { unitName: null, locationName: site.name, tz: site.timezone || DEFAULT_ZONE }
}

function placeText(place: Place): string {
  if (place.unitName) return place.locationName ? `${place.unitName}, ${place.locationName}` : place.unitName
  return place.locationName ? `Whole building, ${place.locationName}` : 'Whole building'
}

export type Alert = { title: string; body: string }

// The alert for a visit if it is due to be sent right now, otherwise null.
export function visitReminder(visit: VisitRow, place: Place, now: Date): Alert | null {
  const where = [visit.who?.trim(), placeText(place)].filter(Boolean)
  if (visit.visit_time) {
    const start = wallClockToInstant(visit.visit_date, visit.visit_time, place.tz)
    const minutesLeft = (start.getTime() - now.getTime()) / 60_000
    if (minutesLeft <= 0 || minutesLeft > HOUR_BEFORE_MINUTES) return null
    const label = zoneLabel(place.tz)
    const when = `${clockText(visit.visit_time)}${label ? ` ${label}` : ''}`
    return {
      title: `${minutesLeft >= 50 ? 'In 1 hour' : `In ${Math.max(1, Math.round(minutesLeft))} min`}: ${visit.kind}`,
      body: [...where, when].join(' · '),
    }
  }
  const local = localParts(now, place.tz)
  if (local.date !== visit.visit_date) return null
  if (local.minutes < MORNING_START_MINUTES || local.minutes >= MORNING_END_MINUTES) return null
  return { title: `Today: ${visit.kind}`, body: where.join(' · ') }
}

export type MoveEvent = {
  bookingId: string
  kind: 'move_out' | 'move_in'
  column: 'staff_moveout_reminder_sent_at' | 'staff_movein_reminder_sent_at'
  unitName: string
  tenant: string
}

// The move-outs and move-ins that should be in tonight's digest: tomorrow in
// the unit's own zone, and the local clock inside the evening window.
export function dueMoveEvents(
  bookings: BookingRow[],
  properties: Map<string, Property>,
  sites: Map<string, Site>,
  now: Date,
): MoveEvent[] {
  const events: MoveEvent[] = []
  for (const b of bookings) {
    const place = placeFor({ property_id: b.property_id, work_site_id: null }, properties, sites)
    if (!place) continue
    const local = localParts(now, place.tz)
    if (local.minutes < EVENING_START_MINUTES || local.minutes >= EVENING_END_MINUTES) continue
    const tomorrow = addDays(local.date, 1)
    const tenant = tenantLabel(b.guest_names, b.guest_name)
    if (b.check_out === tomorrow && !b.staff_moveout_reminder_sent_at) {
      events.push({ bookingId: b.id, kind: 'move_out', column: 'staff_moveout_reminder_sent_at', unitName: place.unitName || 'a unit', tenant })
    }
    if (b.check_in === tomorrow && !b.staff_movein_reminder_sent_at) {
      events.push({ bookingId: b.id, kind: 'move_in', column: 'staff_movein_reminder_sent_at', unitName: place.unitName || 'a unit', tenant })
    }
  }
  return events
}

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

// One alert for all of tonight's moves: move-outs first, then move-ins.
export function moveDigest(events: MoveEvent[]): Alert | null {
  if (events.length === 0) return null
  const outs = events.filter((e) => e.kind === 'move_out').sort((a, b) => a.unitName.localeCompare(b.unitName))
  const ins = events.filter((e) => e.kind === 'move_in').sort((a, b) => a.unitName.localeCompare(b.unitName))
  const title = `Tomorrow: ${[outs.length ? count(outs.length, 'move-out', 'move-outs') : '', ins.length ? count(ins.length, 'move-in', 'move-ins') : ''].filter(Boolean).join(', ')}`
  const lines = [
    ...outs.map((e) => `${e.tenant} moves out of ${e.unitName}`),
    ...ins.map((e) => `${e.tenant} moves in to ${e.unitName}`),
  ]
  let body = ''
  let shown = 0
  for (const line of lines) {
    const next = body ? `${body} · ${line}` : line
    const remaining = lines.length - shown - 1
    // Leave room for a "+N more" tail when something would be cut.
    if (next.length > DIGEST_BODY_LIMIT - (remaining > 0 ? 12 : 0) && shown > 0) break
    body = next
    shown += 1
  }
  if (shown < lines.length) body += ` · +${lines.length - shown} more`
  return { title, body }
}

// ---- Orchestration (database and push are passed in) ------------------------

type Admin = { from: (table: string) => any }
export type PushResult = { delivered: number; retry: boolean }
export type Deps = {
  admin: Admin
  notifyStaff: (payload: { title: string; body: string; url: string }) => Promise<PushResult>
}

export type StaffReminderData = {
  visits: VisitRow[]
  bookings: BookingRow[]
  properties: Map<string, Property>
  sites: Map<string, Site>
}

// All the reads, started together. Dates are padded by a day on each side:
// a location's calendar day can differ from the server's by up to a day.
export async function loadStaffReminderData(admin: Admin, now: Date): Promise<StaffReminderData> {
  const utcToday = now.toISOString().slice(0, 10)
  const lo = addDays(utcToday, -1)
  const hi = addDays(utcToday, 2)
  const [visits, bookings, properties, sites] = await Promise.all([
    admin
      .from('rental_visits')
      .select('id, kind, who, visit_date, visit_time, property_id, work_site_id')
      .eq('status', 'scheduled')
      .is('staff_reminder_sent_at', null)
      .gte('visit_date', lo)
      .lte('visit_date', hi),
    admin
      .from('rental_bookings')
      .select('id, property_id, guest_name, guest_names, check_in, check_out, staff_moveout_reminder_sent_at, staff_movein_reminder_sent_at')
      .eq('status', 'confirmed')
      .or(`and(check_in.gte.${lo},check_in.lte.${hi}),and(check_out.gte.${lo},check_out.lte.${hi})`),
    admin.from('rental_properties').select('id, unit_name, active, work_site_id'),
    admin.from('work_sites').select('id, name, timezone'),
  ])
  for (const r of [visits, bookings, properties, sites]) {
    if (r.error) throw new Error(r.error.message)
  }
  return {
    visits: visits.data || [],
    bookings: bookings.data || [],
    properties: new Map((properties.data || []).map((p: Property) => [p.id, p])),
    sites: new Map((sites.data || []).map((s: Site) => [s.id, s])),
  }
}

async function mark(admin: Admin, table: string, id: string, column: string) {
  const { error } = await admin.from(table).update({ [column]: new Date().toISOString() }).eq('id', id)
  if (error) console.error(`staffReminders: could not mark ${table} ${id}: ${error.message}`)
}

// Sends whatever is due right now. A reminder is marked sent only when at
// least one phone took it; otherwise it stays due until its window closes.
// Returns what it did, for logs and tests.
export async function sendStaffReminders(deps: Deps, data: StaffReminderData, now: Date) {
  const sent = { visits: 0, digests: 0 }

  for (const visit of data.visits) {
    const place = placeFor(visit, data.properties, data.sites)
    if (!place) continue
    const alert = visitReminder(visit, place, now)
    if (!alert) continue
    const result = await deps.notifyStaff({ ...alert, url: '/' })
    if (result.delivered > 0) {
      await mark(deps.admin, 'rental_visits', visit.id, 'staff_reminder_sent_at')
      sent.visits += 1
    }
  }

  const events = dueMoveEvents(data.bookings, data.properties, data.sites, now)
  const digest = moveDigest(events)
  if (digest) {
    const result = await deps.notifyStaff({ ...digest, url: '/' })
    if (result.delivered > 0) {
      for (const e of events) await mark(deps.admin, 'rental_bookings', e.bookingId, e.column)
      sent.digests += 1
    }
  }
  return sent
}

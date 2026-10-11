import { TIMEZONE_OPTIONS, zonedTimeToUtcIso, zoneAbbreviation } from './timezone'

// Each rental location has a time zone (work_sites.timezone). A visit's date
// and time are plain wall-clock values AT THE PROPERTY; the zone only decides
// how they are labelled ("2:30 PM ET"), what they are worth to a viewer in
// another zone ("3:30 AM Wed your time"), and which calendar day counts as
// "today" for a unit. Tasks are not affected: each task keeps its own zone.

// All current locations are in the Cincinnati area. Used only when a location
// row has no zone yet (the database default is the same value).
export const DEFAULT_LOCATION_TZ = 'America/New_York'

export function viewerZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return DEFAULT_LOCATION_TZ
  }
}

// The zone for a location id, or null when the unit has no location (then
// nothing is labelled or converted, exactly as before zones existed).
export function zoneForSite(workSiteId, locations) {
  if (!workSiteId) return null
  const site = (locations || []).find((l) => l.id === workSiteId)
  return site ? site.timezone || DEFAULT_LOCATION_TZ : null
}

// 'Eastern' for 'America/New_York', for sentences like "Eastern time, at the property."
export function zoneName(tz) {
  const option = TIMEZONE_OPTIONS.find((o) => o.value === tz)
  return option ? option.label.replace(/\s*\(.*\)$/, '') : tz || ''
}

// 'YYYY-MM-DD' for the calendar day it is right now in `tz` (the viewer's own
// zone when tz is empty). en-CA formats as year-month-day.
export function todayInZone(tz, now = new Date()) {
  const options = { year: 'numeric', month: '2-digit', day: '2-digit' }
  if (tz) options.timeZone = tz
  return new Intl.DateTimeFormat('en-CA', options).format(now)
}

function to12Hour(h, m) {
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

function partsIn(tz, instant) {
  const map = {}
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(instant)) map[p.type] = p.value
  return { date: `${map.year}-${map.month}-${map.day}`, h: Number(map.hour), m: Number(map.minute), weekday: map.weekday }
}

// How a visit's time reads. `label` is the property's own time with its zone
// ("2:30 PM ET"); `yours` is the same moment in the viewer's zone ("3:30 AM
// Wed your time"), empty when it is the same clock time there. No time on the
// visit, or no zone known for the location: just the plain time, as before.
export function visitTimeText({ date, time, tz, viewerTz = viewerZone() }) {
  if (!time) return { label: '', yours: '' }
  const [h, m] = time.split(':').map(Number)
  const plain = to12Hour(h, m)
  if (!tz || !date) return { label: plain, yours: '' }
  const label = `${plain} ${zoneAbbreviation(tz)}`
  if (viewerTz === tz) return { label, yours: '' }
  const instant = new Date(zonedTimeToUtcIso(date, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, tz))
  const there = partsIn(tz, instant)
  const here = partsIn(viewerTz, instant)
  if (there.date === here.date && there.h === here.h && there.m === here.m) return { label, yours: '' }
  const clock = to12Hour(here.h, here.m)
  return { label, yours: `${clock}${here.date !== there.date ? ` ${here.weekday}` : ''} your time` }
}

// Common zones for a 2-person, 2-continent household — Ada travels around
// the US (Cincinnati is Eastern, same as her usual EST/EDT, so it doesn't
// need its own entry), Aaron is fixed in the Philippines. This picker is
// only used when setting a task's time, so you can target Ada's zone
// precisely regardless of your own device's timezone — display elsewhere
// always converts to whoever is actually looking, in their own local time.
export const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'Asia/Manila', label: 'Philippines (PHT)' },
]

export const DEFAULT_TIMEZONE = 'America/New_York'

// The device's own IANA zone, mapped to the matching TIMEZONE_OPTIONS
// entry if there is one, else DEFAULT_TIMEZONE. Used to seed a new task's
// due_timezone so a lazily-created task (nobody touched the Time/
// Timezone fields) lands at "9 AM" for whoever's actually creating it —
// previously this defaulted to Eastern unconditionally, so a task Aaron
// created in the Philippines (UTC+8, ~12-13h ahead of Eastern) landed at
// 9 AM Eastern, which displays as ~9 PM in his own local time. The same
// bug pushed PrioritiesForm.jsx/CorkBoardView.jsx's "due today 23:59"
// auto-dates into tomorrow morning for him, defeating the point of that
// field (so it can go overdue today, like any other task).
export function detectDefaultTimezone() {
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return TIMEZONE_OPTIONS.some((tz) => tz.value === deviceZone) ? deviceZone : DEFAULT_TIMEZONE
}

function partsToMap(parts) {
  const map = {}
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value
  return map
}

// How far `timeZone`'s wall clock is from UTC at the moment `utcInstant`
// represents, in ms (e.g. Eastern in July is -4h).
function offsetAt(timeZone, utcInstant) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const map = partsToMap(dtf.formatToParts(utcInstant))
  const asUtc = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second)
  return asUtc - utcInstant.getTime()
}

// A wall-clock date+time picked while intending a specific IANA zone (e.g.
// "3:00 PM" meant as Eastern) -> the correct UTC instant, DST-aware.
export function zonedTimeToUtcIso(dateStr, timeStr, timeZone) {
  const naiveUtc = new Date(`${dateStr}T${timeStr}:00Z`)
  const offset = offsetAt(timeZone, naiveUtc)
  return new Date(naiveUtc.getTime() - offset).toISOString()
}

// The reverse, for prefilling the edit form: given a stored UTC instant and
// the zone it was originally set in, recover the wall-clock date/time —
// editing stays in the originally-targeted zone so re-adjusting "3pm her
// time" doesn't get confused with whatever that currently converts to for
// whoever happens to be editing it.
export function splitDueDateInZone(isoString, timeZone) {
  if (!isoString) return { due_date: '', due_time: '09:00' }
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const map = partsToMap(dtf.formatToParts(new Date(isoString)))
  return { due_date: `${map.year}-${map.month}-${map.day}`, due_time: `${map.hour}:${map.minute}` }
}

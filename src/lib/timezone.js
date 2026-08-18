// Common zones for a 2-person, 2-continent household — Ada's usual zone is
// Central, but she travels around the US (the other US entries below cover
// that), Aaron is fixed in the Philippines. This picker is only used when
// setting a task's time, so you can target Ada's zone precisely regardless
// of your own device's timezone — display elsewhere always converts to
// whoever is actually looking, in their own local time.
export const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'Asia/Manila', label: 'Philippines (PHT)' },
]

export const DEFAULT_TIMEZONE = 'America/Chicago'

// The signed-in member's own explicit choice (SettingsMenu.jsx, persisted
// to members.default_timezone) — set once on load/change by TaskBoard.jsx
// via setPreferredTimezone. A plain module-level variable rather than
// something threaded through props, since detectDefaultTimezone() is
// called from plenty of places (TaskForm.jsx's emptyTaskForm,
// CorkBoardView.jsx, PrioritiesForm.jsx) that would otherwise all need
// `me`/`members` piped in just for this. Null until members have loaded
// and the signed-in member's row is known.
let preferredTimezone = null

export function setPreferredTimezone(timezone) {
  preferredTimezone = timezone || null
}

// The signed-in member's explicit preference if they've set one, else the
// device's own IANA zone (mapped to the matching TIMEZONE_OPTIONS entry if
// there is one), else DEFAULT_TIMEZONE. Used to seed a new task's
// due_timezone so a lazily-created task (nobody touched the Time/
// Timezone fields) lands at "9 AM" for whoever's actually creating it —
// previously this defaulted to Eastern unconditionally, so a task Aaron
// created in the Philippines (UTC+8, ~12-13h ahead of Eastern) landed at
// 9 AM Eastern, which displays as ~9 PM in his own local time. The same
// bug pushed PrioritiesForm.jsx/CorkBoardView.jsx's "due today 23:59"
// auto-dates into tomorrow morning for him, defeating the point of that
// field (so it can go overdue today, like any other task).
export function detectDefaultTimezone() {
  if (preferredTimezone) return preferredTimezone
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return TIMEZONE_OPTIONS.some((tz) => tz.value === deviceZone) ? deviceZone : DEFAULT_TIMEZONE
}

const ZONE_ABBR = Object.fromEntries(
  TIMEZONE_OPTIONS.map((tz) => [tz.value, tz.label.match(/\(([^)]+)\)/)?.[1] || tz.value]),
)

// Short abbreviation for a task's due_timezone, for a compact
// at-a-glance badge next to its due time — which zone it was actually
// *set* in, distinct from the due time itself (always shown in whichever
// zone the viewer is currently in, unlabeled — see localLabel in
// TaskRow.jsx). Exists so a task set in the wrong zone (the household's
// actual failure mode this was built for — a shift meant for Ada's
// Central time accidentally entered while the form still had Aaron's
// Manila zone selected, landing 13 hours off) is visible at a glance
// instead of only surfacing once someone's already missed it. Falls back
// to the device's own short zone name for any IANA zone outside the
// curated TIMEZONE_OPTIONS list — in practice every due_timezone this
// app ever writes comes from that list, so this is just a safety net.
export function zoneAbbreviation(timeZone) {
  if (!timeZone) return ''
  if (ZONE_ABBR[timeZone]) return ZONE_ABBR[timeZone]
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')
    return part?.value || timeZone
  } catch {
    return timeZone
  }
}

// Full label, e.g. "Central (CT)" — for the badge's tooltip, more
// explicit than the bare abbreviation for whoever's reading it.
export function zoneLabel(timeZone) {
  return TIMEZONE_OPTIONS.find((tz) => tz.value === timeZone)?.label || timeZone
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

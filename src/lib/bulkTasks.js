const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

// A bare 'Aug 21' with no year that's already in the past only rolls
// forward to next year once it's more than this many days stale. Without
// a grace window, a schedule whose first date section is "yesterday"
// (e.g. pasted the morning after, still covering an overnight shift that
// started the day before) got silently pushed a full year out — a
// "successful" parse with no error, just filed under the wrong year, so
// the task looked like it had vanished from the batch entirely.
const YEAR_ROLLOVER_GRACE_DAYS = 7

function pad(n) {
  return String(n).padStart(2, '0')
}

// A line on its own that names a date — everything after it (until the
// next date line) belongs to that date. Accepts 'YYYY-MM-DD', a loose
// 'Aug 21' / 'August 21' / 'Aug 21, 2026' form, or the relative 'Today'/
// 'Tomorrow' (optionally with a trailing colon, e.g. "Tomorrow:", since
// that's a natural way to head a quick note) — matching how most
// schedule tools actually print dates, or how someone jotting a note by
// hand actually writes one, so a line can often be pasted close to
// verbatim rather than needing to be retyped as ISO. A bare 'Aug 21'
// with no year assumes the current year, or next year if that date is
// more than YEAR_ROLLOVER_GRACE_DAYS in the past — the common "planning
// into next year" case, without misfiring on a schedule that starts a
// day or two ago.
function parseDateHeader(rawLine) {
  const line = rawLine.replace(/:\s*$/, '')

  const relative = line.trim().toLowerCase()
  if (relative === 'today' || relative === 'tomorrow') {
    const d = new Date()
    if (relative === 'tomorrow') d.setDate(d.getDate() + 1)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  let m = line.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`

  m = line.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/)
  if (!m) return null
  const monthIdx = MONTH_NAMES.findIndex((mo) => m[1].toLowerCase().startsWith(mo))
  if (monthIdx === -1) return null
  const day = Number(m[2])
  const today = new Date()
  const todayAtMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  let year = m[3] ? Number(m[3]) : today.getFullYear()
  let candidate = new Date(year, monthIdx, day)
  const daysPast = (todayAtMidnight - candidate) / (24 * 60 * 60 * 1000)
  if (!m[3] && daysPast > YEAR_ROLLOVER_GRACE_DAYS) {
    year += 1
    candidate = new Date(year, monthIdx, day)
  }
  if (candidate.getMonth() !== monthIdx || candidate.getDate() !== day) return null // e.g. "Feb 30"
  return `${year}-${pad(monthIdx + 1)}-${pad(day)}`
}

// '4', '4:30' + 'a'/'p' (from 'a'/'am'/'a.m.'/'p'/'pm'/'p.m.' — see
// SHIFT_RE, which only ever captures the leading letter) -> minutes
// since midnight, 12-hour-clock rules (12a is midnight, 12p is noon).
function toMinutes(numPart, ampm) {
  let [h, m] = numPart.split(':').map(Number)
  m = m || 0
  if (ampm.toLowerCase() === 'a') {
    if (h === 12) h = 0
  } else if (h !== 12) {
    h += 12
  }
  return h * 60 + m
}

// A shift line: title, then a trailing time range. Whatever's before the
// range — "Texas", "Washington 2a-5a" minus its own range — becomes the
// task title verbatim. Deliberately forgiving on the range itself: "am"/
// "pm"/"a.m."/"a" are all accepted (only the leading a/p is captured,
// letting "12am to 4am" and "12a-4a" both work), the separator can be a
// hyphen/en dash/em dash or the word "to"/"until", and a trailing "next
// day"/"(+1 day)" is accepted and ignored — crossing midnight is already
// detected from the times themselves (see below), so that annotation is
// only ever for the human reading it back, not something the parser
// needs. This is intentionally more permissive than the one example
// shown in the form's hint text, since real pasted schedules vary.
const SHIFT_RE =
  /^(.+?)\s+(\d{1,2}(?::\d{2})?)\s*([ap])\.?m?\.?\s*(?:-|–|—|to|until)\s*(\d{1,2}(?::\d{2})?)\s*([ap])\.?m?\.?(?:\s*,?\s*(?:next\s*day|\(?\+\s*1\s*day\)?))?\.?$/i

// The same shift, time range written first — "8 am – 9 am – 1072 Rachel
// (gas-leak repair)" — some schedules get jotted with the time up front
// instead of the title trailing it. Tried only after SHIFT_RE fails
// (title-first is still the primary documented format), and requires an
// explicit dash-like separator before the title (not just whitespace) so
// a title that happens to start with a number right after the time
// range isn't swallowed by accident.
const SHIFT_RE_TIME_FIRST =
  /^(\d{1,2}(?::\d{2})?)\s*([ap])\.?m?\.?\s*(?:-|–|—|to|until)\s*(\d{1,2}(?::\d{2})?)\s*([ap])\.?m?\.?\s*(?:-|–|—)\s*(.+?)\.?$/i

function buildShift(title, startNum, startAmPm, endNum, endAmPm) {
  const startMin = toMinutes(startNum, startAmPm)
  let endMin = toMinutes(endNum, endAmPm)
  if (endMin <= startMin) endMin += 24 * 60 // crosses midnight, e.g. 10p-2a
  return {
    title: title.trim(),
    due_time: `${pad(Math.floor(startMin / 60) % 24)}:${pad(startMin % 60)}`,
    duration_minutes: endMin - startMin,
  }
}

function parseShiftLine(line) {
  let m = line.match(SHIFT_RE)
  if (m) {
    const [, title, startNum, startAmPm, endNum, endAmPm] = m
    return buildShift(title, startNum, startAmPm, endNum, endAmPm)
  }

  m = line.match(SHIFT_RE_TIME_FIRST)
  if (m) {
    const [, startNum, startAmPm, endNum, endAmPm, title] = m
    return buildShift(title, startNum, startAmPm, endNum, endAmPm)
  }

  return null
}

// Parses a pasted schedule into { tasks, errors }. Format:
//   <date line>
//   <title> <start>-<end>
//   <title> <start>-<end>
//
//   <date line>
//   ...
// Blank lines are ignored; a shift line before any date line, or a line
// that doesn't match either shape, becomes an entry in `errors` (1-based
// line number + the raw text) instead of silently being dropped, so a
// typo doesn't just quietly vanish from a 20-line paste.
export function parseBulkSchedule(text) {
  const lines = text.split('\n')
  const tasks = []
  const errors = []
  let currentDate = null

  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (!line) return

    const date = parseDateHeader(line)
    if (date) {
      currentDate = date
      return
    }

    if (!currentDate) {
      errors.push({ line: i + 1, text: line, message: 'No date set yet — add a date line above this one.' })
      return
    }

    const shift = parseShiftLine(line)
    if (!shift) {
      errors.push({ line: i + 1, text: line, message: 'Couldn\'t read a time range (expected e.g. "Texas 12a-4a").' })
      return
    }

    tasks.push({ ...shift, due_date: currentDate })
  })

  return { tasks, errors }
}

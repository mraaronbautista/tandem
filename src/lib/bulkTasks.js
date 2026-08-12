const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function pad(n) {
  return String(n).padStart(2, '0')
}

// A line on its own that names a date — everything after it (until the
// next date line) belongs to that date. Accepts 'YYYY-MM-DD' or a loose
// 'Aug 21' / 'August 21' / 'Aug 21, 2026' form, matching how most
// schedule tools actually print dates, so a line can often be pasted
// close to verbatim rather than needing to be retyped as ISO. A bare
// 'Aug 21' with no year assumes the current year, or next year if that
// date already passed — the common "planning into next year" case.
function parseDateHeader(line) {
  let m = line.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`

  m = line.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/)
  if (!m) return null
  const monthIdx = MONTH_NAMES.findIndex((mo) => m[1].toLowerCase().startsWith(mo))
  if (monthIdx === -1) return null
  const day = Number(m[2])
  const today = new Date()
  let year = m[3] ? Number(m[3]) : today.getFullYear()
  let candidate = new Date(year, monthIdx, day)
  if (!m[3] && candidate < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
    year += 1
    candidate = new Date(year, monthIdx, day)
  }
  if (candidate.getMonth() !== monthIdx || candidate.getDate() !== day) return null // e.g. "Feb 30"
  return `${year}-${pad(monthIdx + 1)}-${pad(day)}`
}

// '4', '4:30' + 'a'/'p' -> minutes since midnight, 12-hour-clock rules
// (12a is midnight, 12p is noon).
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

// A shift line: title, then a trailing time range like "12a-4a" or
// "2:30p-5p". Whatever's before the time range — "Texas", "Washington
// 2a-5a" minus its own range — becomes the task title verbatim, so a
// line can usually be pasted straight out of a schedule tool's own
// display ("Texas 12a-4a") with no reformatting.
const SHIFT_RE = /^(.+?)\s+(\d{1,2}(?::\d{2})?)([ap])\s*-\s*(\d{1,2}(?::\d{2})?)([ap])$/i

function parseShiftLine(line) {
  const m = line.match(SHIFT_RE)
  if (!m) return null
  const [, title, startNum, startAmPm, endNum, endAmPm] = m
  const startMin = toMinutes(startNum, startAmPm)
  let endMin = toMinutes(endNum, endAmPm)
  if (endMin <= startMin) endMin += 24 * 60 // crosses midnight, e.g. 10p-2a
  return {
    title: title.trim(),
    due_time: `${pad(Math.floor(startMin / 60) % 24)}:${pad(startMin % 60)}`,
    duration_minutes: endMin - startMin,
  }
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

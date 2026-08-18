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
// 'Aug 21' / 'August 21' / 'Aug 21, 2026' form, the relative 'Today'/
// 'Tomorrow', or 'within N days'/'within the next N days' (optionally
// with a trailing colon, e.g. "Tomorrow:", or a trailing parenthetical,
// e.g. "Tomorrow (date of meeting + 1 day)" — both natural ways to head
// a quick note) — matching how most schedule tools actually print dates,
// or how someone jotting a note by hand actually writes one, so a line
// can often be pasted close to verbatim rather than needing to be
// retyped as ISO. A bare 'Aug 21' with no year assumes the current year,
// or next year if that date is more than YEAR_ROLLOVER_GRACE_DAYS in the
// past — the common "planning into next year" case, without misfiring on
// a schedule that starts a day or two ago.
//
// Deliberately narrow on which relative phrases resolve to a real date —
// only 'today'/'tomorrow'/'within N days' have one unambiguous
// interpretation. Fuzzier ones like "End of this week" or "end of month"
// still fall through unresolved (see the type: 'item' fallback below):
// "end" of a week could reasonably mean Friday, Saturday, or Sunday
// depending on who you ask, so guessing wrong and silently filing it
// under the wrong day would be worse than leaving it dateless.
function parseDateHeader(rawLine) {
  const line = rawLine.replace(/:\s*$/, '').replace(/\s*\([^)]*\)\s*$/, '')

  const relative = line.trim().toLowerCase()
  if (relative === 'today' || relative === 'tomorrow') {
    const d = new Date()
    if (relative === 'tomorrow') d.setDate(d.getDate() + 1)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  const within = relative.match(/^within\s+(?:the\s+next\s+|next\s+)?(\d+)\s+days?$/)
  if (within) {
    const d = new Date()
    d.setDate(d.getDate() + Number(within[1]))
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
// hyphen/en dash/em dash or the word "to"/"until", a trailing "next
// day"/"(+1 day)" is accepted and ignored — crossing midnight is already
// detected from the times themselves (see below), so that annotation is
// only ever for the human reading it back, not something the parser
// needs — and a further trailing parenthetical note ("8am-9am (gas-leak
// repair)") is captured and appended back onto the title rather than
// rejecting the whole line, since a shift very often does carry exactly
// this kind of context. This is intentionally more permissive than the
// one example shown in the form's hint text, since real pasted
// schedules vary.
const SHIFT_RE =
  /^(.+?)\s+(\d{1,2}(?::\d{2})?)\s*([ap])\.?m?\.?\s*(?:-|–|—|to|until)\s*(\d{1,2}(?::\d{2})?)\s*([ap])\.?m?\.?(?:\s*,?\s*(?:next\s*day|\(?\+\s*1\s*day\)?))?\s*(\([^)]*\))?\.?$/i

// The same shift, time range written first — "8 am – 9 am – 1072 Rachel
// (gas-leak repair)" — some schedules get jotted with the time up front
// instead of the title trailing it. Tried only after SHIFT_RE fails
// (title-first is still the primary documented format), and requires an
// explicit dash-like separator before the title (not just whitespace) so
// a title that happens to start with a number right after the time
// range isn't swallowed by accident.
const SHIFT_RE_TIME_FIRST =
  /^(\d{1,2}(?::\d{2})?)\s*([ap])\.?m?\.?\s*(?:-|–|—|to|until)\s*(\d{1,2}(?::\d{2})?)\s*([ap])\.?m?\.?\s*(?:-|–|—)\s*(.+?)\.?$/i

function buildShift(title, startNum, startAmPm, endNum, endAmPm, trailingNote) {
  const startMin = toMinutes(startNum, startAmPm)
  let endMin = toMinutes(endNum, endAmPm)
  if (endMin <= startMin) endMin += 24 * 60 // crosses midnight, e.g. 10p-2a
  return {
    title: trailingNote ? `${title.trim()} ${trailingNote}` : title.trim(),
    due_time: `${pad(Math.floor(startMin / 60) % 24)}:${pad(startMin % 60)}`,
    duration_minutes: endMin - startMin,
  }
}

function parseShiftLine(line) {
  let m = line.match(SHIFT_RE)
  if (m) {
    const [, title, startNum, startAmPm, endNum, endAmPm, trailingNote] = m
    return buildShift(title, startNum, startAmPm, endNum, endAmPm, trailingNote)
  }

  m = line.match(SHIFT_RE_TIME_FIRST)
  if (m) {
    const [, startNum, startAmPm, endNum, endAmPm, title] = m
    return buildShift(title, startNum, startAmPm, endNum, endAmPm)
  }

  return null
}

// Strips a leading bullet marker (*, -, •) and surrounding whitespace —
// outline pastes commonly nest each real item under a plain category
// label with no marker of its own significance beyond "this isn't a
// task, it's a heading."
function stripBullet(line) {
  return line.replace(/^[*\-•]\s+/, '').trim()
}

// Splits on the first dash-like separator that has whitespace on both
// sides — " – ", " — ", or " - " — never a bare hyphen, since those show
// up constantly inside ordinary words and compound terms ("Move-out",
// "gas-leak", "follow-up", and plenty of shift titles too). Returns null
// when there's no such separator, which is how a category header line is
// told apart from a real "date/note – description" item — headers never
// have this shape.
function splitDateDescription(line) {
  const m = line.match(/^(.*?)\s[-–—]\s(.*)$/)
  if (!m) return null
  return { prefix: m[1].trim(), description: m[2].trim() }
}

// One parser, two line shapes it recognizes freely mixed in the same
// paste — originally two separate parsers behind a manual "Shifts" vs
// "Action items" format toggle, merged after that toggle turned out to
// just be a way to fail confusingly by pasting into the wrong one (the
// error messages for "shift line with no date header above it" and
// "action item with an unrecognized date" look nothing alike, which is
// how the wrong-tab mistake actually got noticed). Recognizing both
// shapes per line removes the wrong-tab failure mode entirely — the same
// paste can now mix a real shift schedule with plain dated notes.
//
// Line shapes, tried in this order per line:
//  1. A standalone date/"Today"/"Tomorrow" line (parseDateHeader) sets
//     the current date context for bare shift lines below it — the
//     original shift-schedule format:
//       Aug 21
//       Texas 12a-4a
//       Washington 2a-5a
//  2. A "<date or note> – description" line (splitDateDescription) is a
//     self-contained item, independent of any date context above it:
//       Aug 30 – Abdul vacates Master Haven (schedule cleaning)
//       If Ingrid unavailable – Follow-up with Martin (backup)
//     Returned with type: 'item' (all-day; no time-of-day at all) rather
//     than type: 'shift'. A recognized date on the left becomes the real
//     due_date with the right side as the title; an unresolvable one
//     (a fuzzy relative phrase, or a plain dependency note with no date
//     shape at all) keeps the *entire* line as the title with no due
//     date, rather than guessing at a specific day.
//  3. A bare shift line ("Texas 12a-4a", no leading date of its own)
//     only means something once a date context exists from #1 above —
//     it's an error otherwise, since there's nothing to anchor it to.
//  4. Anything else (with an active date context: unreadable; without
//     one: a category header, e.g. "Cleaning coordination") — headers
//     are silently skipped, not an error, since they're a normal,
//     expected part of an outline paste rather than a typo.
export function parseBulkTasks(text) {
  const lines = text.split('\n')
  const tasks = []
  const errors = []
  let currentDate = null

  lines.forEach((raw, i) => {
    const line = stripBullet(raw.trim())
    if (!line) return

    const dateHeader = parseDateHeader(line)
    if (dateHeader) {
      currentDate = dateHeader
      return
    }

    const split = splitDateDescription(line)
    if (split) {
      if (!split.description) {
        errors.push({ line: i + 1, text: raw.trim(), message: 'Missing a description after the date.' })
        return
      }
      const date = parseDateHeader(split.prefix)
      tasks.push({ type: 'item', title: date ? split.description : line, due_date: date || null })
      return
    }

    if (currentDate) {
      const shift = parseShiftLine(line)
      if (!shift) {
        errors.push({ line: i + 1, text: line, message: 'Couldn\'t read a time range (expected e.g. "Texas 12a-4a").' })
        return
      }
      tasks.push({ type: 'shift', ...shift, due_date: currentDate })
      return
    }

    // No date context and no "date – description" shape — a category
    // header, silently skipped.
  })

  return { tasks, errors }
}

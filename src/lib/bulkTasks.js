import { TIMEZONE_OPTIONS } from './timezone'

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

// The same short abbreviations shown on every zone-aware badge elsewhere
// in the app (zoneAbbreviation in timezone.js) — recognized as an
// optional trailing token on an item-line's date/time prefix, e.g. "Aug
// 21 9am CT". Lets one paste mix tasks across zones (a household split
// between Ada's Central shifts and Aaron's Philippines schedule) without
// having to switch the form's single Time zone dropdown and re-paste each
// group separately.
const ZONE_ABBR_TO_IANA = Object.fromEntries(
  TIMEZONE_OPTIONS.map((tz) => [tz.label.match(/\(([^)]+)\)/)[1].toLowerCase(), tz.value]),
)
const ZONE_ABBR_RE = new RegExp(`\\s+(${Object.keys(ZONE_ABBR_TO_IANA).join('|')})$`, 'i')

// Strips a trailing zone abbreviation off a date/time prefix, if present.
// Tried on the whole prefix (before any time extraction) since the zone
// always comes last — after the time when there is one ("9am CT"), after
// the bare date when there isn't ("Aug 30 CT"). Word-bounded and matched
// only against the curated abbreviation list, so it can't misfire against
// an ordinary word (the prefix is always a date/time phrase in practice,
// not free text).
function splitTrailingZone(prefix) {
  const m = prefix.match(ZONE_ABBR_RE)
  if (!m) return { rest: prefix, due_timezone: null }
  return { rest: prefix.slice(0, m.index), due_timezone: ZONE_ABBR_TO_IANA[m[1].toLowerCase()] }
}

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

function iso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// A line on its own that names a date — everything after it (until the
// next date line) belongs to that date. Accepts 'YYYY-MM-DD', a loose
// 'Aug 21' / 'August 21' / 'Aug 21, 2026' form, the relative 'Today'/
// 'Tomorrow', 'within N days'/'within the next N days', 'end of (this)
// week', 'end of (this) month', 'start of next month', or 'next
// <weekday>' (optionally
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
// each of the ones handled below has exactly one agreed-upon meaning.
// A compound phrase like "end of month / start of next month" (offering
// two alternatives on one line) still falls through unresolved (see the
// type: 'item' fallback below), since picking one of the two for you
// would be guessing, not resolving.
function parseDateHeader(rawLine) {
  const line = rawLine.replace(/:\s*$/, '').replace(/\s*\([^)]*\)\s*$/, '')

  const relative = line.trim().toLowerCase()
  if (relative === 'today' || relative === 'tomorrow') {
    const d = new Date()
    if (relative === 'tomorrow') d.setDate(d.getDate() + 1)
    return iso(d)
  }

  const within = relative.match(/^within\s+(?:the\s+next\s+|next\s+)?(\d+)\s+days?$/)
  if (within) {
    const d = new Date()
    d.setDate(d.getDate() + Number(within[1]))
    return iso(d)
  }

  // Sunday-Saturday, same week boundary as getWeekDays() in tasks.js —
  // Friday is that week's 6th day (index 5) regardless of where today
  // falls within it.
  if (relative === 'end of week' || relative === 'end of this week') {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay() + 5)
    return iso(d)
  }

  if (relative === 'end of month' || relative === 'end of this month') {
    const d = new Date()
    return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))
  }

  if (relative === 'start of next month') {
    const d = new Date()
    return iso(new Date(d.getFullYear(), d.getMonth() + 1, 1))
  }

  // "next Monday" always means the upcoming one strictly ahead of today —
  // if today itself is Monday, that rolls to the Monday a full week out
  // rather than resolving to today, since nobody says "next Monday" to
  // mean the day they're already on.
  const nextWeekday = relative.match(/^next\s+([a-z]{3,9})$/)
  if (nextWeekday) {
    const weekdayIdx = WEEKDAY_NAMES.findIndex((w) => nextWeekday[1].startsWith(w))
    if (weekdayIdx !== -1) {
      const d = new Date()
      const delta = ((weekdayIdx - d.getDay() + 7) % 7) || 7
      d.setDate(d.getDate() + delta)
      return iso(d)
    }
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

// Peels an optional trailing time (or tight-hyphen time range) off a
// date-phrase prefix — "Aug 28 8am-9am" -> date part "Aug 28" + a real
// due_time/duration, same relaxed am/pm parsing (optional "at", "am"/
// "pm"/"a.m." forms, midnight-wraparound) the title-first shift format
// already uses. Tight hyphen only ("8am-9am", not "8am - 9am") — a
// spaced one would collide with splitDateDescription's own "first
// spaced dash" split, which has already run by the time this sees the
// prefix, so a spaced range would get sliced apart before ever reaching
// here. Tried speculatively on every prefix regardless of whether the
// remaining date part ends up resolving — an unresolved prefix (a
// dependency note, a category header) falls back to the *original,
// untouched* line either way (see the item-line branch below), so a
// false-positive time match here never actually corrupts anything.
function splitDateAndTime(prefix) {
  const m = prefix.match(
    /^(.*?)\s+(?:at\s+)?(\d{1,2}(?::\d{2})?)\s*([ap])\.?m?\.?(?:\s*(?:-|–|—|to|until)\s*(\d{1,2}(?::\d{2})?)\s*([ap])\.?m?\.?)?$/i,
  )
  if (!m) return { datePart: prefix, due_time: null, duration_minutes: null }
  const [, datePart, startNum, startAmPm, endNum, endAmPm] = m
  const startMin = toMinutes(startNum, startAmPm)
  let duration_minutes = null
  if (endNum) {
    let endMin = toMinutes(endNum, endAmPm)
    if (endMin <= startMin) endMin += 24 * 60 // crosses midnight, e.g. 10p-2a
    duration_minutes = endMin - startMin
  }
  return {
    datePart,
    due_time: `${pad(Math.floor(startMin / 60) % 24)}:${pad(startMin % 60)}`,
    duration_minutes,
  }
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

// An explicit "there's no date, and that's on purpose" marker on the left
// of a "<prefix> – description" line — distinct from a prefix that's
// merely unresolvable (see NO_DATE_MARKERS below). The two look the same
// to parseDateHeader (both return null), but they need different
// treatment: an unresolvable prefix like "If Ingrid unavailable" carries
// meaning that has to stay attached to the title, while a marker like
// "ASAP" is only ever noise once its job (saying "no date") is done —
// keeping it in the title would leave every such task starting with the
// same word, indistinguishable from each other in any compact view
// (e.g. the All Day row of chips) until each one is opened.
const NO_DATE_MARKERS = new Set(['asap', 'no date', 'whenever', 'someday'])

function isNoDateMarker(prefix) {
  return NO_DATE_MARKERS.has(prefix.trim().toLowerCase())
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
//  0. An indented line (isIndented, checked before any of the trimming/
//     stripping below) attaches as a checklist item on the most recently
//     pushed task, rather than being read as a task of its own — see
//     isIndented above.
//  1. A standalone date/"Today"/"Tomorrow" line (parseDateHeader) sets
//     the current date context for bare shift lines below it — the
//     original shift-schedule format:
//       Aug 21
//       Texas 12a-4a
//       Washington 2a-5a
//  2. A shift line (parseShiftLine) — title-first ("Texas 12a-4a") or
//     time-first ("8am – 9am – 1072 Rachel"). Tried before #3 below on
//     purpose: the time-first form's own start-end range can itself
//     contain a spaced dash, which #3's looser "<date or note> –
//     description" match would otherwise misread as its date prefix
//     (splitting "8am – 9am – 1072 Rachel" into a bogus "8am" date and
//     "9am – 1072 Rachel" as the title) instead of the timed shift it
//     actually is — a shift's rigid numeric/am-pm shape means this check
//     never misfires against a genuine item line. Only means something
//     once a date context exists from #1 above; with no date context yet
//     it's treated the same as any other unanchored line — silently
//     skipped, since it could just as easily be a header.
//  3. A "<date or note> [time-or-range] – description" line
//     (splitDateDescription, then splitDateAndTime on its prefix) is a
//     self-contained item, independent of any date context above it —
//     this is the one format meant to cover everything, timed or not:
//       Aug 30 – Abdul vacates Master Haven (schedule cleaning)
//       Aug 28 8am-9am – Depart DFW to CVG
//       If Ingrid unavailable – Follow-up with Martin (backup)
//       ASAP – Draft the lease-payment explanation
//     A recognized date on the left becomes the real due_date with the
//     right side alone as the title; a time/range immediately before the
//     dash (tight hyphen only, see splitDateAndTime) becomes a real
//     due_time/duration_minutes right on this same type: 'item' task,
//     no need to switch to the #1/#2 shift-schedule shape just to get a
//     specific time. An explicit NO_DATE_MARKERS prefix ("ASAP", "No
//     date", ...) also uses just the right side as the title, with
//     due_date left null on purpose (it said its piece by picking a "no
//     date" line shape at all) and any time that happened to match
//     dropped too — a marker plus a time is a contradiction, not
//     something worth guessing an interpretation for. Anything else
//     unresolvable (a fuzzy relative phrase, or a plain dependency note
//     with no date shape at all) keeps the *entire original line* as the
//     title with no due date instead, since here the prefix carries real
//     meaning that has to stay attached rather than guessing at a
//     specific day — note this reuses `line`, not the time-stripped
//     `datePart`, so a false-positive time match from step 3's own
//     speculative parse never leaks into an unresolved title.
//  4. Anything else (with an active date context: unreadable; without
//     one: a category header, e.g. "Cleaning coordination") — headers
//     are silently skipped, not an error, since they're a normal,
//     expected part of an outline paste rather than a typo.
// An indented line right under an item/shift line becomes a checklist
// entry on that task instead of a task of its own — same
// `{ id, text, done, blocked, blockedReason }` shape ChecklistEditor.jsx
// builds by hand, so a task created this way is editable the normal way
// immediately after. Indentation (raw leading whitespace, checked before
// the rest of the parser trims it away) is the only signal, tried before
// every other line shape — a deliberate, low-effort way to say "this
// belongs to the task above," rather than inventing a second marker
// character on top of the bullet stripping every other line already
// tolerates.
function isIndented(raw) {
  return /^[ \t]+\S/.test(raw)
}

export function parseBulkTasks(text) {
  const lines = text.split('\n')
  const tasks = []
  const errors = []
  let currentDate = null

  lines.forEach((raw, i) => {
    if (isIndented(raw)) {
      const text = stripBullet(raw.trim())
      if (!text) return
      const lastTask = tasks[tasks.length - 1]
      if (!lastTask) {
        errors.push({ line: i + 1, text: raw.trim(), message: 'Sub-item with no task above it to attach to.' })
        return
      }
      if (!lastTask.checklist) lastTask.checklist = []
      lastTask.checklist.push({ id: crypto.randomUUID(), text, done: false, blocked: false, blockedReason: '' })
      return
    }

    const line = stripBullet(raw.trim())
    if (!line) return

    const dateHeader = parseDateHeader(line)
    if (dateHeader) {
      currentDate = dateHeader
      return
    }

    const shift = parseShiftLine(line)
    if (shift) {
      if (currentDate) tasks.push({ type: 'shift', ...shift, due_date: currentDate })
      return
    }

    const split = splitDateDescription(line)
    if (split) {
      if (!split.description) {
        errors.push({ line: i + 1, text: raw.trim(), message: 'Missing a description after the date.' })
        return
      }
      const { rest: prefixNoZone, due_timezone } = splitTrailingZone(split.prefix)
      const { datePart, due_time, duration_minutes } = splitDateAndTime(prefixNoZone)
      const date = parseDateHeader(datePart)
      const resolved = date || isNoDateMarker(datePart)
      tasks.push({
        type: 'item',
        title: resolved ? split.description : line,
        due_date: date,
        // Only a real resolved date carries its extracted time/zone
        // through — a no-date-marker ("ASAP 3pm") drops them (a marker
        // plus a time or zone is a contradiction, not worth guessing at),
        // same as an unresolved line already drops everything back to the
        // untouched original.
        due_time: date ? due_time : null,
        duration_minutes: date ? duration_minutes : null,
        // null means "use whatever zone the form's dropdown has selected"
        // — only a line that names its own zone overrides that per-task.
        due_timezone: date ? due_timezone : null,
      })
      return
    }

    if (currentDate) {
      errors.push({ line: i + 1, text: line, message: 'Couldn\'t read a time range (expected e.g. "Texas 12a-4a").' })
      return
    }

    // No date context and no "date – description" shape — a category
    // header, silently skipped.
  })

  return { tasks, errors }
}

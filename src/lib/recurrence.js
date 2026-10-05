// Shared repeat helpers — used by the task form and by Bulk Add so the two
// cannot drift apart on what "every Monday and Wednesday" means.

export function addDaysToDateStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// First date on or after dateStr that falls on one of the chosen weekdays
// (0 = Sunday ... 6 = Saturday). dateStr itself when it already does, or
// when no weekday is chosen. A repeating task's own first date is part of
// the schedule, so it has to be one of the days actually picked.
export function firstSelectedWeekdayOnOrAfter(dateStr, days) {
  if (!dateStr || !days.length) return dateStr
  for (let i = 0; i < 7; i++) {
    const candidate = addDaysToDateStr(dateStr, i)
    if (days.includes(new Date(`${candidate}T00:00:00`).getDay())) return candidate
  }
  return dateStr
}

export function shortDateLabel(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

// --- Bulk Add's "~" repeat marker ------------------------------------------
// "Oct 5 9am ~weekly – Pay vendors", "~mon,wed,fri", "~weekdays".
// One table drives both reading a pasted marker and writing one from a
// Guided row, so a row's fields and the text they produce always agree.
const SIMPLE_TOKENS = {
  daily: 'daily',
  weekly: 'weekly',
  biweekly: 'biweekly',
  '2weeks': 'biweekly',
  '2w': 'biweekly',
  '3weeks': 'every_3_weeks',
  '3w': 'every_3_weeks',
  monthly: 'monthly',
  '2months': 'every_2_months',
  quarterly: 'quarterly',
  '6months': 'every_6_months',
  yearly: 'annually',
  annually: 'annually',
}
// What a Guided row writes for each repeat value.
const WRITE_TOKEN = {
  daily: 'daily',
  weekly: 'weekly',
  biweekly: 'biweekly',
  every_3_weeks: '3weeks',
  monthly: 'monthly',
  every_2_months: '2months',
  quarterly: 'quarterly',
  every_6_months: '6months',
  annually: 'yearly',
}
const DAY_FULL = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const DAY_WRITE = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const MON_TO_SUN = [1, 2, 3, 4, 5, 6, 0]

function dayFromName(name) {
  if (name.length < 3) return -1
  return DAY_FULL.findIndex((full) => full.startsWith(name))
}

// A token (without the "~") -> { recurrence, recurrence_days }, or null if it
// is not one we understand.
export function parseRepeatToken(token) {
  const t = token.trim().toLowerCase()
  if (SIMPLE_TOKENS[t]) return { recurrence: SIMPLE_TOKENS[t], recurrence_days: [] }
  if (t === 'weekdays') return { recurrence: 'selected_weekdays', recurrence_days: [1, 2, 3, 4, 5] }
  if (t === 'weekends') return { recurrence: 'selected_weekdays', recurrence_days: [6, 0] }
  const days = t.split(',').map(dayFromName)
  if (days.length && days.every((d) => d !== -1)) {
    return { recurrence: 'selected_weekdays', recurrence_days: [...new Set(days)].sort((a, b) => a - b) }
  }
  return null
}

// A repeat value (+ chosen weekdays) -> the token to write, or null for none.
export function repeatToToken(recurrence, days = []) {
  if (recurrence === 'selected_weekdays') {
    const ordered = MON_TO_SUN.filter((d) => days.includes(d))
    return ordered.length ? ordered.map((d) => DAY_WRITE[d]).join(',') : null
  }
  return WRITE_TOKEN[recurrence] || null
}

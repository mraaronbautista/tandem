// When a booking's rent is charged, and how much of a month each charge covers.
// No imports on purpose: the app (src/lib/rentals.js) and the reminder function
// (notify-reminders) both use this one file, so what Financials shows and what
// the "Rent due today" reminder says can never disagree. (They used to be two
// copies kept in step by hand.)
//
// Two modes, chosen per unit by `rent_due_day`:
//
//  * null / undefined ("Same as move-in day", the default and the only mode
//    before Oct 12 2026): a full month is charged on the move-in day, then on
//    the same day-of-month every month. A day that does not exist in a shorter
//    month lands on that month's last day (Jan 31 -> Feb 28, Mar 31, Apr 30).
//    Nothing is ever prorated. This is byte-for-byte the old behaviour.
//
//  * 1 to 28, or LAST_DAY (-1 = the last day of every month): rent is charged
//    on that FIXED day each month, like TurboTenant. The first charge is on the
//    move-in day and covers the days until the next due day (prorated when
//    move-in is not itself a due day); every later charge is on the due day;
//    the last charge covers only the days left up to and including check-out.
//    A charge's share of a month is days covered / days in that billing period
//    (due day to the next due day, so 31 for August when the due day is the
//    1st), the same arithmetic as TurboTenant's own prorated-rent calculator.
//
// check_out is the LAST OCCUPIED DAY (inclusive). A due day that lands exactly
// on check-out is not charged (it would be one trailing day), the same rule the
// old schedule already had.

export const LAST_DAY = -1

export type Charge = {
  date: string // 'YYYY-MM-DD' the charge is due
  fraction: number // share of a month's rent, 1 for a full month
  days: number // days of stay this charge covers
  periodDays: number // length of the billing period it is a share of
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function fmt(y: number, m1: number, d: number): string {
  // m1 is 1-12; Date.UTC normalises overflow.
  const dt = new Date(Date.UTC(y, m1 - 1, d))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

function parts(dateStr: string): [number, number, number] {
  const [y, m, d] = dateStr.split('-').map(Number)
  return [y, m, d]
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = parts(dateStr)
  return fmt(y, m, d + days)
}

// Whole days from a to b (b later = positive).
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parts(a)
  const [by, bm, bd] = parts(b)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

function daysInMonth(y: number, m1: number): number {
  return new Date(Date.UTC(y, m1, 0)).getUTCDate()
}

// N calendar months after dateStr, same day-of-month, always computed from the
// ORIGINAL date (never the previous cycle) so a short month cannot compound; a
// day that does not exist lands on that month's last day.
export function addCalendarMonths(dateStr: string, months: number): string {
  const [y, m, d] = parts(dateStr)
  const last = daysInMonth(y, m + months)
  const base = new Date(Date.UTC(y, m - 1 + months, 1))
  return fmt(base.getUTCFullYear(), base.getUTCMonth() + 1, Math.min(d, last))
}

// The due date inside a given month (m1 is 1-12; may overflow, normalised).
function dueInMonth(y: number, m1: number, dueDay: number): string {
  const base = new Date(Date.UTC(y, m1 - 1, 1))
  const yy = base.getUTCFullYear()
  const mm = base.getUTCMonth() + 1
  return fmt(yy, mm, dueDay === LAST_DAY ? daysInMonth(yy, mm) : dueDay)
}

// First due date strictly after dateStr.
export function nextDueAfter(dateStr: string, dueDay: number): string {
  const [y, m] = parts(dateStr)
  const thisMonth = dueInMonth(y, m, dueDay)
  return thisMonth > dateStr ? thisMonth : dueInMonth(y, m + 1, dueDay)
}

// Last due date on or before dateStr.
export function dueOnOrBefore(dateStr: string, dueDay: number): string {
  const [y, m] = parts(dateStr)
  const thisMonth = dueInMonth(y, m, dueDay)
  return thisMonth <= dateStr ? thisMonth : dueInMonth(y, m - 1, dueDay)
}

export function isValidDueDay(value: unknown): boolean {
  return value === null || value === undefined || value === LAST_DAY || (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 28)
}

// The old schedule: a full month on the move-in day, then every month on the
// same day-of-month, while the date is still before check-out.
function sameAsMoveInSchedule(checkIn: string, checkOut: string): Charge[] {
  const charges: Charge[] = [{ date: checkIn, fraction: 1, days: 0, periodDays: 0 }]
  let cycle = 1
  let d = addCalendarMonths(checkIn, cycle)
  while (d < checkOut) {
    charges.push({ date: d, fraction: 1, days: 0, periodDays: 0 })
    cycle += 1
    d = addCalendarMonths(checkIn, cycle)
  }
  // Fill in the day counts for display only; nothing is prorated.
  return charges.map((c, i) => {
    const next = i + 1 < charges.length ? charges[i + 1].date : addCalendarMonths(checkIn, i + 1)
    const periodDays = daysBetween(c.date, next)
    return { ...c, days: periodDays, periodDays }
  })
}

export function rentChargeSchedule(checkIn: string, checkOut: string, dueDay?: number | null): Charge[] {
  if (!checkIn || !checkOut) return []
  if (dueDay === null || dueDay === undefined) return sameAsMoveInSchedule(checkIn, checkOut)

  const stayEndsBefore = addDays(checkOut, 1) // first day after the stay
  const share = (from: string, periodEnd: string, periodDays: number): Charge => {
    const days = Math.max(0, Math.min(daysBetween(from, periodEnd), daysBetween(from, stayEndsBefore)))
    return { date: from, fraction: periodDays > 0 ? days / periodDays : 1, days, periodDays }
  }

  const charges: Charge[] = []
  // First charge: on the move-in day, for the rest of the period it falls in.
  const periodStart = dueOnOrBefore(checkIn, dueDay)
  const firstNext = nextDueAfter(checkIn, dueDay)
  charges.push(share(checkIn, firstNext, daysBetween(periodStart, firstNext)))
  // Then each due day before check-out.
  let d = firstNext
  while (d < checkOut) {
    const next = nextDueAfter(d, dueDay)
    charges.push(share(d, next, daysBetween(d, next)))
    d = next
  }
  return charges
}

// Money for one charge, to the cent.
export function chargeAmount(monthlyRent: number | string | null | undefined, charge: { fraction: number }): number {
  const rent = Number(monthlyRent) || 0
  return Math.round(rent * charge.fraction * 100) / 100
}

// "1st", "2nd", "15th", "last day" for the unit form and messages.
export function dueDayLabel(dueDay: number | null | undefined): string {
  if (dueDay === null || dueDay === undefined) return 'the move-in day'
  if (dueDay === LAST_DAY) return 'the last day of the month'
  const rem100 = dueDay % 100
  const suffix = rem100 >= 11 && rem100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[dueDay % 10] || 'th'
  return `the ${dueDay}${suffix}`
}

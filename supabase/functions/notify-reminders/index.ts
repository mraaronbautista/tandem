// Triggered on a schedule (Cron Job, e.g. every 5 minutes — see setup
// steps). Five independent checks in one pass, since all of them are
// "find qualifying rows, ping, mark sent so the next run doesn't
// repeat it" — not worth splitting into separate functions/schedules:
//
// 1. Active tasks starting within the next 15 minutes that haven't been
//    reminded about yet.
// 2. Still-open tasks that have been overdue for OVERDUE_NUDGE_DAYS and
//    haven't been nudged about it yet — closes the "this silently rotted
//    for a week and nobody noticed" gap. One-shot, same as the reminder
//    above (not a repeating daily nag) — a manual per-task nudge
//    (manual-notify's task_nudge kind) sets the same column, so whichever
//    fires first (this cron pass or a manual nudge) suppresses the other.
// 3. Rental charges (see chargeDatesForBooking in src/lib/rentals.js —
//    reimplemented below since an Edge Function can't import frontend
//    code) landing today that haven't been paid in advance
//    (rental_bookings.paid_charges) or already reminded about
//    (rent_reminder_sent_for, a *date* rather than a boolean so the
//    same booking's later monthly cycles can still trigger their own
//    reminder without needing to be reset by hand).
// 4 & 5. Long-term lease reminders (rental_properties.term = 'long_term')
//    — see the block below. This is the one place in Rentals nobody
//    checks day to day (RentalsView.jsx's term toggle defaults to
//    Short/Midterm), so a lease running out has to surface on its own
//    rather than relying on someone to notice a calendar they're not
//    looking at.
//
// (1) and (2) are symmetric regardless of who created the task —
// reminders and nudges are about who the task belongs to, unlike the
// assignment ping in notify-task-events. (3), (4), and (5) all notify
// both members — none of these are tied to a specific person the way a
// task is, and Rentals is already mutually visible to both.
import { resolveMemberIds, notifyMember, supabaseAdmin } from '../_shared/notify.ts'

const REMINDER_WINDOW_MINUTES = 15
const OVERDUE_NUDGE_DAYS = 3

function pad(n: number) {
  return String(n).padStart(2, '0')
}

// Same "N calendar months after, same day-of-month" logic as
// addCalendarMonths in src/lib/rentals.js — duplicated rather than
// shared, since this Edge Function can't import from the frontend's src/
// (same reasoning _shared/notify.ts already gives for re-deriving the
// who/display_name mapping).
function addCalendarMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1 + months, d)
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

function chargeDatesForBooking(checkIn: string, checkOut: string): string[] {
  const dates = [checkIn]
  let cycle = 1
  let d = addCalendarMonths(checkIn, cycle)
  while (d < checkOut) {
    dates.push(d)
    cycle += 1
    d = addCalendarMonths(checkIn, cycle)
  }
  return dates
}

// Parsed as local, not UTC — a bare 'YYYY-MM-DD' parsed via `new Date()`
// directly would otherwise shift a day depending on this function's own
// server timezone offset. Same reasoning formatDateStr (src/lib/rentals.js)
// already documents for the frontend's own version of this.
function parseDateStr(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function longDate(dateStr: string): string {
  return parseDateStr(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function shortDate(dateStr: string): string {
  return parseDateStr(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Pure month granularity (year*12 + zero-based month), not a day-preserving
// helper like addCalendarMonths — deliberately, so this can't inherit that
// function's own day-of-month overflow behavior (documented at its own
// definition above, and accepted there since billing genuinely needs the
// exact day-of-month). A "which month is this in" comparison has no day
// component to preserve in the first place, so there's nothing to overflow:
// a check_out of Mar 3, Mar 20, or Mar 31 all have the same "last month"
// anchor (February), which projecting from check_out's exact day forward/
// backward a full month would NOT reliably give (Mar 31 minus a calendar
// month either overflows into March itself via JS's own Date rollover, or
// lands a few days into March depending on direction — verified against a
// month-end case while building this).
function monthIndex(dateStr: string): number {
  const [y, m] = dateStr.split('-').map(Number)
  return y * 12 + (m - 1)
}

Deno.serve(async () => {
  const { yours, assistant } = await resolveMemberIds()

  const now = new Date()
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MINUTES * 60_000)

  const { data: dueSoon } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .is('reminder_sent_at', null)
    .neq('status', 'done')
    .gte('due_date', now.toISOString())
    .lte('due_date', windowEnd.toISOString())

  for (const task of dueSoon || []) {
    const memberId = task.who === 'assistant' ? assistant : yours
    await notifyMember(memberId, {
      title: 'Starting soon',
      body: task.title,
      url: '/',
    })
    await supabaseAdmin.from('tasks').update({ reminder_sent_at: new Date().toISOString() }).eq('id', task.id)
  }

  const overdueCutoff = new Date(now.getTime() - OVERDUE_NUDGE_DAYS * 24 * 60 * 60_000)

  const { data: staleOverdue } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .is('overdue_nudge_sent_at', null)
    .neq('status', 'done')
    .not('due_date', 'is', null)
    .lt('due_date', overdueCutoff.toISOString())

  for (const task of staleOverdue || []) {
    const memberId = task.who === 'assistant' ? assistant : yours
    await notifyMember(memberId, {
      title: 'Still on your plate?',
      body: task.title,
      url: '/',
    })
    await supabaseAdmin.from('tasks').update({ overdue_nudge_sent_at: new Date().toISOString() }).eq('id', task.id)
  }

  // Plain calendar dates (Postgres `date` columns, no time-of-day or
  // timezone of their own) — matches how src/lib/rentals.js treats every
  // rental date as a bare 'YYYY-MM-DD' string throughout, with no
  // per-viewer timezone conversion anywhere in that module either.
  // "Today" here is this function's own server clock, not adjusted for
  // either member's local timezone.
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

  const { data: activeBookings } = await supabaseAdmin
    .from('rental_bookings')
    .select('id, check_in, check_out, paid_charges, rent_reminder_sent_for, rental_properties(unit_name, monthly_rent)')
    .eq('status', 'confirmed')
    .gte('check_out', todayStr)

  for (const b of activeBookings || []) {
    if (b.rent_reminder_sent_for === todayStr) continue
    const chargesToday = chargeDatesForBooking(b.check_in, b.check_out).includes(todayStr)
    const alreadyPaid = (b.paid_charges || []).includes(todayStr)
    if (!chargesToday || alreadyPaid) continue

    const property = b.rental_properties
    const amount = property ? `$${Number(property.monthly_rent).toLocaleString()}` : ''
    const unitName = property?.unit_name || 'A unit'
    await Promise.all([
      notifyMember(yours, { title: 'Rent due today', body: `${unitName} — ${amount}`, url: '/' }),
      notifyMember(assistant, { title: 'Rent due today', body: `${unitName} — ${amount}`, url: '/' }),
    ])
    await supabaseAdmin.from('rental_bookings').update({ rent_reminder_sent_for: todayStr }).eq('id', b.id)
  }

  // Long-term lease reminders — see the file-top comment (checks 4 & 5).
  // Both are one-shot per booking (last_month_reminder_sent_at/
  // turnover_reminder_sent_at), unlike the recurring rent-due check above,
  // since a lease only has one final month and one move-out, not a
  // repeating monthly cycle.
  const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60_000)
  const sevenDaysOutStr = `${sevenDaysOut.getFullYear()}-${pad(sevenDaysOut.getMonth() + 1)}-${pad(sevenDaysOut.getDate())}`

  const { data: longTermBookings } = await supabaseAdmin
    .from('rental_bookings')
    .select(
      'id, property_id, guest_name, guest_names, check_in, check_out, last_month_reminder_sent_at, turnover_reminder_sent_at, rental_properties!inner(unit_name, term)',
    )
    .eq('status', 'confirmed')
    .eq('rental_properties.term', 'long_term')
    .gte('check_out', todayStr)

  for (const b of longTermBookings || []) {
    const unitName = b.rental_properties?.unit_name || 'A unit'
    const guest = (b.guest_names?.length ? b.guest_names.join(' and ') : b.guest_name) || 'The tenant'

    // "Last month" — fires starting the 1st of the calendar month right
    // before check_out's own month, regardless of which day of that month
    // check_out actually falls on (the 1st, the 20th, the 31st — all have
    // the same "last month," even though a day-preserving month offset from
    // check_out's exact date would not: see monthIndex's own comment).
    if (!b.last_month_reminder_sent_at && monthIndex(todayStr) >= monthIndex(b.check_out) - 1) {
      const body = `Their lease ends ${longDate(b.check_out)} — this is their final month.`
      await Promise.all([
        notifyMember(yours, { title: `${guest}'s last month at ${unitName}`, body, url: '/' }),
        notifyMember(assistant, { title: `${guest}'s last month at ${unitName}`, body, url: '/' }),
      ])
      await supabaseAdmin
        .from('rental_bookings')
        .update({ last_month_reminder_sent_at: new Date().toISOString() })
        .eq('id', b.id)
    }

    // "Turnover in one week" — branches on whether a CONFIRMED booking
    // already starts on/after this one's own check_out. A pending inquiry
    // doesn't count as "already lined up" — it isn't a sure thing, so that
    // case still gets the tenant-search nudge.
    if (!b.turnover_reminder_sent_at && b.check_out <= sevenDaysOutStr) {
      const { data: nextBooking } = await supabaseAdmin
        .from('rental_bookings')
        .select('guest_name, guest_names, check_in')
        .eq('property_id', b.property_id)
        .eq('status', 'confirmed')
        .neq('id', b.id)
        .gte('check_in', b.check_out)
        .order('check_in', { ascending: true })
        .limit(1)
        .maybeSingle()

      const nextGuest = nextBooking && (nextBooking.guest_names?.length ? nextBooking.guest_names.join(' and ') : nextBooking.guest_name)

      const title = nextBooking ? `${unitName} — turnover in one week` : `${unitName} — moving out ${shortDate(b.check_out)}`
      const body = nextBooking
        ? `${guest} moves out ${shortDate(b.check_out)}, ${nextGuest} moves in ${shortDate(nextBooking.check_in)}. Confirm the turnover cleaning task is set.`
        : `${guest}'s last day is ${longDate(b.check_out)}. One week left to line up the next tenant.`

      await Promise.all([
        notifyMember(yours, { title, body, url: '/' }),
        notifyMember(assistant, { title, body, url: '/' }),
      ])
      await supabaseAdmin
        .from('rental_bookings')
        .update({ turnover_reminder_sent_at: new Date().toISOString() })
        .eq('id', b.id)
    }
  }

  return new Response('ok')
})

// Triggered on a schedule (Cron Job, e.g. every 5 minutes — see setup
// steps). Three independent checks in one pass, since all three are
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
//
// (1) and (2) are symmetric regardless of who created the task —
// reminders and nudges are about who the task belongs to, unlike the
// assignment ping in notify-task-events. (3) notifies both members —
// a rental charge isn't tied to a specific person the way a task is,
// and Rentals is already mutually visible to both.
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

  return new Response('ok')
})

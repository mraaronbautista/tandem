// Triggered on a schedule (Cron Job, e.g. every 5 minutes — see setup
// steps). Two independent checks in one pass, since both are "find
// qualifying tasks, ping whoever it belongs to, mark sent so the next
// run doesn't repeat it" — not worth splitting into a second function
// and a second cron schedule to manage:
//
// 1. Active tasks starting within the next 15 minutes that haven't been
//    reminded about yet.
// 2. Still-open tasks that have been overdue for OVERDUE_NUDGE_DAYS and
//    haven't been nudged about it yet — closes the "this silently rotted
//    for a week and nobody noticed" gap. One-shot, same as the reminder
//    above (not a repeating daily nag) — a manual per-task nudge
//    (manual-notify's task_nudge kind) sets the same column, so whichever
//    fires first (this cron pass or a manual nudge) suppresses the other.
//
// Both are symmetric regardless of who created the task — reminders and
// nudges are about who the task belongs to, unlike the assignment ping
// in notify-task-events.
import { resolveMemberIds, notifyMember, supabaseAdmin } from '../_shared/notify.ts'

const REMINDER_WINDOW_MINUTES = 15
const OVERDUE_NUDGE_DAYS = 3

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

  return new Response('ok')
})

// Triggered on a schedule (Cron Job, e.g. every 5 minutes — see setup
// steps). Finds active tasks starting within the next 15 minutes that
// haven't been reminded about yet, pings whoever the task belongs to
// (regardless of who created it — reminders are symmetric, unlike the
// assignment ping in notify-task-events), and marks them as sent so the
// next run doesn't repeat it.
import { resolveMemberIds, notifyMember, supabaseAdmin } from '../_shared/notify.ts'

const REMINDER_WINDOW_MINUTES = 15

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

  return new Response('ok')
})

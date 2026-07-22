// Triggered by a Database Webhook on tasks INSERT and UPDATE (configure
// both event types to point at this function — see setup steps).
//
// Notification rules (deliberately asymmetric, not a general preference
// system — this app is hardcoded for exactly two people):
//   - New task assigned to Aaron (by Ada, not by himself) -> ping Aaron now.
//   - New task assigned to Ada -> no ping now; she only hears about it
//     when notify-reminders fires closer to its start time.
//   - Either person completing a task -> ping the OTHER person, so they
//     know it got done.
import { resolveMemberIds, notifyMember } from '../_shared/notify.ts'

Deno.serve(async (req) => {
  const payload = await req.json()
  const { yours, assistant } = await resolveMemberIds()

  if (payload.type === 'INSERT') {
    const task = payload.record
    if (task.who === 'assistant' && task.created_by !== assistant) {
      await notifyMember(assistant, {
        title: 'New task assigned',
        body: task.title,
        url: '/',
      })
    }
  }

  if (payload.type === 'UPDATE') {
    const task = payload.record
    const previous = payload.old_record
    if (previous.status !== 'done' && task.status === 'done') {
      const isAssistantTask = task.who === 'assistant'
      const notifyId = isAssistantTask ? yours : assistant
      await notifyMember(notifyId, {
        title: `${isAssistantTask ? 'Aaron' : 'Ada'} completed a task`,
        body: task.title,
        url: '/',
      })
    }
  }

  return new Response('ok')
})

// Triggered by a Database Webhook on tasks INSERT and UPDATE (configure
// both event types to point at this function — see setup steps).
//
// Notification rules — this app is hardcoded for exactly two people, not
// a general preference system:
//   - New task assigned to someone by the OTHER person -> ping the
//     assignee now, symmetric in both directions. Assigning a task to
//     yourself doesn't ping you — you already know.
//   - Either person completing a task -> ping the OTHER person, so they
//     know it got done.
import { resolveMemberIds, notifyMember } from '../_shared/notify.ts'

Deno.serve(async (req) => {
  const payload = await req.json()
  const { yours, assistant } = await resolveMemberIds()

  if (payload.type === 'INSERT') {
    const task = payload.record
    const assigneeId = task.who === 'assistant' ? assistant : yours
    if (task.created_by !== assigneeId) {
      await notifyMember(assigneeId, {
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

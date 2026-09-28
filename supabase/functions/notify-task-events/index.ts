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
//   - A 'both' task (see src/lib/whoLabels.js) extends both rules the
//     same way: assignment pings every real target except whoever created
//     it (so a 'both' task someone creates for themselves-and-the-other
//     still only pings the other person, not the creator); completion
//     can't cleanly say "X completed it" the way a single-owner task can
//     (this webhook has no caller identity, only task.who, and neither
//     real person "already knows" more than the other for a shared task),
//     so it pings both members with generic wording instead.
import { resolveMemberIds, resolveTaskWho, notifyMember } from '../_shared/notify.ts'

Deno.serve(async (req) => {
  const payload = await req.json()
  const { yours, assistant } = await resolveMemberIds()

  if (payload.type === 'INSERT') {
    const task = payload.record
    const assigneeIds = resolveTaskWho(task.who, yours, assistant).filter((id) => id !== task.created_by)
    await Promise.all(
      assigneeIds.map((id) => notifyMember(id, { title: 'New task assigned', body: task.title, url: '/' })),
    )
  }

  if (payload.type === 'UPDATE') {
    const task = payload.record
    const previous = payload.old_record
    if (previous.status !== 'done' && task.status === 'done') {
      if (task.who === 'both') {
        await Promise.all([
          notifyMember(yours, { title: 'A shared task was completed', body: task.title, url: '/' }),
          notifyMember(assistant, { title: 'A shared task was completed', body: task.title, url: '/' }),
        ])
      } else {
        const isAssistantTask = task.who === 'assistant'
        const notifyId = isAssistantTask ? yours : assistant
        await notifyMember(notifyId, {
          title: `${isAssistantTask ? 'Aaron' : 'Ada'} completed a task`,
          body: task.title,
          url: '/',
        })
      }
    }
  }

  return new Response('ok')
})

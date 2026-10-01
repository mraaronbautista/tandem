// Triggered by a Database Webhook on tasks INSERT and UPDATE (configure
// both event types to point at this function — see setup steps).
//
// Notification rules, generalized from the original exactly-Ada/Aaron
// version to any number of members:
//   - New task assigned to someone by another member -> ping every
//     assignee except whoever created it. Assigning a task to yourself
//     doesn't ping you — you already know.
//   - A task being completed -> ping every ADMIN not assigned to it, not
//     every member. This used to notify everyone not assigned — fine for
//     two people, but once a third (non-admin) member joined, it meant
//     two teammates getting pinged about each other's routine completions
//     neither needed to know about. Admin oversight ("the person managing
//     the team should see work get done") is still worth keeping
//     automatic; peer-to-peer completion chatter isn't, by design —
//     TaskRow.jsx's own post-completion "Notify" picker is the deliberate
//     opt-in for the rare case someone specific genuinely should know
//     (see manual-notify's task_completed kind). A single-assignee task
//     still attributes it by name ("Ada completed a task"); a
//     multi-assignee task can't cleanly say "X completed it" the way a
//     single-owner task can (this webhook has no caller identity, only
//     assignee_ids, and no one assignee "already knows" more than
//     another for a shared task), so it uses generic wording instead.
import { fetchAllMembers, notifyMember } from '../_shared/notify.ts'

Deno.serve(async (req) => {
  const payload = await req.json()
  const allMembers = await fetchAllMembers()

  if (payload.type === 'INSERT') {
    const task = payload.record
    const assigneeIds = (task.assignee_ids || []).filter((id: string) => id !== task.created_by)
    await Promise.all(
      assigneeIds.map((id: string) => notifyMember(id, { title: 'New task assigned', body: task.title, url: '/' })),
    )
  }

  if (payload.type === 'UPDATE') {
    const task = payload.record
    const previous = payload.old_record
    if (previous.status !== 'done' && task.status === 'done') {
      const assigneeIds: string[] = task.assignee_ids || []
      const others = allMembers.filter((m) => m.is_admin && !assigneeIds.includes(m.id))
      if (assigneeIds.length === 1) {
        const assigneeName = allMembers.find((m) => m.id === assigneeIds[0])?.display_name || 'Someone'
        await Promise.all(
          others.map((m) =>
            notifyMember(m.id, { title: `${assigneeName} completed a task`, body: task.title, url: '/' }),
          ),
        )
      } else {
        await Promise.all(
          others.map((m) => notifyMember(m.id, { title: 'A shared task was completed', body: task.title, url: '/' })),
        )
      }
    }
  }

  return new Response('ok')
})

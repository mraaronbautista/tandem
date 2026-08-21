// Triggered directly from the browser (supabase.functions.invoke), unlike
// notify-task-events/notify-reminders which are only ever called by
// Supabase's own webhook/cron system. Deployed WITHOUT --no-verify-jwt —
// the platform rejects a missing/invalid session before this code runs —
// but that only proves "some signed-in user called this," not which of
// the two members it is, so the caller's identity is still resolved
// explicitly below rather than trusted from anything the client sends.
import { resolveMemberIds, notifyMember, supabaseAdmin } from '../_shared/notify.ts'
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const preflight = handleCors(req)
  if (preflight) return preflight

  // Client scoped to this request's own Authorization header (not the
  // service role) so auth.getUser() reflects the real caller's session.
  const supabaseUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const {
    data: { user },
  } = await supabaseUser.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

  const { yours, assistant } = await resolveMemberIds()
  const callerIsAda = user.id === yours
  const senderName = callerIsAda ? 'Ada' : 'Aaron'
  // The target is always "whoever isn't the caller" — never accepted from
  // the client, since this app only ever has these two people.
  const targetId = callerIsAda ? assistant : yours

  const payload = await req.json()

  if (payload.kind === 'eod_report') {
    const body = String(payload.body || '').slice(0, 300)
    if (!body.trim()) return new Response('Missing report body', { status: 400, headers: corsHeaders })
    await notifyMember(targetId, { title: `${senderName}'s end-of-day report`, body, url: '/' })
    return new Response('ok', { headers: corsHeaders })
  }

  if (payload.kind === 'nudge') {
    await notifyMember(targetId, {
      title: `${senderName} needs you`,
      body: 'Something urgent — check the board.',
      url: '/',
    })
    return new Response('ok', { headers: corsHeaders })
  }

  if (payload.kind === 'clarification_asked') {
    const taskTitle = String(payload.taskTitle || '')
    const question = String(payload.question || '').slice(0, 300)
    if (!question.trim()) return new Response('Missing question', { status: 400, headers: corsHeaders })
    await notifyMember(targetId, {
      title: `${senderName} has a question`,
      body: `${taskTitle}: ${question}`,
      url: '/',
    })
    return new Response('ok', { headers: corsHeaders })
  }

  // A one-tap nudge on a specific overdue task, distinct from the plain
  // 'nudge' kind above (which is person-level, "something urgent, check
  // the board" with no task attached). The caller is always the task's
  // *other* person by construction — TaskRow.jsx only ever shows this
  // button on a task that isn't the viewer's own (see CLAUDE.md), so
  // targetId ("whoever isn't the caller") already equals "whoever the
  // task belongs to" here; no separate task.who-based resolution needed.
  // Also marks overdue_nudge_sent_at so the automatic overdue-nudge cron
  // pass (notify-reminders) doesn't duplicate this shortly after.
  if (payload.kind === 'task_nudge') {
    const taskId = String(payload.taskId || '')
    const taskTitle = String(payload.taskTitle || '')
    if (!taskId || !taskTitle.trim()) return new Response('Missing taskId/taskTitle', { status: 400, headers: corsHeaders })
    await notifyMember(targetId, {
      title: 'Still on your plate?',
      body: taskTitle,
      url: '/',
    })
    await supabaseAdmin.from('tasks').update({ overdue_nudge_sent_at: new Date().toISOString() }).eq('id', taskId)
    return new Response('ok', { headers: corsHeaders })
  }

  if (payload.kind === 'clarification_answered') {
    const taskTitle = String(payload.taskTitle || '')
    const answer = String(payload.answer || '').slice(0, 300)
    if (!answer.trim()) return new Response('Missing answer', { status: 400, headers: corsHeaders })
    await notifyMember(targetId, {
      title: `${senderName} answered your question`,
      body: `${taskTitle}: ${answer}`,
      url: '/',
    })
    return new Response('ok', { headers: corsHeaders })
  }

  return new Response('Unknown kind', { status: 400, headers: corsHeaders })
})

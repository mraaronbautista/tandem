// Triggered directly from the browser. Deployed with --no-verify-jwt;
// the handler validates the caller session explicitly below.
import { fetchAllMembers, notifyMember, supabaseAdmin } from '../_shared/notify.ts'
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

  const allMembers = await fetchAllMembers()
  const caller = allMembers.find((m) => m.id === user.id)
  const senderName = caller?.display_name || 'A member'
  // eod_report still broadcasts to "everyone but the caller" — a report
  // genuinely is for the whole team. clarification_asked/
  // clarification_answered used to as well, but no longer do by default
  // (see resolveNotifyIds below) now that a comment often concerns one
  // specific member, not everyone. otherMemberIds is computed from
  // allMembers regardless of whether the caller is actually in it, so a
  // valid-but-non-member session (a staff account, for instance) would
  // otherwise get "everyone but the caller" collapsing to "everyone" —
  // every member-only kind (eod_report/nudge/clarification_asked/
  // clarification_answered) explicitly checks `!caller` first and
  // refuses rather than silently broadcasting on a non-member's behalf.
  // time_entry_correction_request is the one kind a staff account is
  // actually meant to call, so it deliberately has no such check.
  const otherMemberIds = allMembers.filter((m) => m.id !== user.id).map((m) => m.id)

  const payload = await req.json()

  // Resolves a client-supplied notify list (TaskClarifications.jsx's own
  // "Notify" picker) down to real, non-caller member ids — dropping
  // anything else (a stale id, a typo, the caller's own id) rather than
  // trusting the array outright, same reasoning 'nudge' already verifies
  // its single targetId. Missing/non-array (an older cached frontend
  // that predates this field) falls back to the old "everyone but the
  // caller" broadcast, so a deploy-order gap between this function and
  // the frontend can't silently drop every recipient instead.
  function resolveNotifyIds(raw: unknown): string[] {
    if (!Array.isArray(raw)) return otherMemberIds
    return raw.filter((id) => typeof id === 'string' && id !== user.id && allMembers.some((m) => m.id === id))
  }

  if (payload.kind === 'eod_report') {
    if (!caller) return new Response('Forbidden — members only', { status: 403, headers: corsHeaders })
    const body = String(payload.body || '').slice(0, 300)
    if (!body.trim()) return new Response('Missing report body', { status: 400, headers: corsHeaders })
    await Promise.all(
      otherMemberIds.map((id) => notifyMember(id, { title: `${senderName}'s end-of-day report`, body, url: '/' })),
    )
    return new Response('ok', { headers: corsHeaders })
  }

  // Person-level 👋 nudge — the one kind here that takes a client-supplied
  // target, since with more than one other member there's no longer a
  // single unambiguous "whoever isn't the caller." Not a trust concern:
  // under is_member() RLS every member can already see every other
  // member's tasks, so "notify member X" isn't sensitive, just a delivery
  // target — still verified as a real member (and not the caller) before
  // sending, rather than trusted outright.
  if (payload.kind === 'nudge') {
    if (!caller) return new Response('Forbidden — members only', { status: 403, headers: corsHeaders })
    const targetId = String(payload.targetId || '')
    if (!targetId || targetId === user.id || !allMembers.some((m) => m.id === targetId)) {
      return new Response('Invalid target', { status: 400, headers: corsHeaders })
    }
    // Persists regardless of push delivery (push is best-effort throughout
    // this app) — InboxView.jsx's Nudges section is what actually reads
    // this; the record existing is what matters, not whether the push
    // itself landed.
    const { error: nudgeError } = await supabaseAdmin
      .from('member_nudges')
      .insert({ sender_id: user.id, target_id: targetId })
    if (nudgeError) {
      console.error('Could not save member nudge', nudgeError.code)
      return new Response('Could not save the nudge. Please try again.', { status: 500, headers: corsHeaders })
    }
    await notifyMember(targetId, {
      title: `${senderName} needs you`,
      body: 'Something urgent — check the board.',
      url: '/',
    })
    return new Response('ok', { headers: corsHeaders })
  }

  if (payload.kind === 'clarification_asked') {
    if (!caller) return new Response('Forbidden — members only', { status: 403, headers: corsHeaders })
    const taskTitle = String(payload.taskTitle || '')
    const question = String(payload.question || '').slice(0, 300)
    if (!question.trim()) return new Response('Missing question', { status: 400, headers: corsHeaders })
    const targets = resolveNotifyIds(payload.notifyIds)
    await Promise.all(
      targets.map((id) =>
        notifyMember(id, { title: `${senderName} has a question`, body: `${taskTitle}: ${question}`, url: '/' }),
      ),
    )
    return new Response('ok', { headers: corsHeaders })
  }

  // A one-tap nudge on a specific overdue task, distinct from the plain
  // 'nudge' kind above (which is person-level, "something urgent, check
  // the board" with no task attached). Targets that task's own
  // assignee_ids (looked up server-side from taskId, not client-supplied)
  // minus the caller — no picker needed the way person-level nudge now
  // has, since the task itself already names who's relevant. Also marks
  // overdue_nudge_sent_at so the automatic overdue-nudge cron pass
  // (notify-reminders) doesn't duplicate this shortly after.
  if (payload.kind === 'task_nudge') {
    const taskId = String(payload.taskId || '')
    const taskTitle = String(payload.taskTitle || '')
    if (!taskId || !taskTitle.trim()) return new Response('Missing taskId/taskTitle', { status: 400, headers: corsHeaders })
    const { data: task } = await supabaseAdmin.from('tasks').select('assignee_ids').eq('id', taskId).maybeSingle()
    const targets = (task?.assignee_ids || []).filter((id: string) => id !== user.id)
    await Promise.all(targets.map((id: string) => notifyMember(id, { title: 'Still on your plate?', body: taskTitle, url: '/' })))
    await supabaseAdmin.from('tasks').update({ overdue_nudge_sent_at: new Date().toISOString() }).eq('id', taskId)
    return new Response('ok', { headers: corsHeaders })
  }

  if (payload.kind === 'clarification_answered') {
    if (!caller) return new Response('Forbidden — members only', { status: 403, headers: corsHeaders })
    const taskTitle = String(payload.taskTitle || '')
    const answer = String(payload.answer || '').slice(0, 300)
    if (!answer.trim()) return new Response('Missing answer', { status: 400, headers: corsHeaders })
    const targets = resolveNotifyIds(payload.notifyIds)
    await Promise.all(
      targets.map((id) =>
        notifyMember(id, { title: `${senderName} answered your question`, body: `${taskTitle}: ${answer}`, url: '/' }),
      ),
    )
    return new Response('ok', { headers: corsHeaders })
  }

  // The one kind a STAFF account calls, not a member — every kind above
  // this point assumes the caller is a member (senderName/otherMemberIds
  // are meaningless here, deliberately unused in this branch, since the
  // caller is neither). Every member is notified unconditionally instead.
  // Resolves the caller's own display_name via the service-role client
  // (staff can't be looked up through fetchAllMembers(), which only ever
  // queries `members`).
  if (payload.kind === 'time_entry_correction_request') {
    const note = String(payload.note || '').slice(0, 300)
    if (!note.trim()) return new Response('Missing note', { status: 400, headers: corsHeaders })
    const { data: staffRow } = await supabaseAdmin.from('staff').select('display_name').eq('id', user.id).maybeSingle()
    const staffName = staffRow?.display_name || 'The property manager'
    await Promise.all(
      allMembers.map((m) =>
        notifyMember(m.id, { title: `${staffName} requested a time correction`, body: note, url: '/' }),
      ),
    )
    return new Response('ok', { headers: corsHeaders })
  }

  return new Response('Unknown kind', { status: 400, headers: corsHeaders })
})

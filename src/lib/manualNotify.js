import { supabase } from './supabaseClient'

// The first client-triggered pushes in the app — every other notification
// is a side effect of a Database Webhook or pg_cron. supabase-js attaches
// the current session's JWT automatically, so no extra auth plumbing is
// needed here; the manual-notify function resolves the caller itself.

export async function sendEodReportNotification(body) {
  const { error } = await supabase.functions.invoke('manual-notify', { body: { kind: 'eod_report', body } })
  if (error) throw error
}

// targetId is a real members.id now, not resolved server-side as "whoever
// isn't the caller" — there can be more than one valid target once the
// team's past 2 people. Not a trust concern: manual-notify still verifies
// targetId server-side (a real member, not the caller's own id) before
// sending, the same way every other write in this app already treats
// "notify member X" as a delivery target, not sensitive data.
export async function sendNudge(targetId) {
  const { error } = await supabase.functions.invoke('manual-notify', { body: { kind: 'nudge', targetId } })
  if (error) throw error
}

export async function sendTaskNudge(taskId, taskTitle) {
  const { error } = await supabase.functions.invoke('manual-notify', {
    body: { kind: 'task_nudge', taskId, taskTitle },
  })
  if (error) throw error
}

// The deliberate, opt-in "I just finished this" ping — TaskRow.jsx's
// post-completion Notify picker, scoped to whoever's explicitly chosen
// rather than everyone (notify-task-events' own automatic completion
// webhook now only ever pings admins, see that function's comment).
// Never falls back to a broadcast if notifyIds is empty, unlike
// sendClarificationAsked/Answered — an empty selection here genuinely
// means "nobody was picked," not an older frontend missing the field.
export async function sendTaskCompletedNotify(taskId, taskTitle, notifyIds) {
  const { error } = await supabase.functions.invoke('manual-notify', {
    body: { kind: 'task_completed', taskId, taskTitle, notifyIds },
  })
  if (error) throw error
}

// notifyIds is who this specific question/reply is actually tagged for
// (TaskClarifications.jsx's own "Notify" picker) — no longer resolved
// server-side as "everyone but the caller", since a comment that
// concerns one specific member (the healthcare VA, say) shouldn't also
// ping every other member by default. Same trust reasoning sendNudge's
// targetId already established: manual-notify still verifies every id
// server-side (a real member, not the caller) before sending.
export async function sendClarificationAsked(taskTitle, question, notifyIds) {
  const { error } = await supabase.functions.invoke('manual-notify', {
    body: { kind: 'clarification_asked', taskTitle, question, notifyIds },
  })
  if (error) throw error
}

export async function sendClarificationAnswered(taskTitle, answer, notifyIds) {
  const { error } = await supabase.functions.invoke('manual-notify', {
    body: { kind: 'clarification_answered', taskTitle, answer, notifyIds },
  })
  if (error) throw error
}

// The one call in this file a staff account makes, not a member — every
// other function here relies on manual-notify resolving a real member
// target; this kind instead always notifies every member, since the
// caller is neither (see manual-notify/index.ts).
export async function sendTimeEntryCorrectionRequest(note) {
  const { error } = await supabase.functions.invoke('manual-notify', {
    body: { kind: 'time_entry_correction_request', note },
  })
  if (error) throw error
}

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

export async function sendClarificationAsked(taskTitle, question) {
  const { error } = await supabase.functions.invoke('manual-notify', {
    body: { kind: 'clarification_asked', taskTitle, question },
  })
  if (error) throw error
}

export async function sendClarificationAnswered(taskTitle, answer) {
  const { error } = await supabase.functions.invoke('manual-notify', {
    body: { kind: 'clarification_answered', taskTitle, answer },
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

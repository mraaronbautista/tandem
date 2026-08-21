import { supabase } from './supabaseClient'

// The first client-triggered pushes in the app — every other notification
// is a side effect of a Database Webhook or pg_cron. supabase-js attaches
// the current session's JWT automatically, so no extra auth plumbing is
// needed here; the manual-notify function resolves the caller itself.

export async function sendEodReportNotification(body) {
  const { error } = await supabase.functions.invoke('manual-notify', { body: { kind: 'eod_report', body } })
  if (error) throw error
}

export async function sendNudge() {
  const { error } = await supabase.functions.invoke('manual-notify', { body: { kind: 'nudge' } })
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

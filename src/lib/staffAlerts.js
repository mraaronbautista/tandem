import { supabase } from './supabaseClient'
import { visitTimeText } from './locationTime'

// Alerts to the house manager, sent by a member's screen when they save
// something he should know about. Always best effort: the change itself is
// already saved, so a failed alert is returned, never thrown. Only members
// with Rentals can send them (manual-notify checks), and only an active staff
// account that turned alerts on receives one.
export async function alertStaff(title, body = '') {
  try {
    const { data, error } = await supabase.functions.invoke('manual-notify', { body: { kind: 'staff_alert', title, body } })
    if (error) return { sent: false }
    return { sent: true, reached: data?.reached ?? 0 }
  } catch {
    return { sent: false }
  }
}

// 'Tue Oct 14' for a plain date.
function dayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// What the house manager's phone shows about a visit. `change` is 'booked',
// 'changed' or 'cancelled'; `place` is the unit or location name.
export function visitAlertText({ visit, place, tz, change }) {
  const time = visitTimeText({ date: visit.visit_date, time: visit.visit_time, tz, viewerTz: tz }).label
  const when = `${dayLabel(visit.visit_date)}${time ? `, ${time}` : ''}`
  const verb = change === 'cancelled' ? 'cancelled' : change === 'changed' ? 'changed' : 'booked'
  const kind = (visit.kind || 'Visit').trim()
  const who = visit.who ? ` with ${visit.who}` : ''
  return {
    title: `${kind} ${verb}`,
    body: change === 'cancelled' ? `Was ${when} at ${place}` : `${when} at ${place}${who}`,
  }
}

export function noteAlertText({ unitName, note }) {
  return { title: `Note updated: ${unitName}`, body: note }
}

// A member ticked off one of his reports; manual-notify tells only the reporter.
export async function alertStaffIssueDone(taskId) {
  try {
    await supabase.functions.invoke('manual-notify', { body: { kind: 'staff_issue_done', taskId } })
  } catch {
    // best effort
  }
}


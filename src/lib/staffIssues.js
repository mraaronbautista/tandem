import { supabase } from './supabaseClient'
import { sendStaffIssueNotification } from './manualNotify'

export const URGENCY_OPTIONS = [
  { value: 'can_wait', label: 'Can wait' },
  { value: 'soon', label: 'Soon' },
  { value: 'urgent', label: 'Urgent' },
]

// Where the house manager can report: each location as a whole, and every unit.
export async function fetchIssuePlaces() {
  const { data, error } = await supabase.rpc('staff_issue_places')
  if (error) throw error
  return data || []
}

// Units grouped under their location, with a "Whole building" choice first in
// each group: [{ label: '1072 Rachel', options: [{ key, label, propertyId, workSiteId }] }]
export function groupIssuePlaces(places) {
  const groups = new Map()
  for (const p of places || []) {
    const label = p.location_name || 'No location'
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push(
      p.kind === 'location'
        ? { key: `site:${p.id}`, label: `Whole building, ${p.name}`, propertyId: null, workSiteId: p.id }
        : { key: `unit:${p.id}`, label: p.name, propertyId: p.id, workSiteId: null },
    )
  }
  return [...groups.entries()].map(([label, options]) => ({ label, options }))
}

export async function fetchMyIssueReports() {
  const { data, error } = await supabase.rpc('staff_my_issue_reports')
  if (error) throw error
  return data || []
}

// Saves the report (which creates the task for the admin), then asks for the
// alert. The alert is best effort: the report and the task already exist, so a
// failed alert is returned as `alerted: false`, never thrown.
export async function reportIssue({ propertyId = null, workSiteId = null, body, urgency }) {
  const { data, error } = await supabase.rpc('staff_report_issue', {
    p_property_id: propertyId,
    p_work_site_id: workSiteId,
    p_body: body,
    p_urgency: urgency,
  })
  if (error) throw error
  let alerted = true
  try {
    await sendStaffIssueNotification(data)
  } catch {
    alerted = false
  }
  return { id: data, alerted }
}

export function isIssueSetupMissing(err) {
  return err?.code === 'PGRST202' || err?.code === '42883'
}

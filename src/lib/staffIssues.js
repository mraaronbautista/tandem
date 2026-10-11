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

// ---- Photos ---------------------------------------------------------------

// The most one report holds. The database enforces the same number; this just
// lets the screen say so before he tries.
export const MAX_PHOTOS_PER_REPORT = 100

// Uploads one already-shrunk JPEG to the private bucket under
// {his id}/{report id}-{random}.jpg, then records it against the report. The
// upload and the record are separate steps; if the record step fails the file
// is simply unused, and a retry uploads it again under a new name.
export async function uploadIssuePhoto(reportId, blob) {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData?.user) throw userError || new Error('Your session expired. Sign in again.')
  const path = `${userData.user.id}/${reportId}-${crypto.randomUUID()}.jpg`
  const { error: uploadError } = await supabase.storage.from('issue-photos').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  if (uploadError) throw uploadError
  const { error } = await supabase.rpc('staff_add_issue_photo', { p_report_id: reportId, p_path: path })
  if (error) throw error
  return path
}

// Uploads photos one after another (a phone connection does better than many at
// once). `onProgress(done, total)` is called after each. Returns the photos
// that did not make it, so "Try again" can resend just those.
export async function uploadIssuePhotos(reportId, blobs, onProgress = () => {}) {
  const failed = []
  let done = 0
  for (const blob of blobs) {
    try {
      await uploadIssuePhoto(reportId, blob)
    } catch {
      failed.push(blob)
    }
    done += 1
    onProgress(done, blobs.length)
  }
  return failed
}

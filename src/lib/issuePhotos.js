import { supabase } from './supabaseClient'

// A task made from the house manager's "Report an issue" is titled
// "Issue at {place}: ..." (staff_report_issue in supabase/add-staff-issue-reports.sql).
export function isIssueTask(task) {
  return Boolean(task?.title?.startsWith('Issue at '))
}

// Only a Google Drive folder address is ever turned into a link.
export function driveFolderHref(url) {
  return typeof url === 'string' && url.startsWith('https://drive.google.com/') ? url : ''
}

// The photos attached to the report behind a task, oldest first. `photos` are
// the ones still in Tandem, each with a short-lived signed address (the bucket
// is private; only members with Rentals can read it). `moved` are photos that
// were backed up and removed from Tandem: { id, kind: 'drive' | 'zip',
// removedAt, folderUrl }. Both are empty when there are none or the feature
// isn't set up yet.
export async function fetchIssuePhotos(taskId) {
  const empty = { photos: [], moved: [] }
  const { data, error } = await supabase
    .from('staff_issue_photos')
    .select('id, path, created_at, removed_at, backup_kind, drive_folder_url, staff_issue_reports!inner(task_id)')
    .eq('staff_issue_reports.task_id', taskId)
    .order('created_at', { ascending: true })
  if (error || !data?.length) return empty
  const moved = data
    .filter((p) => p.removed_at)
    .map((p) => ({ id: p.id, kind: p.backup_kind, removedAt: p.removed_at, folderUrl: driveFolderHref(p.drive_folder_url) }))
  const live = data.filter((p) => !p.removed_at)
  if (live.length === 0) return { photos: [], moved }
  const { data: signed, error: signError } = await supabase.storage
    .from('issue-photos')
    .createSignedUrls(live.map((p) => p.path), 3600)
  if (signError || !signed) return { photos: [], moved }
  const urlByPath = new Map(signed.map((s) => [s.path, s.signedUrl]))
  return {
    photos: live
      .map((p) => ({ id: p.id, path: p.path, createdAt: p.created_at, url: urlByPath.get(p.path) || '' }))
      .filter((p) => p.url),
    moved,
  }
}

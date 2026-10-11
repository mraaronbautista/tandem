import { supabase } from './supabaseClient'

// A task made from the house manager's "Report an issue" is titled
// "Issue at {place}: ..." (staff_report_issue in supabase/add-staff-issue-reports.sql).
export function isIssueTask(task) {
  return Boolean(task?.title?.startsWith('Issue at '))
}

// The photos attached to the report behind a task, oldest first, each with a
// short-lived signed address (the bucket is private; only members with Rentals
// can read it). Returns [] when there are none or the feature isn't set up yet.
export async function fetchIssuePhotos(taskId) {
  const { data, error } = await supabase
    .from('staff_issue_photos')
    .select('id, path, created_at, staff_issue_reports!inner(task_id)')
    .eq('staff_issue_reports.task_id', taskId)
    .order('created_at', { ascending: true })
  if (error || !data?.length) return []
  const { data: signed, error: signError } = await supabase.storage
    .from('issue-photos')
    .createSignedUrls(data.map((p) => p.path), 3600)
  if (signError || !signed) return []
  const urlByPath = new Map(signed.map((s) => [s.path, s.signedUrl]))
  return data
    .map((p) => ({ id: p.id, path: p.path, createdAt: p.created_at, url: urlByPath.get(p.path) || '' }))
    .filter((p) => p.url)
}

// The two server-side jobs of the issue-photo back-up, with the database, the
// photo storage and the network passed in so they can be tested with stand-ins
// (the Edge Function in issue-photo-backup/index.ts wires in the real ones).
//
//   runBackupBatch  copies a few not-yet-backed-up photos to Google Drive
//                   through the Apps Script, and marks each one only after
//                   Drive reports the same number of bytes.
//   runRemoval      deletes backed-up photos of DONE issues from Tandem's
//                   storage, re-checking every one itself.
import {
  copyMatches,
  driveRequest,
  photoFileName,
  placeFolders,
  removableFromTandem,
  reportText,
  uniqueReportFolderName,
} from './issuePhotoBackup.ts'

type Admin = { from: (table: string) => any; storage: { from: (bucket: string) => any } }

export type Deps = {
  admin: Admin
  fetchFn: (url: string, init: Record<string, unknown>) => Promise<{ text: () => Promise<string> }>
  driveUrl: string
  driveToken: string
}

export type BatchResult =
  | { ok: true; backedUp: number; remaining: number }
  | { ok: false; reason: string; message: string; backedUp: number }

const BATCH_SIZE = 5
const IN_CHUNK = 100

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

async function selectIn(admin: Admin, table: string, columns: string, column: string, ids: string[]) {
  const rows: any[] = []
  for (const part of chunks([...new Set(ids)].filter(Boolean), IN_CHUNK)) {
    const { data, error } = await admin.from(table).select(columns).in(column, part)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...(data || []))
  }
  return rows
}

export async function pendingCount(admin: Admin): Promise<number> {
  const { count, error } = await admin
    .from('staff_issue_photos')
    .select('id', { count: 'exact', head: true })
    .is('backed_up_at', null)
    .is('removed_at', null)
  if (error) throw new Error(error.message)
  return count || 0
}

export async function runBackupBatch(deps: Deps, limit = BATCH_SIZE): Promise<BatchResult> {
  const { admin } = deps
  const { data: photos, error } = await admin
    .from('staff_issue_photos')
    .select('id, report_id, path, created_at')
    .is('backed_up_at', null)
    .is('removed_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit)
  if (error) return { ok: false, reason: 'db_error', message: error.message, backedUp: 0 }
  if (!photos?.length) return { ok: true, backedUp: 0, remaining: 0 }

  const reportIds = photos.map((p: any) => p.report_id)
  const reports = new Map<string, any>((await selectIn(admin, 'staff_issue_reports', 'id, staff_id, property_id, work_site_id, place, body, urgency, created_at', 'id', reportIds)).map((r) => [r.id, r]))
  // Every photo of those reports (backed up or removed too), for stable
  // numbering: "photo 2" stays photo 2 however many are backed up per run.
  const siblings = await selectIn(admin, 'staff_issue_photos', 'id, report_id, created_at', 'report_id', reportIds)
  siblings.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
  const ordinal = new Map<string, number>()
  const perReport = new Map<string, number>()
  for (const s of siblings) {
    const n = (perReport.get(s.report_id) || 0) + 1
    perReport.set(s.report_id, n)
    ordinal.set(s.id, n)
  }
  const staff = new Map<string, string>((await selectIn(admin, 'staff', 'id, display_name', 'id', [...reports.values()].map((r) => r.staff_id))).map((s) => [s.id, s.display_name]))
  const properties = new Map<string, any>((await selectIn(admin, 'rental_properties', 'id, unit_name, work_site_id', 'id', [...reports.values()].map((r) => r.property_id).filter(Boolean))).map((p) => [p.id, p]))
  const siteIds = [...reports.values()].map((r) => r.work_site_id).concat([...properties.values()].map((p) => p.work_site_id)).filter(Boolean)
  const sites = new Map<string, string>((await selectIn(admin, 'work_sites', 'id, name', 'id', siteIds)).map((s) => [s.id, s.name]))

  let backedUp = 0
  for (const photo of photos) {
    const report = reports.get(photo.report_id)
    if (!report) return { ok: false, reason: 'db_error', message: 'A photo has no report.', backedUp }
    const property = report.property_id ? properties.get(report.property_id) : null
    const locationName = sites.get(property?.work_site_id || report.work_site_id) || null
    // Other reports of the same place, to keep folder names unique.
    const peerColumn = report.property_id ? 'property_id' : 'work_site_id'
    const { data: peers, error: peerError } = await admin
      .from('staff_issue_reports')
      .select('id, body, created_at')
      .eq(peerColumn, report.property_id || report.work_site_id)
    if (peerError) return { ok: false, reason: 'db_error', message: peerError.message, backedUp }
    const path = [...placeFolders(locationName, property?.unit_name || null), uniqueReportFolderName(report, peers || [])]
    const text = reportText({
      place: report.place,
      reporter: staff.get(report.staff_id) || null,
      createdAt: report.created_at,
      urgency: report.urgency,
      body: report.body,
      photoCount: perReport.get(photo.report_id) || 1,
    })

    const { data: blob, error: downloadError } = await admin.storage.from('issue-photos').download(photo.path)
    if (downloadError || !blob) {
      return { ok: false, reason: 'download_failed', message: 'A photo could not be read from Tandem.', backedUp }
    }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const request = driveRequest(deps.driveToken, path, photoFileName(ordinal.get(photo.id) || 1), bytes, text)

    let reply: any
    try {
      const res = await deps.fetchFn(deps.driveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(45_000),
      })
      const raw = await res.text()
      try {
        reply = JSON.parse(raw)
      } catch {
        return {
          ok: false,
          reason: 'bad_reply',
          message: "Google Drive's script gave an unexpected reply. Check the script is deployed with access set to Anyone.",
          backedUp,
        }
      }
    } catch {
      return { ok: false, reason: 'network', message: "Couldn't reach the Google Drive script. Try again in a moment.", backedUp }
    }

    if (!reply?.ok) {
      return {
        ok: false,
        reason: reply?.error === 'unauthorized' ? 'unauthorized' : reply?.error === 'not_configured' ? 'script_not_configured' : 'script_error',
        message:
          reply?.error === 'unauthorized'
            ? "The Drive script rejected Tandem's password. The password set in Tandem and in the script must match."
            : reply?.error === 'not_configured'
              ? "The Drive script isn't finished being set up (its folder or password is missing)."
              : `The Drive script reported a problem${reply?.message ? `: ${String(reply.message).slice(0, 120)}` : '.'}`,
        backedUp,
      }
    }
    if (!copyMatches(bytes.length, reply.size) || !reply.fileId) {
      return { ok: false, reason: 'size_mismatch', message: "A photo's copy in Drive didn't match, so it was not marked as backed up.", backedUp }
    }

    const { error: updateError } = await admin
      .from('staff_issue_photos')
      .update({
        backed_up_at: new Date().toISOString(),
        backup_kind: 'drive',
        drive_file_id: String(reply.fileId),
        drive_folder_url: reply.folderUrl ? String(reply.folderUrl) : null,
      })
      .eq('id', photo.id)
    if (updateError) return { ok: false, reason: 'db_error', message: updateError.message, backedUp }
    backedUp += 1
  }
  return { ok: true, backedUp, remaining: await pendingCount(admin) }
}

export type RemovalResult =
  | { ok: true; removed: number }
  | { ok: false; reason: string; message: string; eligible?: number; removed?: number }

// Removes every backed-up photo of a DONE issue from Tandem's storage, but only
// if the number matches what the person confirmed on screen.
export async function runRemoval(deps: Deps, expectedCount: number): Promise<RemovalResult> {
  const { admin } = deps
  const { data: photos, error } = await admin
    .from('staff_issue_photos')
    .select('id, report_id, path, backed_up_at, removed_at, backup_kind, drive_file_id')
    .not('backed_up_at', 'is', null)
    .is('removed_at', null)
  if (error) return { ok: false, reason: 'db_error', message: error.message }

  const reports = await selectIn(admin, 'staff_issue_reports', 'id, task_id', 'id', (photos || []).map((p: any) => p.report_id))
  const taskIds = reports.map((r) => r.task_id).filter(Boolean)
  const tasks = new Map<string, string>((await selectIn(admin, 'tasks', 'id, status', 'id', taskIds)).map((t) => [t.id, t.status]))
  // Done = no task, a deleted task, or a ticked-off task (same rule as the screen).
  const done = new Map<string, boolean>(reports.map((r) => [r.id, !r.task_id || !tasks.has(r.task_id) || tasks.get(r.task_id) === 'done']))

  const eligible = (photos || []).filter((p: any) => removableFromTandem(p, Boolean(done.get(p.report_id))))
  if (eligible.length !== expectedCount) {
    return {
      ok: false,
      reason: 'count_changed',
      message: `The number of photos that can be removed changed to ${eligible.length}. Review it and try again.`,
      eligible: eligible.length,
    }
  }

  let removed = 0
  for (const part of chunks<any>(eligible, 50)) {
    const { data: gone, error: storageError } = await admin.storage.from('issue-photos').remove(part.map((p: any) => p.path))
    if (storageError) return { ok: false, reason: 'storage_error', message: 'Some photos could not be removed. Nothing else was changed.', removed }
    const goneNames = new Set((gone || []).map((g: any) => g.name))
    const okIds = part.filter((p: any) => goneNames.has(p.path)).map((p: any) => p.id)
    if (okIds.length > 0) {
      const { error: markError } = await admin.from('staff_issue_photos').update({ removed_at: new Date().toISOString() }).in('id', okIds)
      if (markError) return { ok: false, reason: 'db_error', message: markError.message, removed }
      removed += okIds.length
    }
  }
  return { ok: true, removed }
}

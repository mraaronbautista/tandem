import { zipSync, strToU8 } from 'fflate'
import { supabase } from './supabaseClient'
import { formulaSafeText } from './csvSafe'
import { throwFunctionError } from './functionError'
// The same file the server uses, so a photo gets the same folder and name
// whichever route backs it up.
import {
  ROOT_FOLDER_NAME,
  photoFileName,
  placeFolders,
  reportText,
  uniqueReportFolderName,
  urgencyLabel,
} from '../../supabase/functions/_shared/issuePhotoBackup.ts'

export const STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024 // the free plan's 1 GB

export function isBackupSetupMissing(err) {
  return err?.code === 'PGRST202' || err?.code === '42883'
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (n >= 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

// The numbers for the Issue photos screen.
export async function fetchPhotoSummary() {
  const { data, error } = await supabase.rpc('issue_photo_summary')
  if (error) throw error
  return Array.isArray(data) ? data[0] : data
}

// Is the Google Drive script connected? `deployed: false` means the Edge
// Function itself is not there yet.
export async function fetchBackupStatus() {
  try {
    const { data, error } = await supabase.functions.invoke('issue-photo-backup', { body: { kind: 'status' } })
    if (error) return { deployed: false, configured: false }
    return { deployed: true, configured: Boolean(data?.configured) }
  } catch {
    return { deployed: false, configured: false }
  }
}

async function callBackup(body) {
  const { data, error } = await supabase.functions.invoke('issue-photo-backup', { body })
  if (error) await throwFunctionError(error)
  return data
}

// Copies every not-yet-backed-up photo to Google Drive, a few at a time, until
// none are left or something goes wrong. `onProgress(done)` after each batch.
// Returns { ok, backedUp, message? }.
export async function runDriveBackup(onProgress = () => {}) {
  let backedUp = 0
  for (let round = 0; round < 2000; round += 1) {
    const result = await callBackup({ kind: 'backup' })
    backedUp += result?.backedUp || 0
    onProgress(backedUp)
    if (!result?.ok) return { ok: false, backedUp, message: result?.message || 'The back-up stopped.' }
    if (!result.remaining) return { ok: true, backedUp }
    if (!result.backedUp) return { ok: false, backedUp, message: 'The back-up stopped making progress. Try again.' }
  }
  return { ok: false, backedUp, message: 'The back-up stopped. Try again.' }
}

// Removes the backed-up photos of finished issues from Tandem. `expectedCount`
// is the number the person confirmed; the server refuses if it changed.
export async function removeBackedUpPhotos(expectedCount) {
  return callBackup({ kind: 'remove', expectedCount })
}

// "I saved this zip": counts those photos as backed up.
export async function markZipSaved(photoIds) {
  const { data, error } = await supabase.rpc('mark_issue_photos_backed_up_zip', { p_photo_ids: photoIds })
  if (error) throw error
  return data || 0
}

function csvCell(value) {
  return `"${formulaSafeText(value).replace(/"/g, '""')}"`
}

// Builds a zip of every not-yet-backed-up photo, filed in the same folders as
// the Drive back-up, with a report.txt per report and an index.csv. Photos are
// stored uncompressed (a JPEG does not shrink further).
export async function buildPhotosZip(onProgress = () => {}) {
  const { data: manifest, error } = await supabase.rpc('issue_photo_manifest')
  if (error) throw error
  const rows = manifest || []
  if (rows.length === 0) return null

  // One entry per report, to name its folder and write its report.txt.
  const reports = new Map()
  for (const r of rows) {
    if (!reports.has(r.report_id)) {
      reports.set(r.report_id, {
        id: r.report_id,
        created_at: r.report_created_at,
        body: r.report_body,
        urgency: r.urgency,
        place: r.place,
        reporter: r.reporter_name,
        unit: r.unit_name,
        location: r.location_name,
        photoCount: 0,
      })
    }
    reports.get(r.report_id).photoCount = Math.max(reports.get(r.report_id).photoCount, r.ordinal)
  }
  const folderOf = new Map()
  for (const report of reports.values()) {
    const peers = [...reports.values()].filter((p) => p.unit === report.unit && p.location === report.location)
    folderOf.set(report.id, [ROOT_FOLDER_NAME, ...placeFolders(report.location, report.unit), uniqueReportFolderName(report, peers)].join('/'))
  }

  const files = {}
  const index = [['Folder', 'File', 'Place', 'Reported by', 'Reported', 'How urgent', 'What was wrong']]
  for (const report of reports.values()) {
    files[`${folderOf.get(report.id)}/report.txt`] = strToU8(
      reportText({ place: report.place, reporter: report.reporter, createdAt: report.created_at, urgency: report.urgency, body: report.body, photoCount: report.photoCount }),
    )
  }

  // Signed addresses in chunks, then the photos one at a time.
  const urlByPath = new Map()
  for (let i = 0; i < rows.length; i += 100) {
    const part = rows.slice(i, i + 100)
    const { data: signed, error: signError } = await supabase.storage.from('issue-photos').createSignedUrls(part.map((r) => r.path), 3600)
    if (signError || !signed) throw signError || new Error("Couldn't prepare the photos.")
    for (const s of signed) urlByPath.set(s.path, s.signedUrl)
  }
  let done = 0
  let bytes = 0
  for (const r of rows) {
    const response = await fetch(urlByPath.get(r.path))
    if (!response.ok) throw new Error("A photo couldn't be downloaded. Try again.")
    const data = new Uint8Array(await response.arrayBuffer())
    const name = photoFileName(r.ordinal)
    files[`${folderOf.get(r.report_id)}/${name}`] = [data, { level: 0 }]
    bytes += data.length
    index.push([folderOf.get(r.report_id), name, r.place, r.reporter_name || '', r.report_created_at, urgencyLabel(r.urgency), r.report_body])
    done += 1
    onProgress(done, rows.length)
  }
  files[`${ROOT_FOLDER_NAME}/index.csv`] = strToU8(index.map((line) => line.map(csvCell).join(',')).join('\r\n') + '\r\n')

  const zipped = zipSync(files)
  const stamp = new Date().toISOString().slice(0, 10)
  return {
    blob: new Blob([zipped], { type: 'application/zip' }),
    fileName: `Tandem issue photos ${stamp}.zip`,
    photoIds: rows.map((r) => r.photo_id),
    count: rows.length,
    bytes,
  }
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

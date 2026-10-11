// Naming and rules for backing up the house manager's issue photos. No imports
// on purpose: the issue-photo-backup Edge Function (Google Drive) and the
// browser's zip download both use this one file, so a photo lands in the same
// folder with the same name whichever route is used, and the removal rule
// cannot drift between them.
//
// Folder tree (Aaron's choice 3A):
//   Tandem issue photos / {location} / {unit or "Whole building"} /
//     {YYYY-MM-DD short description} / report.txt, photo 1.jpg, photo 2.jpg ...

export const ROOT_FOLDER_NAME = 'Tandem issue photos'
const NAME_LIMIT = 60

// A name that is safe as a Drive or zip folder name: no slashes or other
// path characters, no leading dots, no runs of spaces, and not too long.
export function safeName(text: string | null | undefined, max = NAME_LIMIT, fallback = 'Untitled'): string {
  const cleaned = String(text ?? '')
    // deno-lint-ignore no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    // Words made only of dots (".." from "../..") are dropped, then any
    // leading dots on what is left.
    .replace(/(^| )\.+(?= |$)/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .trim()
  const cut = cleaned.length > max ? cleaned.slice(0, max).trim() : cleaned
  return cut || fallback
}

// 'YYYY-MM-DD' in Eastern time, where the property and the house manager are.
export function easternDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

// '2026-10-12 Kitchen faucet is leaking' (the first words of what he wrote).
export function reportFolderName(createdAtIso: string, body: string): string {
  const firstLine = String(body ?? '').split('\n')[0]
  return `${easternDate(createdAtIso)} ${safeName(firstLine, 40, 'Issue')}`
}

// The folder name for one report when several reports of the same place share
// the same date and opening words (a repeated report, a retried Send). The
// earliest keeps the plain name; later ones get " (2)", " (3)". Decided from
// created_at, so it comes out the same whichever order they are backed up in.
export function uniqueReportFolderName(
  report: { id: string; created_at: string; body: string },
  peers: { id: string; created_at: string; body: string }[],
): string {
  const base = reportFolderName(report.created_at, report.body)
  const same = [report, ...peers.filter((p) => p.id !== report.id)]
    .filter((r) => reportFolderName(r.created_at, r.body) === base)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
  const rank = same.findIndex((r) => r.id === report.id)
  return rank <= 0 ? base : `${base} (${rank + 1})`
}

// Folders above the report folder: location, then unit (or "Whole building").
export function placeFolders(locationName: string | null | undefined, unitName: string | null | undefined): string[] {
  return [safeName(locationName, NAME_LIMIT, 'No location'), safeName(unitName, NAME_LIMIT, 'Whole building')]
}

export function photoFileName(ordinal: number): string {
  return `photo ${Math.max(1, Math.floor(ordinal))}.jpg`
}

const URGENCY_TEXT: Record<string, string> = { can_wait: 'Can wait', soon: 'Soon', urgent: 'Urgent' }

export function urgencyLabel(urgency: string): string {
  return URGENCY_TEXT[urgency] || urgency
}

export type ReportInfo = {
  place: string
  reporter: string | null
  createdAt: string
  urgency: string
  body: string
  photoCount: number
}

// The report.txt that sits beside the photos, so a folder makes sense on its own.
export function reportText(info: ReportInfo): string {
  const when = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(info.createdAt))
  return [
    `Place: ${info.place}`,
    `Reported by: ${info.reporter || 'the house manager'}`,
    `Reported: ${when} ET`,
    `How urgent: ${urgencyLabel(info.urgency)}`,
    `Photos: ${info.photoCount}`,
    '',
    info.body,
    '',
  ].join('\n')
}

export type PhotoRow = {
  backed_up_at: string | null
  removed_at: string | null
  backup_kind: string | null
  drive_file_id: string | null
}

// Whether a photo may be removed from Tandem: it was backed up (a Drive copy
// Tandem checked, or a zip a member said they saved), it is not already
// removed, and its issue is done. The server applies this to every photo
// itself; the screen's count is only a preview of it.
export function removableFromTandem(photo: PhotoRow, reportDone: boolean): boolean {
  if (!photo.backed_up_at || photo.removed_at || !reportDone) return false
  if (photo.backup_kind === 'drive') return Boolean(photo.drive_file_id)
  return photo.backup_kind === 'zip'
}

// A Drive copy counts only if Drive reports the same number of bytes.
export function copyMatches(expectedBytes: number, reportedBytes: unknown): boolean {
  return typeof reportedBytes === 'number' && Number.isFinite(reportedBytes) && reportedBytes === expectedBytes
}

// Binary to base64 in chunks (one huge String.fromCharCode call overflows).
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export type DriveRequest = {
  token: string
  path: string[]
  fileName: string
  dataBase64: string
  reportText?: string
}

// What the Apps Script receives for one photo. The report text is sent with
// every photo of the report; the script only writes report.txt if it is not
// already there, so a retry never duplicates anything.
export function driveRequest(token: string, path: string[], fileName: string, bytes: Uint8Array, text: string): DriveRequest {
  return { token, path, fileName, dataBase64: bytesToBase64(bytes), reportText: text }
}

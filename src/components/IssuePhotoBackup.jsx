import { useCallback, useEffect, useState } from 'react'
import { friendlyError } from '../lib/friendlyError'
import { useConfirm } from '../lib/confirmContext'
import {
  STORAGE_LIMIT_BYTES,
  buildPhotosZip,
  downloadBlob,
  fetchBackupStatus,
  fetchPhotoSummary,
  formatBytes,
  isBackupSetupMissing,
  markZipSaved,
  removeBackedUpPhotos,
  runDriveBackup,
} from '../lib/issuePhotoBackup'
import Modal from './Modal'
import ModalCard from './ModalCard'
import LoadingText from './LoadingText'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`
}

function Stat({ label, value, sub }) {
  return (
    <div className="min-w-0 rounded-[8px] bg-pill-bg px-2.5 py-2">
      <div className="text-[11px] text-text">{label}</div>
      <div className="text-[18px] font-semibold text-text-h">{value}</div>
      {sub && <div className="text-[11px] text-text">{sub}</div>}
    </div>
  )
}

// Settings > Issue photos: copy the house manager's photos to Google Drive (or
// a zip), then let an admin remove the backed-up photos of finished issues from
// Tandem to free its storage. Nothing is removed unless it was backed up first.
export default function IssuePhotoBackup({ me, onClose }) {
  const confirm = useConfirm()
  const [summary, setSummary] = useState(null)
  const [setupMissing, setSetupMissing] = useState(false)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState('') // '' | 'drive' | 'zip' | 'remove'
  const [progress, setProgress] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [zip, setZip] = useState(null) // { photoIds, count, bytes, fileName }
  const [zipSaved, setZipSaved] = useState(false)

  const reload = useCallback(async () => {
    try {
      setSummary(await fetchPhotoSummary())
      setSetupMissing(false)
    } catch (err) {
      if (isBackupSetupMissing(err)) setSetupMissing(true)
      else setError(friendlyError(err))
    }
  }, [])

  useEffect(() => {
    reload()
    fetchBackupStatus().then(setStatus)
  }, [reload])

  async function backUpToDrive() {
    setBusy('drive')
    setError('')
    setMessage('')
    setProgress('Backing up…')
    try {
      const result = await runDriveBackup((done) => setProgress(`Backing up: ${done} of ${summary?.pending_count ?? '?'}…`))
      if (result.ok) setMessage(`${plural(result.backedUp, 'photo is', 'photos are')} backed up to Google Drive.`)
      else setError(`${result.message}${result.backedUp ? ` ${plural(result.backedUp, 'photo was', 'photos were')} backed up before it stopped.` : ''}`)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy('')
      setProgress('')
      reload()
    }
  }

  async function makeZip() {
    setBusy('zip')
    setError('')
    setMessage('')
    setZip(null)
    setZipSaved(false)
    setProgress('Preparing the zip…')
    try {
      const built = await buildPhotosZip((done, total) => setProgress(`Preparing the zip: ${done} of ${total}…`))
      if (!built) {
        setMessage('There are no photos waiting to be backed up.')
        return
      }
      downloadBlob(built.blob, built.fileName)
      setZip({ photoIds: built.photoIds, count: built.count, bytes: built.bytes, fileName: built.fileName })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy('')
      setProgress('')
    }
  }

  async function confirmZipSaved() {
    if (!zip || !zipSaved) return
    setBusy('zip')
    setError('')
    try {
      const count = await markZipSaved(zip.photoIds)
      setMessage(`${plural(count, 'photo is', 'photos are')} counted as backed up.`)
      setZip(null)
      setZipSaved(false)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy('')
      reload()
    }
  }

  async function removePhotos() {
    const n = summary?.removable_count || 0
    if (n === 0) return
    const ok = await confirm({
      title: `Remove ${plural(n, 'photo', 'photos')} from Tandem?`,
      message: `Each one was backed up first, to Google Drive or in a zip you said you saved. This frees about ${formatBytes(summary.removable_bytes)}. The reports and tasks stay and will point to the backup. This can't be undone from Tandem.`,
      confirmLabel: `Remove ${plural(n, 'photo', 'photos')}`,
    })
    if (!ok) return
    setBusy('remove')
    setError('')
    setMessage('')
    try {
      const result = await removeBackedUpPhotos(n)
      if (result?.ok) setMessage(`${plural(result.removed, 'photo was', 'photos were')} removed from Tandem.`)
      else setError(result?.message || "The photos couldn't be removed.")
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy('')
      reload()
    }
  }

  const working = busy !== ''
  const used = summary?.in_tandem_bytes ?? 0

  return (
    <Modal onClose={() => { if (!working) onClose() }}>
      <ModalCard>
        <h2>Issue photos</h2>
        {setupMissing ? (
          <p className="text-sm">Photo back-up isn't set up yet. Ask whoever manages Tandem to finish setting it up.</p>
        ) : !summary && !error ? (
          <LoadingText />
        ) : summary ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-1.5">
              <Stat label="In Tandem" value={summary.in_tandem_count} sub={`${formatBytes(used)} of ${formatBytes(STORAGE_LIMIT_BYTES)}`} />
              <Stat label="Backed up" value={summary.backed_up_count} />
              <Stat label="Not yet" value={summary.pending_count} />
            </div>

            {summary.pending_count === 0 ? (
              <p className="m-0 text-sm text-text-h">Every photo in Tandem is backed up.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {status && !status.deployed ? (
                  <p className="m-0 text-sm">Google Drive back-up isn't installed yet. Ask whoever manages Tandem to finish the setup in <code>apps-script/README.md</code>. You can still download a zip.</p>
                ) : status && !status.configured ? (
                  <p className="m-0 text-sm">Google Drive isn't connected yet. The setup steps are in <code>apps-script/README.md</code> in the Tandem project. You can still download a zip.</p>
                ) : (
                  <SubmissionButton variant="primary" className="min-h-[44px] w-full" disabled={working || !status} onClick={backUpToDrive}>
                    {busy === 'drive' ? progress : `Back up ${plural(summary.pending_count, 'photo', 'photos')} to Google Drive`}
                  </SubmissionButton>
                )}
                {busy === 'drive' && <p className="m-0 text-xs text-text">Keep this screen open. If it stops, tap Back up again; nothing is copied twice.</p>}
                <SubmissionButton className="min-h-[44px] w-full" disabled={working} onClick={makeZip}>
                  {busy === 'zip' && !zip ? progress || 'Preparing the zip…' : 'Download a zip instead'}
                </SubmissionButton>
              </div>
            )}

            {zip && (
              <div className="flex flex-col gap-2 rounded-[8px] border border-border p-3">
                <p className="m-0 text-sm text-text-h">
                  Zip downloaded: {plural(zip.count, 'photo', 'photos')}, {formatBytes(zip.bytes)}. Tandem can't see where it was saved.
                </p>
                <label className="flex min-h-[44px] items-center gap-2 text-sm text-text-h">
                  <input type="checkbox" checked={zipSaved} onChange={(e) => setZipSaved(e.target.checked)} />
                  I saved this file somewhere safe
                </label>
                <SubmissionButton className="min-h-[44px]" disabled={!zipSaved || working} onClick={confirmZipSaved}>
                  Count these as backed up
                </SubmissionButton>
              </div>
            )}

            {(summary.removable_count > 0 || summary.kept_open_count > 0 || summary.removed_count > 0) && (
              <div className="flex flex-col gap-2 border-t border-border pt-3">
                {summary.removable_count > 0 && (
                  <p className="m-0 text-sm text-text-h">
                    <strong>{plural(summary.removable_count, 'backed-up photo', 'backed-up photos')} can be removed</strong> (about {formatBytes(summary.removable_bytes)}).
                  </p>
                )}
                {summary.kept_open_count > 0 && (
                  <p className="m-0 text-sm text-text">
                    {summary.removable_count > 0 ? `${summary.kept_open_count} more are` : `${plural(summary.kept_open_count, 'backed-up photo is', 'backed-up photos are')}`} kept because their issue is still open.
                  </p>
                )}
                {summary.removed_count > 0 && <p className="m-0 text-xs text-text">{plural(summary.removed_count, 'photo has', 'photos have')} been removed so far.</p>}
                {summary.removable_count > 0 &&
                  (me?.is_admin ? (
                    <SubmissionButton variant="destructive" className="min-h-[44px] w-full" disabled={working} onClick={removePhotos}>
                      {busy === 'remove' ? 'Removing…' : `Remove ${plural(summary.removable_count, 'photo', 'photos')} from Tandem`}
                    </SubmissionButton>
                  ) : (
                    <p className="m-0 text-xs text-text">Only an admin can remove photos.</p>
                  ))}
              </div>
            )}
          </div>
        ) : null}

        {message && <p role="status" className="mb-0 mt-3 text-sm text-text-h">{message}</p>}
        {error && <p role="alert" className="error">{error}</p>}
        <SubmissionActions>
          <SubmissionButton className="min-h-[44px]" disabled={working} onClick={onClose}>Close</SubmissionButton>
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

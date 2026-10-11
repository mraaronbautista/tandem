import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { fetchIssuePhotos } from '../lib/issuePhotos'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

// "Photos from the house manager" on an issue task: thumbnails you tap to open
// full size. New photos appear as they finish uploading (the report and its
// alert go out first, the photos follow). Renders nothing when there are none.
export default function IssuePhotos({ taskId }) {
  const [photos, setPhotos] = useState([])
  const [moved, setMoved] = useState([])
  const [viewing, setViewing] = useState(null) // index

  useEffect(() => {
    let cancelled = false
    let generation = 0
    async function load() {
      const version = ++generation
      const next = await fetchIssuePhotos(taskId)
      if (!cancelled && version === generation) {
        setPhotos(next.photos)
        setMoved(next.moved)
      }
    }
    load()
    // A unique channel name per mount: two open copies of the same task must
    // not share (and then tear down) one channel.
    const channel = supabase
      .channel(`issue-photos-${taskId}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_issue_photos' }, load)
      .subscribe()
    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [taskId])

  if (photos.length === 0 && moved.length === 0) return null
  const driveMoved = moved.filter((m) => m.kind === 'drive')
  const zipMoved = moved.filter((m) => m.kind !== 'drive')
  const when = (list) => new Date(list[list.length - 1].removedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
  const folderUrl = driveMoved.find((m) => m.folderUrl)?.folderUrl
  const current = viewing === null ? null : photos[viewing]

  return (
    <div className="mb-2">
      <p className="m-0 mb-1.5 text-[13px] font-semibold text-text-h">
        Photos from the house manager ({photos.length + moved.length})
      </p>
      {moved.length > 0 && (
        <div className="mb-2 rounded-[8px] bg-pill-bg px-3 py-2 text-[13px] text-text-h">
          {driveMoved.length > 0 && (
            <p className="m-0">
              {driveMoved.length === 1 ? '1 photo' : `${driveMoved.length} photos`} moved to Google Drive on {when(driveMoved)}.
              {folderUrl && (
                <>
                  {' '}
                  <a href={folderUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-text">Open the folder in Drive</a>
                </>
              )}
            </p>
          )}
          {zipMoved.length > 0 && (
            <p className="m-0">{zipMoved.length === 1 ? '1 photo was' : `${zipMoved.length} photos were`} saved in a zip file and removed from Tandem on {when(zipMoved)}.</p>
          )}
        </div>
      )}
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {photos.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              aria-label={`Open photo ${i + 1} of ${photos.length}`}
              className="block h-[84px] w-[84px] cursor-pointer overflow-hidden rounded-[8px] border border-border bg-pill-bg p-0"
              onClick={() => setViewing(i)}
            >
              <img src={p.url} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          </li>
        ))}
      </ul>

      {current && (
        <Modal onClose={() => setViewing(null)}>
          <ModalCard>
            <h2>Photo {viewing + 1} of {photos.length}</h2>
            <img src={current.url} alt={`Photo ${viewing + 1} of ${photos.length}, from the house manager`} className="max-h-[70vh] w-full rounded-[8px] object-contain" />
            <SubmissionActions>
              {photos.length > 1 && (
                <>
                  <SubmissionButton className="min-h-[44px]" aria-label="Previous photo" disabled={viewing === 0} onClick={() => setViewing((v) => Math.max(0, v - 1))}>
                    <ChevronLeft size={16} aria-hidden="true" />
                  </SubmissionButton>
                  <SubmissionButton className="min-h-[44px]" aria-label="Next photo" disabled={viewing === photos.length - 1} onClick={() => setViewing((v) => Math.min(photos.length - 1, v + 1))}>
                    <ChevronRight size={16} aria-hidden="true" />
                  </SubmissionButton>
                </>
              )}
              <SubmissionButton variant="primary" className="min-h-[44px]" onClick={() => setViewing(null)}>Close</SubmissionButton>
            </SubmissionActions>
          </ModalCard>
        </Modal>
      )}
    </div>
  )
}

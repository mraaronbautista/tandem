import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  URGENCY_OPTIONS,
  fetchIssuePlaces,
  fetchMyIssueReports,
  groupIssuePlaces,
  isIssueSetupMissing,
  reportIssue,
} from '../lib/staffIssues'
import { friendlyError } from '../lib/friendlyError'
import Modal from './Modal'
import ModalCard from './ModalCard'
import LoadingText from './LoadingText'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

const FIELD = 'w-full min-h-[44px] rounded-[8px] border border-border bg-bg px-3 py-2 text-[15px] text-text-h'
const MAX = 500

function when(iso) {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay ? 'today' : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// The house manager's "Report an issue": a button, a short form, and a list of
// his own recent reports with whether each is still open. A report becomes a
// task for the admin and an alert; he never sees the task board itself.
export default function StaffIssueReports() {
  const [reports, setReports] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [open, setOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    let generation = 0
    async function load() {
      const version = ++generation
      try {
        const data = await fetchMyIssueReports()
        if (!cancelled && version === generation) setReports(data)
      } catch {
        // Not set up yet, or a network blip: the button still works and the
        // list simply stays as it was.
        if (!cancelled && version === generation) setReports((current) => current ?? [])
      }
    }
    function refreshWhenVisible() {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)
    window.addEventListener('online', refreshWhenVisible)
    load()
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
      window.removeEventListener('online', refreshWhenVisible)
    }
  }, [reloadKey])

  const shown = showAll ? reports : (reports || []).slice(0, 5)

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-[12px] border border-border-accent bg-transparent px-4 text-[15px] font-semibold text-accent-text"
        onClick={() => setOpen(true)}
      >
        <AlertTriangle size={18} aria-hidden="true" /> Report an issue
      </button>

      {reports && reports.length > 0 && (
        <section aria-label="Your reports" className="flex flex-col gap-1.5">
          <h2 className="m-0 text-[13px] font-semibold uppercase tracking-wide text-text-h">Your reports</h2>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {shown.map((r) => (
              <li key={r.id} className="min-w-0 rounded-[10px] border border-border bg-card-bg px-3 py-2">
                <div className="flex min-w-0 items-baseline justify-between gap-2">
                  <span className="min-w-0 text-sm font-semibold text-text-h [overflow-wrap:anywhere]">{r.place}</span>
                  <span
                    className={`flex-none rounded-full px-2 py-0.5 text-xs font-semibold ${r.status === 'done' ? 'bg-pill-bg text-text' : 'bg-pill-bg text-accent-text'}`}
                  >
                    {r.status === 'done' ? 'Done' : 'Open'}
                  </span>
                </div>
                <p className="m-0 mt-0.5 line-clamp-2 text-[13px] text-text [overflow-wrap:anywhere]">{r.body}</p>
                <span className="text-xs opacity-80">{when(r.created_at)}{r.urgency === 'urgent' ? ' · urgent' : ''}</span>
              </li>
            ))}
          </ul>
          {reports.length > 5 && (
            <button type="button" className="min-h-10 cursor-pointer self-start border-0 bg-transparent p-0 text-[13px] font-semibold text-accent-text" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer' : `Show all ${reports.length}`}
            </button>
          )}
        </section>
      )}

      {open && <IssueSheet onClose={() => setOpen(false)} onSent={() => setReloadKey((k) => k + 1)} />}
    </div>
  )
}

function IssueSheet({ onClose, onSent }) {
  const [places, setPlaces] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [placeKey, setPlaceKey] = useState('')
  const [body, setBody] = useState('')
  const [urgency, setUrgency] = useState('soon')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchIssuePlaces()
      .then((data) => { if (!cancelled) setPlaces(data) })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(isIssueSetupMissing(err)
            ? "Reporting isn't set up yet. Ask Ada or Aaron to finish setting it up."
            : friendlyError(err))
        }
      })
    return () => { cancelled = true }
  }, [])

  const groups = useMemo(() => groupIssuePlaces(places), [places])
  const options = useMemo(() => groups.flatMap((g) => g.options), [groups])

  async function submit(event) {
    event.preventDefault()
    if (sending) return
    const place = options.find((o) => o.key === placeKey)
    if (!place) { setError('Choose where the issue is.'); return }
    if (!body.trim()) { setError('Say what is wrong.'); return }
    setSending(true)
    setError('')
    try {
      const sent = await reportIssue({ propertyId: place.propertyId, workSiteId: place.workSiteId, body: body.trim(), urgency })
      setResult(sent)
      onSent()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal onClose={() => { if (!sending) onClose() }}>
      <ModalCard>
        <h2>Report an issue</h2>
        {result ? (
          <>
            <p role="status" className="text-sm text-text-h">
              {result.alerted
                ? 'Sent. It is on the task list and an alert went out.'
                : 'Saved. It is on the task list, but the alert may not have gone out. Call if it is urgent.'}
            </p>
            <SubmissionActions>
              <SubmissionButton variant="primary" className="min-h-[44px]" onClick={onClose}>Done</SubmissionButton>
            </SubmissionActions>
          </>
        ) : loadError ? (
          <>
            <p role="alert" className="text-sm">{loadError}</p>
            <SubmissionActions><SubmissionButton className="min-h-[44px]" onClick={onClose}>Close</SubmissionButton></SubmissionActions>
          </>
        ) : !places ? (
          <LoadingText />
        ) : (
          <form onSubmit={submit} className="min-w-0">
            <fieldset disabled={sending} className="m-0 min-w-0 border-0 p-0">
              <label className="block text-sm text-text-h">
                Where
                <select className={FIELD} value={placeKey} onChange={(e) => setPlaceKey(e.target.value)}>
                  <option value="">Choose a unit or the whole building</option>
                  {groups.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="mt-3 block text-sm text-text-h">
                What is wrong
                <textarea
                  className={`${FIELD} min-h-[88px]`}
                  value={body}
                  maxLength={MAX}
                  placeholder="Kitchen faucet is leaking under the sink, water on the floor."
                  onChange={(e) => setBody(e.target.value)}
                />
                <span className="text-xs opacity-80">{body.length}/{MAX}</span>
              </label>
              <p className="mb-1 mt-3 text-sm text-text-h">How urgent</p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How urgent">
                {URGENCY_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={urgency === o.value}
                    className={`min-h-11 cursor-pointer rounded-full border px-4 text-sm ${urgency === o.value ? (o.value === 'urgent' ? 'border-overdue bg-overdue font-semibold text-white' : 'border-accent bg-accent font-semibold text-on-accent') : 'border-border bg-pill-bg text-text-h'}`}
                    onClick={() => setUrgency(o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="mb-0 mt-1 text-xs text-text">Urgent sends a high-priority alert right away. Photos are not included yet.</p>
            </fieldset>
            {error && <p role="alert" className="error">{error}</p>}
            <SubmissionActions>
              <SubmissionButton className="min-h-[44px]" disabled={sending} onClick={onClose}>Cancel</SubmissionButton>
              <SubmissionButton className="min-h-[44px]" variant="primary" type="submit" disabled={sending}>{sending ? 'Sending…' : 'Send'}</SubmissionButton>
            </SubmissionActions>
          </form>
        )}
      </ModalCard>
    </Modal>
  )
}

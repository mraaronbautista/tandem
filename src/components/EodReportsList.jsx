import { useEffect, useState } from 'react'
import { fetchEodReports } from '../lib/eodReports'
import Modal from './Modal'

function formatDate(iso) {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export default function EodReportsList({ memberName, onClose }) {
  const [reports, setReports] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchEodReports()
      .then(setReports)
      .catch((err) => setError(err.message))
  }, [])

  return (
    <Modal onClose={onClose}>
      <div className="submission-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Reports</h2>

        {error && <p className="error">{error}</p>}
        {!error && !reports && <p className="loading">Loading…</p>}
        {reports && !reports.length && <p className="task-notes-empty">No reports yet.</p>}

        {reports?.length > 0 && (
          <div className="eod-reports-list">
            {reports.map((r) => (
              <div className="eod-report-item" key={r.id}>
                <p className="eod-report-meta">
                  <strong>{memberName(r.submitted_by)}</strong> — {r.period} — updated {formatDate(r.updated_at)}
                  {r.minutes_logged != null && ` — ${formatMinutes(r.minutes_logged)}`}
                </p>
                <p className="task-submission-note-text">{r.body}</p>
              </div>
            ))}
          </div>
        )}

        <div className="submission-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}

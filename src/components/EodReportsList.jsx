import { useEffect, useState } from 'react'
import { fetchEodReports } from '../lib/eodReports'

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

// "2026-08" -> "August 2026" — grouping key doubles as a stable sort key
// (string-sortable) and a display label once split back apart.
function monthKey(dateStr) {
  return dateStr.slice(0, 7)
}

function monthLabel(key) {
  const [year, month] = key.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' })
}

// Grouped by calendar month (of report_date, the stable bucket identity —
// not updated_at, which just determines sort order within a month) so the
// list stays a handful of collapsible headers instead of growing forever —
// one row per person per day/week/month otherwise still adds up over a year.
// Persistent tab content, not a modal — see RentalsView.jsx for why.
export default function EodReportsList({ memberName }) {
  const [reports, setReports] = useState(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())

  useEffect(() => {
    fetchEodReports()
      .then((data) => {
        setReports(data)
        if (data.length) setExpanded(new Set([monthKey(data[0].report_date)]))
      })
      .catch((err) => setError(err.message))
  }, [])

  function toggleMonth(key) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const groups = []
  if (reports?.length) {
    const byMonth = new Map()
    for (const r of reports) {
      const key = monthKey(r.report_date)
      if (!byMonth.has(key)) byMonth.set(key, [])
      byMonth.get(key).push(r)
    }
    for (const [key, items] of byMonth) groups.push({ key, items })
    groups.sort((a, b) => (a.key < b.key ? 1 : -1))
  }

  return (
    <div className="tab-panel">
      <h2>Reports</h2>

      {error && <p className="error">{error}</p>}
      {!error && !reports && <p className="loading">Loading…</p>}
      {reports && !reports.length && <p className="task-notes-empty">No reports yet.</p>}

      {groups.length > 0 && (
        <div className="eod-reports-list">
          {groups.map((group) => (
            <div key={group.key} className="eod-report-month">
              <button type="button" className="eod-report-month-header" onClick={() => toggleMonth(group.key)}>
                <span>{monthLabel(group.key)}</span>
                <span className="eod-report-month-count">
                  {group.items.length} {expanded.has(group.key) ? '▾' : '▸'}
                </span>
              </button>

              {expanded.has(group.key) && (
                <div className="eod-report-month-items">
                  {group.items.map((r) => (
                    <div className="eod-report-item" key={r.id}>
                      <p className="eod-report-meta">
                        <strong>{memberName(r.submitted_by)}</strong> — {r.period} — updated{' '}
                        {formatDate(r.updated_at)}
                        {r.minutes_logged != null && ` — ${formatMinutes(r.minutes_logged)}`}
                      </p>
                      <p className="task-submission-note-text">{r.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

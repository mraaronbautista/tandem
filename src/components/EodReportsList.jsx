import { useEffect, useState } from 'react'
import { fetchEodReports } from '../lib/eodReports'
import AttachmentList from './AttachmentList'
import { PeriodTabs, PeriodTab } from './PeriodTabs'

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

// No 'biweekly' filter tab, matching EndOfDayReportForm.jsx's picker —
// see the comment there. "All" still surfaces any past biweekly report
// (filteredReports below doesn't special-case period at all), just with
// no dedicated way to filter down to only those.
const PERIOD_TABS = [
  { value: 'all', label: 'All' },
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

// Grouped by calendar month (of report_date, the stable bucket identity —
// not updated_at, which just determines sort order within a month) so the
// list stays a handful of collapsible headers instead of growing forever —
// one row per person per day/week/month otherwise still adds up over a year.
// A period filter (All/Day/Week/Month, same .period-tabs pattern used
// elsewhere for this exact Day/Week/Month split) sits above the month
// groups, since day/week/month reports otherwise interleave in one mixed
// list with no way to look at just one kind — "what did the last few
// weekly summaries actually say" meant scrolling past every daily entry
// in between them.
// Persistent tab content, not a modal — see RentalsView.jsx for why.
export default function EodReportsList({ memberName }) {
  const [reports, setReports] = useState(null)
  const [error, setError] = useState('')
  const [period, setPeriod] = useState('all')
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

  // Re-derives which month is auto-open for the newly filtered set —
  // switching to Week, say, shouldn't leave the previously-open month
  // expanded if it turns out to have no week reports at all, or leave
  // everything collapsed if the top month under the old filter isn't
  // the top month under the new one.
  function handlePeriodChange(next) {
    setPeriod(next)
    const filtered = next === 'all' ? reports : reports?.filter((r) => r.period === next)
    setExpanded(filtered?.length ? new Set([monthKey(filtered[0].report_date)]) : new Set())
  }

  const filteredReports = period === 'all' ? reports : reports?.filter((r) => r.period === period)

  const groups = []
  if (filteredReports?.length) {
    const byMonth = new Map()
    for (const r of filteredReports) {
      const key = monthKey(r.report_date)
      if (!byMonth.has(key)) byMonth.set(key, [])
      byMonth.get(key).push(r)
    }
    for (const [key, items] of byMonth) groups.push({ key, items })
    groups.sort((a, b) => (a.key < b.key ? 1 : -1))
  }

  return (
    <div className="tab-panel">
      {error && <p className="error">{error}</p>}
      {!error && !reports && <p className="loading">Loading…</p>}
      {reports && !reports.length && <p className="task-notes-empty">No reports yet.</p>}

      {reports?.length > 0 && (
        <PeriodTabs>
          {PERIOD_TABS.map((p) => (
            <PeriodTab key={p.value} active={period === p.value} onClick={() => handlePeriodChange(p.value)}>
              {p.label}
            </PeriodTab>
          ))}
        </PeriodTabs>
      )}

      {reports?.length > 0 && groups.length === 0 && (
        <p className="task-notes-empty">No {period} reports yet.</p>
      )}

      {groups.length > 0 && (
        <div className="flex flex-col gap-2">
          {groups.map((group) => (
            <div key={group.key}>
              <button
                type="button"
                className="flex w-full cursor-pointer items-center justify-between rounded-sm border border-border bg-pill-bg px-2.5 py-2 font-semibold text-text-h [font-family:inherit] [font-size:inherit] [font-style:inherit] [font-variant:inherit] [line-height:inherit] transition-transform duration-[120ms] ease-tactile active:scale-[0.98]"
                onClick={() => toggleMonth(group.key)}
              >
                <span>{monthLabel(group.key)}</span>
                <span className="text-[13px] font-normal opacity-60">
                  {group.items.length} {expanded.has(group.key) ? '▾' : '▸'}
                </span>
              </button>

              {expanded.has(group.key) && (
                <div className="flex flex-col gap-3.5 px-1 pt-2.5">
                  {group.items.map((r) => (
                    <div className="border-b border-border pb-3 last:border-b-0 last:pb-0" key={r.id}>
                      <p className="mb-1 text-xs opacity-60">
                        <strong>{memberName(r.submitted_by)}</strong> — {r.period} — updated{' '}
                        {formatDate(r.updated_at)}
                        {r.minutes_logged != null && ` — ${formatMinutes(r.minutes_logged)}`}
                      </p>
                      <p className="task-submission-note-text">{r.body}</p>
                      <AttachmentList
                        attachments={r.attachments?.map((a) => ({ url: a.url, name: `${a.taskTitle}: ${a.name}` }))}
                      />
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

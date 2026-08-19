import { useEffect, useState } from 'react'
import { getCompletedInPeriod, getCompletedSince, reportDateForPeriod } from '../lib/tasks'
import { whoKeyForName } from '../lib/whoLabels'
import { submitEodReport, fetchOwnEodReport } from '../lib/eodReports'
import { sendEodReportNotification } from '../lib/manualNotify'
import AttachmentList from './AttachmentList'
import Modal from './Modal'

const PERIODS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'biweekly', label: '2 Weeks' },
]

// A noun to slot into "this ___" prose — day/week/month already read
// fine as-is ("this week"), but "this biweekly" doesn't, since biweekly
// is an adjective, not a noun. Only needed here; "biweekly report" (the
// H2 title, the sent-notification text) already reads fine using the
// raw period value directly, same as day/week/month do.
const PERIOD_NOUN = { day: 'day', week: 'week', month: 'month', biweekly: 'pay period' }

const MINUTE_OPTIONS = ['00', '15', '30', '45']

// Same "since last submission" vs. "whole period" branch the draft body
// and the actual attachment snapshot both need — factored out so they
// can't quietly disagree about which tasks this submission covers.
function getRelevantCompletedTasks(tasks, whoKey, period, existingReport) {
  return existingReport
    ? getCompletedSince(tasks, whoKey, new Date(existingReport.updated_at))
    : getCompletedInPeriod(tasks, whoKey, period)
}

// Flattens completion_attachments off whichever tasks this submission's
// tally covers into the [{taskTitle, url, name}] shape eod_reports.
// attachments stores — a denormalized snapshot at submit time, not a
// live reference (see the column comment in schema.sql).
function collectAttachments(completedTasks) {
  return completedTasks.flatMap((t) =>
    (t.completion_attachments || []).map((a) => ({ taskTitle: t.title, url: a.url, name: a.name })),
  )
}

function buildDraft(completedTasks, period, isAppend) {
  if (!completedTasks.length) {
    return isAppend ? 'Nothing new completed since your last update.' : `Nothing completed this ${PERIOD_NOUN[period]}.`
  }
  const heading = isAppend ? 'Completed since your last update' : `Completed this ${PERIOD_NOUN[period]}`
  const lines = completedTasks.map((t) => {
    const count = t.completion_attachments?.length || 0
    const suffix = count > 0 ? ` (📎 ${count} file${count > 1 ? 's' : ''})` : ''
    return `- ${t.title}${suffix}`
  })
  return `${heading}:\n${lines.join('\n')}`
}

function formatTimeNow() {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// One row per (person, period, period-bucket-date) now — a work day
// rarely happens in one sitting, so re-opening this for a bucket already
// started today shows what's logged so far and treats the textarea as
// something to ADD, not replace. Minutes worked is a directly-editable
// total (matching an external time tracker), not something summed from
// sessions — leaving it blank on a given submission keeps whatever total
// was last set; entering a new one replaces it outright.
export default function EndOfDayReportForm({ tasks, me, onClose }) {
  const whoKey = whoKeyForName(me?.display_name)
  const [period, setPeriod] = useState('day')
  const [existingReport, setExistingReport] = useState(undefined) // undefined = still loading
  const [body, setBody] = useState('')
  const [hoursInput, setHoursInput] = useState('')
  const [minutesInput, setMinutesInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setExistingReport(undefined)

    fetchOwnEodReport(me.id, period, reportDateForPeriod(period))
      .then((existing) => {
        if (cancelled) return
        setExistingReport(existing)

        if (existing) {
          setBody(buildDraft(getRelevantCompletedTasks(tasks, whoKey, period, existing), period, true))
          if (existing.minutes_logged != null) {
            setHoursInput(String(Math.floor(existing.minutes_logged / 60)))
            setMinutesInput(String(existing.minutes_logged % 60).padStart(2, '0'))
          } else {
            setHoursInput('')
            setMinutesInput('')
          }
        } else {
          setBody(buildDraft(getRelevantCompletedTasks(tasks, whoKey, period, null), period, false))
          setHoursInput('')
          setMinutesInput('')
        }
      })
      .catch((err) => !cancelled && setError(err.message))

    return () => {
      cancelled = true
    }
    // Deliberately not keyed on `tasks`/`whoKey` — the draft is a one-time
    // convenience computed when you land on/switch a tab, not something
    // that should shift under you mid-edit as realtime task updates come in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, me.id])

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const bodyChunk = existingReport && body.trim() ? `${formatTimeNow()}\n${body}` : body
      const minutesLogged =
        hoursInput === '' && minutesInput === '' ? null : Number(hoursInput || 0) * 60 + Number(minutesInput || 0)
      // Re-derived at submit time rather than reused from the initial
      // draft state — matches whichever tasks are actually completed
      // right now, not a stale snapshot from when the form was opened.
      const attachments = collectAttachments(getRelevantCompletedTasks(tasks, whoKey, period, existingReport))

      await submitEodReport(period, reportDateForPeriod(period), { bodyChunk, minutesLogged, attachments })

      const hoursText =
        minutesLogged != null ? `${Math.floor(minutesLogged / 60)}h ${minutesLogged % 60}m logged — ` : ''
      await sendEodReportNotification(`${hoursText}${existingReport ? 'updated' : 'submitted'} ${period} report.`)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const loading = existingReport === undefined

  return (
    <Modal onClose={onClose}>
      <form className="submission-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>{period[0].toUpperCase() + period.slice(1)} report</h2>

        <div className="period-tabs">
          {PERIODS.map((p) => (
            <button
              type="button"
              key={p.value}
              className={`period-tab${period === p.value ? ' period-tab-active' : ''}`}
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {error && <p className="error">{error}</p>}

        {!loading && existingReport && (
          <div className="submission-field">
            <span className="submission-field-label">Already logged this {PERIOD_NOUN[period]}</span>
            <p className="task-submission-note-text eod-report-existing">{existingReport.body}</p>
            <AttachmentList
              attachments={existingReport.attachments?.map((a) => ({ url: a.url, name: `${a.taskTitle}: ${a.name}` }))}
            />
          </div>
        )}

        <label className="submission-field">
          Total time worked this {PERIOD_NOUN[period]}
          <div className="hours-minutes-row">
            <input
              type="number"
              min="0"
              placeholder="0"
              value={hoursInput}
              onChange={(e) => setHoursInput(e.target.value)}
            />
            <span>hr</span>
            <select value={minutesInput} onChange={(e) => setMinutesInput(e.target.value)}>
              <option value="">—</option>
              {MINUTE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <span>min</span>
          </div>
        </label>

        <label className="submission-field">
          {existingReport ? 'Add to this report' : 'Report'}
          <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} disabled={loading} />
        </label>

        <div className="submission-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="submission-save" disabled={submitting || loading}>
            {submitting ? 'Sending…' : 'Send to Ada'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

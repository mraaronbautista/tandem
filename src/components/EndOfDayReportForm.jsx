import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getCompletedInPeriod, getCompletedSince, reportDateForPeriod, periodBucketLabel } from '../lib/tasks'
import IconButton from './IconButton'
import { whoKeyForName } from '../lib/whoLabels'
import { submitEodReport, fetchOwnEodReport } from '../lib/eodReports'
import { sendEodReportNotification } from '../lib/manualNotify'
import AttachmentList from './AttachmentList'
import Modal from './Modal'
import { PeriodTabs, PeriodTab } from './PeriodTabs'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

// 'biweekly' is deliberately left out of this picker — Ada/Aaron found
// it cluttered the tab row without pulling its weight day to day. Not a
// full removal: the 'biweekly' report_period value, BIWEEKLY_ANCHOR/
// startOfPeriod() in lib/tasks.js, and PERIOD_NOUN below all stay
// intact, and any already-submitted biweekly report still shows up in
// EodReportsList.jsx under "All" — this is reversible by just adding
// the tab back, not a data-affecting change.
const PERIODS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
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
function getRelevantCompletedTasks(tasks, whoKey, period, offset, existingReport) {
  return existingReport
    ? getCompletedSince(tasks, whoKey, new Date(existingReport.updated_at))
    : getCompletedInPeriod(tasks, whoKey, period, offset)
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
  // Whole periods back from the current one (0 = current, -1 = one
  // period ago, etc.) — lets a bucket that got missed entirely (e.g. it
  // turned September before Aaron submitted August's month report) still
  // get submitted, instead of the form only ever being able to reach
  // whichever bucket "now" falls in. Reset to 0 whenever the period tab
  // itself changes — carrying "one month back" over as "one week back"
  // when switching tabs wouldn't mean anything.
  const [offset, setOffset] = useState(0)
  const [existingReport, setExistingReport] = useState(undefined) // undefined = still loading
  const [body, setBody] = useState('')
  const [hoursInput, setHoursInput] = useState('')
  const [minutesInput, setMinutesInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  function handlePeriodClick(value) {
    setPeriod(value)
    setOffset(0)
  }

  useEffect(() => {
    let cancelled = false
    setExistingReport(undefined)

    fetchOwnEodReport(me.id, period, reportDateForPeriod(period, offset))
      .then((existing) => {
        if (cancelled) return
        setExistingReport(existing)

        if (existing) {
          setBody(buildDraft(getRelevantCompletedTasks(tasks, whoKey, period, offset, existing), period, true))
          if (existing.minutes_logged != null) {
            setHoursInput(String(Math.floor(existing.minutes_logged / 60)))
            setMinutesInput(String(existing.minutes_logged % 60).padStart(2, '0'))
          } else {
            setHoursInput('')
            setMinutesInput('')
          }
        } else {
          setBody(buildDraft(getRelevantCompletedTasks(tasks, whoKey, period, offset, null), period, false))
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
  }, [period, offset, me.id])

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
      const attachments = collectAttachments(getRelevantCompletedTasks(tasks, whoKey, period, offset, existingReport))

      await submitEodReport(period, reportDateForPeriod(period, offset), { bodyChunk, minutesLogged, attachments })

      const hoursText =
        minutesLogged != null ? `${Math.floor(minutesLogged / 60)}h ${minutesLogged % 60}m logged — ` : ''
      // Names the actual bucket for a backdated submission (offset !== 0)
      // — otherwise "submitted month report" arriving in September, about
      // August, reads as if it just happened today.
      const bucketText = offset !== 0 ? ` (${periodBucketLabel(period, offset)})` : ''
      await sendEodReportNotification(
        `${hoursText}${existingReport ? 'updated' : 'submitted'} ${period} report${bucketText}.`,
      )
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
      <ModalCard as="form" modifier="eod-report-modal" onSubmit={handleSubmit}>
        <h2>
          {period[0].toUpperCase() + period.slice(1)} report{offset !== 0 ? ` — ${periodBucketLabel(period, offset)}` : ''}
        </h2>

        <PeriodTabs>
          {PERIODS.map((p) => (
            <PeriodTab key={p.value} active={period === p.value} onClick={() => handlePeriodClick(p.value)}>
              {p.label}
            </PeriodTab>
          ))}
        </PeriodTabs>

        {/* Steps to a past bucket that never got submitted (e.g. it's
            September and Aaron never sent August's month report) —
            capped at offset 0 since a future bucket has no data to
            report on yet. Reaches every past bucket, not just "one back",
            since more than one could realistically get missed in a row. */}
        <div className="flex items-center justify-center gap-1.5 text-sm text-text">
          <IconButton size="weekNav" onClick={() => setOffset((o) => o - 1)} title="Previous" aria-label="Previous period">
            <ChevronLeft size={14} />
          </IconButton>
          <span className="min-w-[110px] text-center font-semibold whitespace-nowrap">{periodBucketLabel(period, offset)}</span>
          <IconButton
            size="weekNav"
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
            disabled={offset >= 0}
            title="Next"
            aria-label="Next period"
          >
            <ChevronRight size={14} />
          </IconButton>
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
          <div className="flex items-center gap-1.5 [&_input[type=number]]:w-16 [&_span]:text-[13px] [&_span]:opacity-70">
            <input
              type="number"
              min="0"
              placeholder="0"
              value={hoursInput}
              onChange={(e) => setHoursInput(e.target.value)}
            />
            <span>hr</span>
            <select className="w-16 rounded-[8px] border border-border bg-bg px-2 py-2.5 text-[15px] text-text-h [font-family:inherit] [font-style:inherit] [font-variant:inherit] [font-weight:inherit] [line-height:inherit]" value={minutesInput} onChange={(e) => setMinutesInput(e.target.value)}>
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

        <SubmissionActions>
          <SubmissionButton onClick={onClose}>Cancel</SubmissionButton>
          <SubmissionButton type="submit" variant="primary" disabled={submitting || loading}>
            {submitting ? 'Sending…' : 'Send to Ada'}
          </SubmissionButton>
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

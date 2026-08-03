import { useState } from 'react'
import { getCompletedInPeriod } from '../lib/tasks'
import { whoKeyForName } from '../lib/whoLabels'
import { createEodReport } from '../lib/eodReports'
import { sendEodReportNotification } from '../lib/manualNotify'
import Modal from './Modal'

const PERIODS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

function buildDraft(completedTasks, period) {
  if (!completedTasks.length) return `Nothing completed this ${period}.`
  return `Completed this ${period}:\n${completedTasks.map((t) => `- ${t.title}`).join('\n')}`
}

// Auto-tallies the selected period's completed tasks as a starting
// draft — Aaron can freely edit it (and has to fill in hours logged)
// before it actually sends, since the tally is a convenience, not the
// final word on what the report should say. Switching Day/Week/Month
// regenerates the draft, since it's now tallying a different range.
export default function EndOfDayReportForm({ tasks, me, onClose }) {
  const whoKey = whoKeyForName(me?.display_name)
  const [period, setPeriod] = useState('day')
  const completed = getCompletedInPeriod(tasks, whoKey, period)

  const [hoursLogged, setHoursLogged] = useState('')
  const [body, setBody] = useState(() => buildDraft(completed, period))
  const [submitting, setSubmitting] = useState(false)

  function handlePeriodChange(next) {
    setPeriod(next)
    setBody(buildDraft(getCompletedInPeriod(tasks, whoKey, next), next))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    try {
      await createEodReport(me.id, { period, hoursLogged: hoursLogged ? Number(hoursLogged) : null, body })
      const taskCount = `${completed.length} task${completed.length === 1 ? '' : 's'} completed this ${period}.`
      const summary = hoursLogged ? `${hoursLogged} hrs logged — ${taskCount}` : taskCount
      await sendEodReportNotification(summary)
      onClose()
    } catch (err) {
      alert(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <form className="submission-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>End of {period} report</h2>

        <div className="period-tabs">
          {PERIODS.map((p) => (
            <button
              type="button"
              key={p.value}
              className={`period-tab${period === p.value ? ' period-tab-active' : ''}`}
              onClick={() => handlePeriodChange(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="submission-field">
          Hours logged
          <input
            type="number"
            step="0.25"
            min="0"
            placeholder="e.g. 7.5"
            value={hoursLogged}
            onChange={(e) => setHoursLogged(e.target.value)}
          />
        </label>

        <label className="submission-field">
          Report
          <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>

        <div className="submission-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="submission-save" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send to Ada'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

import { useEffect, useState } from 'react'
import { createPriorities, fetchLatestPriorities } from '../lib/priorities'
import { createTask } from '../lib/tasks'
import { whoKeyForName } from '../lib/whoLabels'
import { DEFAULT_TIMEZONE, zonedTimeToUtcIso } from '../lib/timezone'
import Modal from './Modal'
import PriorityItemsEditor from './PriorityItemsEditor'

const PERIODS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

function formatDate(iso) {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// 'YYYY-MM-DD' for today in the browser's own local timezone — matches
// what zonedTimeToUtcIso expects as its date argument.
function todayDateString() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Shared planning note, not a personal log — either of you can set
// priorities for the upcoming day/week/month, and each one becomes a real
// task on save (not just a line of text that's easy to forget about).
// "Last set" below is read-only reference only, never pre-filled into the
// editable list — otherwise reopening this and hitting Save would
// recreate a task for every old item, not just anything new.
export default function PrioritiesForm({ me, memberName, onClose }) {
  const [period, setPeriod] = useState('day')
  const [latest, setLatest] = useState(null)
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const defaultWho = whoKeyForName(me.display_name) || 'yours'

  useEffect(() => {
    fetchLatestPriorities()
      .then(setLatest)
      .catch((err) => setError(err.message))
  }, [])

  function handlePeriodChange(next) {
    setPeriod(next)
    setItems([])
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const validItems = items.filter((i) => i.text.trim())
    if (!validItems.length) return
    setSaving(true)
    try {
      const body = validItems.map((i) => i.text.trim()).join('\n')
      const saved = await createPriorities(me.id, period, body)
      setLatest((prev) => ({ ...prev, [period]: saved }))

      // Day priorities land on today (so an unfinished one can go
      // overdue, same as any other daily task); week/month priorities
      // become All Day tasks — no specific date, they just stick around
      // until done.
      const dueDate = period === 'day' ? zonedTimeToUtcIso(todayDateString(), '23:59', DEFAULT_TIMEZONE) : null
      await Promise.all(
        validItems.map((item) =>
          createTask({
            title: item.text.trim(),
            who: item.who,
            due_date: dueDate,
            due_timezone: DEFAULT_TIMEZONE,
            created_by: me.id,
          }),
        ),
      )
      onClose()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  const current = latest?.[period]
  const lastLines = current?.body ? current.body.split('\n').filter((line) => line.trim()) : []

  return (
    <Modal onClose={onClose}>
      <form className="submission-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>Priorities</h2>

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

        {error && <p className="error">{error}</p>}

        {current && (
          <div>
            <p className="eod-report-meta">
              Last set by <strong>{memberName(current.set_by)}</strong> — {formatDate(current.created_at)}
            </p>
            {lastLines.length > 0 && (
              <ul className="priorities-last-set-list">
                {lastLines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <span className="submission-field-label">What are we prioritizing this {period}?</span>
        <PriorityItemsEditor items={items} onChange={setItems} defaultWho={defaultWho} />

        <div className="submission-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="submission-save" disabled={saving || !items.some((i) => i.text.trim())}>
            {saving ? 'Saving…' : 'Save & create tasks'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

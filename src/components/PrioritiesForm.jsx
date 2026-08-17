import { useEffect, useState } from 'react'
import { createPriorities, fetchLatestPriorities } from '../lib/priorities'
import { createTask } from '../lib/tasks'
import { whoKeyForName } from '../lib/whoLabels'
import { detectDefaultTimezone, zonedTimeToUtcIso } from '../lib/timezone'
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
  // Keyed per period so switching the Day/Week/Month tab never discards
  // what you'd already typed under a different one — each tab keeps its
  // own draft until you actually save.
  const [itemsByPeriod, setItemsByPeriod] = useState({ day: [], week: [], month: [] })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const items = itemsByPeriod[period]
  function setItems(next) {
    setItemsByPeriod((prev) => ({ ...prev, [period]: next }))
  }

  const defaultWho = whoKeyForName(me.display_name) || 'yours'

  useEffect(() => {
    fetchLatestPriorities()
      .then(setLatest)
      .catch((err) => setError(err.message))
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    const validItems = items.filter((i) => i.text.trim())
    if (!validItems.length) return
    setSaving(true)
    setError('')
    try {
      const body = validItems.map((i) => i.text.trim()).join('\n')
      const saved = await createPriorities(me.id, period, body)
      setLatest((prev) => ({ ...prev, [period]: saved }))

      // Day priorities land on today (so an unfinished one can go
      // overdue, same as any other daily task); week/month priorities
      // become All Day tasks — no specific date, they just stick around
      // until done. Zoned to whoever's actually saving this, not always
      // Eastern — that mismatch used to push "today 23:59" into tomorrow
      // morning for Aaron (Philippines, ~12-13h ahead of Eastern).
      const zone = detectDefaultTimezone()
      const dueDate = period === 'day' ? zonedTimeToUtcIso(todayDateString(), '23:59', zone) : null
      await Promise.all(
        validItems.map((item) =>
          createTask({
            title: item.text.trim(),
            who: item.who,
            due_date: dueDate,
            due_timezone: zone,
            created_by: me.id,
          }),
        ),
      )
      onClose()
    } catch (err) {
      setError(err.message)
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
              onClick={() => setPeriod(p.value)}
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

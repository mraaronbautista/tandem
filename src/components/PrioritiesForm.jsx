import { useEffect, useState } from 'react'
import { createPriorities, fetchLatestPriorities } from '../lib/priorities'
import Modal from './Modal'

const PERIODS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

function formatDate(iso) {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Shared planning note, not a personal log — either of you can set or
// update priorities for the upcoming day/week/month. Opens showing
// whatever's currently set for the selected period (if anything),
// editable; saving adds a new entry rather than overwriting the old one,
// so there's a free history of how priorities shifted over time.
export default function PrioritiesForm({ me, memberName, onClose }) {
  const [period, setPeriod] = useState('day')
  const [latest, setLatest] = useState(null)
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchLatestPriorities()
      .then((map) => {
        setLatest(map)
        setBody(map.day?.body || '')
      })
      .catch((err) => setError(err.message))
  }, [])

  function handlePeriodChange(next) {
    setPeriod(next)
    setBody(latest?.[next]?.body || '')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!body.trim()) return
    setSaving(true)
    try {
      const saved = await createPriorities(me.id, period, body)
      setLatest((prev) => ({ ...prev, [period]: saved }))
      onClose()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  const current = latest?.[period]

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
          <p className="eod-report-meta">
            Last set by <strong>{memberName(current.set_by)}</strong> — {formatDate(current.created_at)}
          </p>
        )}

        <label className="submission-field">
          What are we prioritizing this {period}?
          <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>

        <div className="submission-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="submission-save" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

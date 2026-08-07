import { useState } from 'react'
import { saveSavingsGoal } from '../lib/rentals'
import Modal from './Modal'

function currentMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function RentalSavingsGoalForm({ company, goal, onClose, onSaved }) {
  const [targetAmount, setTargetAmount] = useState(goal?.target_amount ?? '')
  const [trackingStart, setTrackingStart] = useState(goal?.tracking_start?.slice(0, 7) || currentMonthStr())
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!targetAmount || !trackingStart) return
    setSaving(true)
    try {
      const saved = await saveSavingsGoal(company, {
        target_amount: Number(targetAmount),
        tracking_start: `${trackingStart}-01`,
      })
      onSaved(saved)
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <form className="submission-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>Savings goal</h2>

        <label>
          Target amount
          <input
            type="number"
            required
            min="0"
            step="1"
            placeholder="e.g. 50000"
            value={targetAmount}
            onChange={(e) => setTargetAmount(e.target.value)}
          />
        </label>

        <label>
          Start counting from
          <input type="month" required value={trackingStart} onChange={(e) => setTrackingStart(e.target.value)} />
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

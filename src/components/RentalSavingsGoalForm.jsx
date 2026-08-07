import { useState } from 'react'
import { createSavingsGoal, updateSavingsGoal, deleteSavingsGoal } from '../lib/rentals'
import Modal from './Modal'

function currentMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function RentalSavingsGoalForm({ company, goal, onClose, onSaved, onDeleted }) {
  const [label, setLabel] = useState(goal?.label || '')
  const [targetAmount, setTargetAmount] = useState(goal?.target_amount ?? '')
  const [trackingStart, setTrackingStart] = useState(goal?.tracking_start?.slice(0, 7) || currentMonthStr())
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!label.trim() || !targetAmount || !trackingStart) return
    setSaving(true)
    try {
      const payload = {
        label: label.trim(),
        target_amount: Number(targetAmount),
        tracking_start: `${trackingStart}-01`,
      }
      const saved = goal ? await updateSavingsGoal(goal.id, payload) : await createSavingsGoal(company, payload)
      onSaved(saved)
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete the "${goal.label}" goal? This can't be undone.`)) return
    setDeleting(true)
    try {
      await deleteSavingsGoal(goal.id)
      onDeleted()
    } catch (err) {
      alert(err.message)
      setDeleting(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <form className="submission-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>{goal ? 'Edit savings goal' : 'New savings goal'}</h2>

        <label>
          Label
          <input
            required
            autoFocus
            placeholder="e.g. Short-term goal"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>

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
          {goal && (
            <button type="button" className="rental-delete-booking" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          )}
          <button type="submit" className="submission-save" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

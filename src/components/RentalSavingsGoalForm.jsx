import { useState } from 'react'
import { createSavingsGoal, updateSavingsGoal, deleteSavingsGoal } from '../lib/rentals'
import Modal from './Modal'
import ModalCard from './ModalCard'

// Matches .submission-field input[type='text'/'number'] (App.css:1366-1376)
// — this form's fields were bare <label><input/></label> pairs with
// no styling class of their own, rendering as unstyled native browser
// chrome (Arial, black text, inset border) instead of the app's actual
// input look used everywhere else. Applying that existing recipe here
// rather than preserving the native look, per explicit direction — this
// is a real visual fix using a convention already established elsewhere
// in the app, not a new design. w-full is added explicitly (the original
// rule relies on the parent label's flex-stretch default instead) since
// that's a more robust guarantee of the same full-width result regardless
// of ambient flex behavior.
const FIELD_INPUT_CLASS =
  'w-full rounded-[8px] border border-border bg-bg px-3 py-[10px] text-[15px] text-text-h [font-family:inherit] [line-height:inherit]'

export default function RentalSavingsGoalForm({ company, goal, onClose, onSaved, onDeleted }) {
  const [label, setLabel] = useState(goal?.label || '')
  const [targetAmount, setTargetAmount] = useState(goal?.target_amount ?? '')
  const [savedAmount, setSavedAmount] = useState(goal?.saved_amount ?? 0)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!label.trim() || !(Number(targetAmount) > 0) || savedAmount === '') return
    setSaving(true)
    setError('')
    try {
      const payload = {
        label: label.trim(),
        target_amount: Number(targetAmount),
        saved_amount: Number(savedAmount),
      }
      const saved = goal ? await updateSavingsGoal(goal.id, payload) : await createSavingsGoal(company, payload)
      onSaved(saved)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete the "${goal.label}" goal? This can't be undone.`)) return
    setDeleting(true)
    setError('')
    try {
      await deleteSavingsGoal(goal.id)
      onDeleted()
    } catch (err) {
      setError(err.message)
      setDeleting(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <ModalCard as="form" onSubmit={handleSubmit}>
        <h2>{goal ? 'Edit savings goal' : 'New savings goal'}</h2>

        {error && <p className="error">{error}</p>}

        <label>
          Label
          <input
            required
            autoFocus
            placeholder="e.g. Short-term goal"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
        </label>

        <label>
          Target amount
          <input
            type="number"
            required
            min="1"
            step="1"
            placeholder="e.g. 50000"
            value={targetAmount}
            onChange={(e) => setTargetAmount(e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
        </label>

        <label>
          Saved so far
          <input
            type="number"
            required
            min="0"
            step="1"
            value={savedAmount}
            onChange={(e) => setSavedAmount(e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
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
      </ModalCard>
    </Modal>
  )
}

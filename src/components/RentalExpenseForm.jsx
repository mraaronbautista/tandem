import { useState } from 'react'
import { createRentalExpense, updateRentalExpense, deleteRentalExpense } from '../lib/rentals'
import Modal from './Modal'
import ModalCard from './ModalCard'

// Matches .submission-field input[type='text'/'number'] (App.css:1366-1376)
// — same fix as RentalSavingsGoalForm.jsx: this form's fields were bare
// <label><input/></label> pairs rendering as unstyled native browser
// chrome instead of the app's actual input look. w-full is explicit here
// (the original relies on the parent label's flex-stretch instead) as a
// more robust guarantee of the same full-width result.
const FIELD_INPUT_CLASS =
  'w-full rounded-[8px] border border-border bg-bg px-3 py-[10px] text-[15px] text-text-h [font-family:inherit] [line-height:inherit]'

export default function RentalExpenseForm({ company, expense, onClose, onSaved, onDeleted }) {
  const [label, setLabel] = useState(expense?.label || '')
  const [amount, setAmount] = useState(expense?.amount ?? '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!label.trim() || amount === '') return
    setSaving(true)
    setError('')
    try {
      const payload = { label: label.trim(), amount: Number(amount) }
      const saved = expense
        ? await updateRentalExpense(expense.id, payload)
        : await createRentalExpense(company, payload)
      onSaved(saved)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete the "${expense.label}" overhead item? This can't be undone.`)) return
    setDeleting(true)
    setError('')
    try {
      await deleteRentalExpense(expense.id)
      onDeleted()
    } catch (err) {
      setError(err.message)
      setDeleting(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <ModalCard as="form" onSubmit={handleSubmit}>
        <h2>{expense ? 'Edit overhead item' : 'New overhead item'}</h2>

        {error && <p className="error">{error}</p>}

        <label>
          Label
          <input
            required
            autoFocus
            placeholder="e.g. Mortgage, Utilities"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
        </label>

        <label>
          Monthly amount
          <input
            type="number"
            required
            min="0"
            step="1"
            placeholder="e.g. 1200"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
        </label>

        <div className="submission-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          {expense && (
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

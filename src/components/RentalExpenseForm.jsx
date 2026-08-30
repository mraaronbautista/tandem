import { useState } from 'react'
import { createRentalExpense, updateRentalExpense, deleteRentalExpense } from '../lib/rentals'
import Modal from './Modal'
import ModalCard from './ModalCard'

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

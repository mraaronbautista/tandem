import { useState } from 'react'
import { createSavingsAdjustment } from '../lib/rentals'
import Modal from './Modal'

export default function RentalSavingsAdjustmentForm({ company, createdBy, onClose, onCreated }) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!amount || !note.trim()) return
    setSaving(true)
    try {
      const adjustment = await createSavingsAdjustment(company, {
        amount: Number(amount),
        note: note.trim(),
        created_by: createdBy,
      })
      onCreated(adjustment)
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <form className="submission-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>Adjust savings</h2>

        <label>
          Amount
          <input
            type="number"
            required
            step="1"
            placeholder="e.g. 5000, or -500 to subtract"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>

        <label>
          Reason
          <input
            required
            autoFocus
            placeholder="e.g. Existing savings before tracking started"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <div className="submission-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="submission-save" disabled={saving}>
            {saving ? 'Saving…' : 'Add adjustment'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

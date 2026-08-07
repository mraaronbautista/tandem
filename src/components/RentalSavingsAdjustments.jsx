import { useState } from 'react'
import { deleteSavingsAdjustment } from '../lib/rentals'
import RentalSavingsAdjustmentForm from './RentalSavingsAdjustmentForm'

function money(n) {
  const sign = n < 0 ? '-' : '+'
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString()}`
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

// Corrections to the auto-computed running total, each with a required
// reason — a pre-existing balance from before tracking started, or a
// month where the computed surplus didn't actually get saved. Kept as a
// visible, deletable list rather than a single editable number so the
// "why" behind each correction stays on record.
export default function RentalSavingsAdjustments({ company, adjustments, createdBy, onChanged }) {
  const [formOpen, setFormOpen] = useState(false)

  async function handleDelete(adjustment) {
    if (!window.confirm(`Remove this adjustment (${money(adjustment.amount)} — ${adjustment.note})?`)) return
    await deleteSavingsAdjustment(adjustment.id)
    onChanged()
  }

  return (
    <div className="rental-adjustments">
      <div className="rental-savings-header">
        <span>Manual adjustments</span>
        <button type="button" className="rental-savings-edit" onClick={() => setFormOpen(true)}>
          + Adjust
        </button>
      </div>

      {adjustments.length === 0 && <p className="task-notes-empty">None yet.</p>}

      {adjustments.map((a) => (
        <div key={a.id} className="rental-adjustment-row">
          <span>
            <span className={a.amount >= 0 ? 'rental-unit-badge-billed' : 'rental-unit-badge-vacant'}>
              {money(a.amount)}
            </span>{' '}
            — {a.note}
            <span className="rental-adjustment-date"> · {formatDate(a.created_at)}</span>
          </span>
          <button
            type="button"
            className="rental-adjustment-delete"
            onClick={() => handleDelete(a)}
            title="Remove adjustment"
          >
            ×
          </button>
        </div>
      ))}

      {formOpen && (
        <RentalSavingsAdjustmentForm
          company={company}
          createdBy={createdBy}
          onClose={() => setFormOpen(false)}
          onCreated={() => {
            setFormOpen(false)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

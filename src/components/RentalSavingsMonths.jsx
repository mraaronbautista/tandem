import { useState } from 'react'
import { potentialSavingsForMonth, monthsFrom, monthRangeStrings, approveSavingsMonth } from '../lib/rentals'

function money(n) {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString()}`
}

// Each month needs a deliberate reconciliation step before it counts
// toward a goal — the computed "potential" figure is a suggestion, not
// an assumption, since a real surplus can get spent on something else
// before it's actually saved. Approving takes the potential as-is;
// editing lets the actual figure differ from it (also how a pre-existing
// balance gets folded in, as an early month's edited "actual").
export default function RentalSavingsMonths({
  company,
  earliestStart,
  allBookings,
  properties,
  expenses,
  monthRecords,
  createdBy,
  onChanged,
}) {
  const [editingKey, setEditingKey] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)

  if (!earliestStart) return null

  const recordByMonth = new Map(monthRecords.map((r) => [r.month, r]))
  const months = monthsFrom(earliestStart).slice().reverse()

  async function handleSave(month, key, amount) {
    setSaving(true)
    try {
      await approveSavingsMonth(company, key, amount, createdBy)
      setEditingKey(null)
      onChanged()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rental-savings-months">
      <div className="rental-savings-header">
        <span>Monthly reconciliation</span>
      </div>

      {months.map((month) => {
        const key = monthRangeStrings(month).start
        const rec = recordByMonth.get(key)
        const potential = potentialSavingsForMonth(allBookings, properties, expenses, month)
        const label = month.toLocaleDateString([], { month: 'short', year: 'numeric' })
        const isEditing = editingKey === key

        return (
          <div key={key} className="rental-savings-month-row">
            <span className="rental-savings-month-label">{label}</span>

            {isEditing ? (
              <span className="rental-savings-month-edit">
                <input
                  type="number"
                  step="1"
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                />
                <button
                  type="button"
                  className="rental-savings-edit"
                  onClick={() => handleSave(month, key, Number(editValue))}
                  disabled={saving || editValue === ''}
                >
                  Save
                </button>
                <button type="button" className="rental-savings-edit" onClick={() => setEditingKey(null)}>
                  Cancel
                </button>
              </span>
            ) : rec?.actual_amount != null ? (
              <span className="rental-savings-month-actions">
                <span className="rental-savings-month-approved">Saved {money(rec.actual_amount)}</span>
                <button
                  type="button"
                  className="rental-savings-edit"
                  onClick={() => {
                    setEditingKey(key)
                    setEditValue(String(rec.actual_amount))
                  }}
                >
                  Edit
                </button>
              </span>
            ) : (
              <span className="rental-savings-month-actions">
                <span className="rental-savings-month-potential">Potential {money(potential)}</span>
                <button
                  type="button"
                  className="rental-savings-edit"
                  onClick={() => handleSave(month, key, potential)}
                  disabled={saving}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="rental-savings-edit"
                  onClick={() => {
                    setEditingKey(key)
                    setEditValue(String(potential))
                  }}
                >
                  Edit
                </button>
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

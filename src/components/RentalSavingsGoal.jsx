import { useState } from 'react'
import RentalButton from './RentalButton'
import RentalSavingsGoalForm from './RentalSavingsGoalForm'

function money(n) {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString()}`
}

// The purpose of tracking this business's financials at all: accumulating
// toward a down payment on a new property, not just knowing this month's
// number. Multiple milestones (e.g. a $20k short-term goal, then $75k for
// the actual down payment) can track the same growing pool of savings —
// saved_amount is a plain manually-maintained figure edited directly in
// the goal's own edit form, not derived from bookings.
export default function RentalSavingsGoal({ company, goals, onGoalsChanged }) {
  const [formOpen, setFormOpen] = useState(false)
  const [editingGoal, setEditingGoal] = useState(null)

  function openNew() {
    setEditingGoal(null)
    setFormOpen(true)
  }

  function openEdit(goal) {
    setEditingGoal(goal)
    setFormOpen(true)
  }

  return (
    <div className="rental-savings-list">
      {goals.map((goal) => {
        const saved = Number(goal.saved_amount)
        const pct = Math.max(0, Math.min(100, (saved / Number(goal.target_amount)) * 100))
        return (
          <div key={goal.id} className="rental-savings">
            <div className="rental-savings-header">
              <span>{goal.label}</span>
              <button type="button" className="rental-savings-edit" onClick={() => openEdit(goal)}>
                Edit
              </button>
            </div>
            <div className="rental-savings-bar">
              <div className="rental-savings-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <p className="rental-savings-amounts">
              {money(saved)} / {money(goal.target_amount)} ({Math.round(pct)}%)
            </p>
          </div>
        )
      })}

      <RentalButton onClick={openNew}>+ Add goal</RentalButton>

      {formOpen && (
        <RentalSavingsGoalForm
          company={company}
          goal={editingGoal}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false)
            onGoalsChanged()
          }}
          onDeleted={() => {
            setFormOpen(false)
            onGoalsChanged()
          }}
        />
      )}
    </div>
  )
}

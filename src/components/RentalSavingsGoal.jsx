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
    <div className="flex flex-col gap-2.5">
      {goals.map((goal) => {
        const saved = Number(goal.saved_amount)
        const pct = Math.max(0, Math.min(100, (saved / Number(goal.target_amount)) * 100))
        return (
          <div key={goal.id} className="rounded-md border border-border px-3.5 py-3">
            <div className="mb-2 flex items-center justify-between text-[13px] font-semibold text-text-h">
              <span>{goal.label}</span>
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-accent"
                onClick={() => openEdit(goal)}
              >
                Edit
              </button>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-pill-bg">
              <div className="h-full rounded-full bg-accent transition-[width] duration-200 ease-[ease]" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 text-right text-[13px] opacity-80">
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

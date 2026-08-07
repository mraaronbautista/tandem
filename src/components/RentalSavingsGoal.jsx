import { useState } from 'react'
import { cumulativeSavings } from '../lib/rentals'
import RentalSavingsGoalForm from './RentalSavingsGoalForm'

function money(n) {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString()}`
}

// The purpose of tracking this business's financials at all: accumulating
// toward a down payment on a new property, not just knowing this month's
// number. Net cash flow is auto-summed month by month from a chosen start
// date — see cumulativeSavings() — rather than a manually-kept ledger, so
// there's nothing to remember to log.
export default function RentalSavingsGoal({ company, goal, allBookings, properties, expenses, onSaved }) {
  const [formOpen, setFormOpen] = useState(false)

  const saved = goal ? cumulativeSavings(allBookings, properties, expenses, goal.tracking_start) : 0
  const pct = goal ? Math.max(0, Math.min(100, (saved / Number(goal.target_amount)) * 100)) : 0

  return (
    <div className="rental-savings">
      {goal ? (
        <>
          <div className="rental-savings-header">
            <span>Savings toward new property</span>
            <button type="button" className="rental-savings-edit" onClick={() => setFormOpen(true)}>
              Edit
            </button>
          </div>
          <div className="rental-savings-bar">
            <div className="rental-savings-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="rental-savings-amounts">
            {money(saved)} / {money(goal.target_amount)} ({Math.round(pct)}%)
          </p>
        </>
      ) : (
        <button type="button" className="rental-add-booking" onClick={() => setFormOpen(true)}>
          + Set savings goal
        </button>
      )}

      {formOpen && (
        <RentalSavingsGoalForm
          company={company}
          goal={goal}
          onClose={() => setFormOpen(false)}
          onSaved={(g) => {
            setFormOpen(false)
            onSaved(g)
          }}
        />
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import {
  fetchRentalProperties,
  fetchRentalExpenses,
  fetchRentalBookings,
  fetchSavingsGoals,
  monthRangeStrings,
} from '../lib/rentals'
import RentalCalendar from './RentalCalendar'
import RentalFinancials from './RentalFinancials'

const COMPANY = 'awa'
const COMPANY_LABEL = 'Awa Rentalz'

// Persistent tab content (bottom tab bar on mobile, sidebar nav on wide
// screens — see TaskBoard.jsx), not a modal — no onClose, nothing to
// dismiss, you just switch tabs.
export default function RentalsView({ me }) {
  const [view, setView] = useState('calendar')
  const [monthDate, setMonthDate] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return d
  })
  const [properties, setProperties] = useState(null)
  const [expenses, setExpenses] = useState([])
  const [bookings, setBookings] = useState([])
  const [goals, setGoals] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    fetchRentalProperties(COMPANY)
      .then(setProperties)
      .catch((err) => setError(err.message))
    fetchRentalExpenses(COMPANY)
      .then(setExpenses)
      .catch((err) => setError(err.message))
    reloadGoals()
  }, [])

  function reloadGoals() {
    fetchSavingsGoals(COMPANY)
      .then(setGoals)
      .catch((err) => setError(err.message))
  }

  function reloadBookings() {
    const { start, end } = monthRangeStrings(monthDate)
    fetchRentalBookings(COMPANY, start, end)
      .then(setBookings)
      .catch((err) => setError(err.message))
  }

  useEffect(reloadBookings, [monthDate])

  function shiftMonth(delta) {
    setMonthDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1))
  }

  const monthLabel = monthDate.toLocaleDateString([], { month: 'long', year: 'numeric' })

  return (
    <div className="tab-panel">
      <h2>{COMPANY_LABEL}</h2>

      <div className="period-tabs">
        <button
          type="button"
          className={`period-tab${view === 'calendar' ? ' period-tab-active' : ''}`}
          onClick={() => setView('calendar')}
        >
          Calendar
        </button>
        <button
          type="button"
          className={`period-tab${view === 'financials' ? ' period-tab-active' : ''}`}
          onClick={() => setView('financials')}
        >
          Financials
        </button>
      </div>

      <div className="rental-calendar-nav">
        <button type="button" className="icon-button" onClick={() => shiftMonth(-1)} title="Previous month">
          ‹
        </button>
        <span className="rental-month-label">{monthLabel}</span>
        <button type="button" className="icon-button" onClick={() => shiftMonth(1)} title="Next month">
          ›
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {!error && !properties && <p className="loading">Loading…</p>}

      {properties &&
        (view === 'calendar' ? (
          <RentalCalendar
            properties={properties}
            bookings={bookings}
            monthDate={monthDate}
            createdBy={me?.id}
            onBookingsChanged={reloadBookings}
          />
        ) : (
          <RentalFinancials
            company={COMPANY}
            properties={properties}
            bookings={bookings}
            expenses={expenses}
            monthDate={monthDate}
            goals={goals}
            onGoalsChanged={reloadGoals}
          />
        ))}
    </div>
  )
}

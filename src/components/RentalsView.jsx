import { useEffect, useState } from 'react'
import { fetchRentalProperties, fetchRentalExpenses, fetchRentalBookings } from '../lib/rentals'
import Modal from './Modal'
import RentalCalendar from './RentalCalendar'
import RentalFinancials from './RentalFinancials'

const COMPANY = 'awa'
const COMPANY_LABEL = 'Awa Rentalz'

function pad(n) {
  return String(n).padStart(2, '0')
}

function monthRange(monthDate) {
  const year = monthDate.getFullYear()
  const month = monthDate.getMonth()
  const start = `${year}-${pad(month + 1)}-01`
  const nextMonth = new Date(year, month + 1, 1)
  const end = `${nextMonth.getFullYear()}-${pad(nextMonth.getMonth() + 1)}-01`
  return { start, end }
}

export default function RentalsView({ me, onClose }) {
  const [view, setView] = useState('calendar')
  const [monthDate, setMonthDate] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return d
  })
  const [properties, setProperties] = useState(null)
  const [expenses, setExpenses] = useState([])
  const [bookings, setBookings] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    fetchRentalProperties(COMPANY)
      .then(setProperties)
      .catch((err) => setError(err.message))
    fetchRentalExpenses(COMPANY)
      .then(setExpenses)
      .catch((err) => setError(err.message))
  }, [])

  function reloadBookings() {
    const { start, end } = monthRange(monthDate)
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
    <Modal onClose={onClose}>
      <div className="submission-modal rental-modal" onClick={(e) => e.stopPropagation()}>
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
            <RentalFinancials properties={properties} bookings={bookings} expenses={expenses} />
          ))}

        <div className="submission-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}

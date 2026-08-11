import { useEffect, useRef, useState } from 'react'
import {
  fetchRentalProperties,
  fetchRentalExpenses,
  fetchRentalBookings,
  fetchUpcomingRentalBookings,
  fetchSavingsGoals,
  monthRangeStrings,
  unitOccupancyStatus,
  formatDateStr,
} from '../lib/rentals'
import { useMediaQuery } from '../lib/useMediaQuery'
import RentalCalendar from './RentalCalendar'
import RentalFinancials from './RentalFinancials'
import RentalOverview from './RentalOverview'

const COMPANY = 'awa'

// Persistent tab content (bottom tab bar on mobile, sidebar nav on wide
// screens — see TaskBoard.jsx), not a modal — no onClose, nothing to
// dismiss, you just switch tabs. The page title ("Awa Rentalz") lives in
// TaskBoard.jsx's shared header now, not here — see PAGE_LABELS.
//
// Two genuinely different layouts, not one repositioned via CSS: mobile
// keeps the original Calendar/Financials/Overview tabs (one panel at a
// time), desktop is an always-mounted 2-column dashboard (calendar +
// unit list stacked in the main column, financials in its own column,
// all visible together, no tabs) — see useMediaQuery.js for why that
// split happens in JS here instead of CSS like everywhere else in the
// app.
export default function RentalsView({ me }) {
  const isDesktop = useMediaQuery('(min-width: 900px)')
  const [view, setView] = useState('calendar')
  const [monthDate, setMonthDate] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return d
  })
  const [properties, setProperties] = useState(null)
  const [expenses, setExpenses] = useState([])
  const [bookings, setBookings] = useState([])
  const [upcomingBookings, setUpcomingBookings] = useState([])
  const [goals, setGoals] = useState([])
  const [error, setError] = useState('')
  // Lifted up from RentalCalendar.jsx so the desktop dashboard's Overview
  // list and combined nav row can drive the same selection it does.
  const [selectedUnitId, setSelectedUnitId] = useState('')
  // Lets the "+ Add booking" button that lives in the combined nav row
  // (beside the unit name, not in RentalCalendar's own toolbar on the
  // desktop dashboard) trigger the form RentalCalendar still owns.
  const calendarRef = useRef(null)

  useEffect(() => {
    fetchRentalProperties(COMPANY)
      .then(setProperties)
      .catch((err) => setError(err.message))
    fetchRentalExpenses(COMPANY)
      .then(setExpenses)
      .catch((err) => setError(err.message))
    reloadGoals()
    reloadUpcoming()
  }, [])

  // Defaults to the first unit once properties actually load — can't be
  // the useState initializer above since properties starts out null.
  useEffect(() => {
    if (properties?.length && !selectedUnitId) setSelectedUnitId(properties[0].id)
  }, [properties, selectedUnitId])

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

  // Separate from the month-scoped `bookings` above — the Overview tab
  // needs a unit's real occupied-through date even when it runs past the
  // currently browsed month.
  function reloadUpcoming() {
    fetchUpcomingRentalBookings(COMPANY)
      .then(setUpcomingBookings)
      .catch((err) => setError(err.message))
  }

  function handleBookingsChanged() {
    reloadBookings()
    reloadUpcoming()
  }

  useEffect(reloadBookings, [monthDate])

  function shiftMonth(delta) {
    setMonthDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1))
  }

  // Cycles the desktop dashboard's unit nav through `properties` by
  // index, wrapping at both ends — same "no visible bounds" feel as
  // shiftMonth above.
  function shiftUnit(delta) {
    if (!properties?.length) return
    const idx = properties.findIndex((p) => p.id === selectedUnitId)
    const nextIdx = (idx + delta + properties.length) % properties.length
    setSelectedUnitId(properties[nextIdx].id)
  }

  const monthLabel = monthDate.toLocaleDateString([], { month: 'long', year: 'numeric' })
  const selectedUnit = properties?.find((p) => p.id === selectedUnitId)

  if (error) {
    return (
      <div className="tab-panel">
        <p className="error">{error}</p>
      </div>
    )
  }

  if (!properties) {
    return (
      <div className="tab-panel">
        <p className="loading">Loading…</p>
      </div>
    )
  }

  if (isDesktop) {
    return (
      <div className="rentals-dashboard">
        <div className="rentals-main">
          <div className="rentals-combined-nav">
            <div className="month-nav-row">
              <button type="button" className="icon-button" onClick={() => shiftMonth(-1)} title="Previous month">
                ‹
              </button>
              <span className="month-nav-label">{monthLabel}</span>
              <button type="button" className="icon-button" onClick={() => shiftMonth(1)} title="Next month">
                ›
              </button>
            </div>
            <div className="month-nav-row">
              <button type="button" className="icon-button" onClick={() => shiftUnit(-1)} title="Previous unit">
                ‹
              </button>
              <span className="month-nav-label">{selectedUnit?.unit_name}</span>
              <button type="button" className="icon-button" onClick={() => shiftUnit(1)} title="Next unit">
                ›
              </button>
              <button
                type="button"
                className="rental-add-booking"
                onClick={() => calendarRef.current?.openAddBooking()}
              >
                + Add booking
              </button>
            </div>
          </div>

          {/* A subtle per-unit status list renders in place of the
              (hidden) unit-tabs toolbar row — unit switching already
              happens via the ‹ Unit › nav above, so this is read-only
              status text, not another set of buttons. The bold $/mo unit
              header and the toolbar's own "+ Add booking" are both
              suppressed here too — this list already shows each unit's
              price, and the button moved up beside the unit nav. */}
          <RentalCalendar
            ref={calendarRef}
            properties={properties}
            bookings={bookings}
            monthDate={monthDate}
            createdBy={me?.id}
            onBookingsChanged={handleBookingsChanged}
            selectedUnitId={selectedUnitId}
            onSelectUnit={setSelectedUnitId}
            showUnitTabs={false}
            showAddBooking={false}
            showUnitHeader={false}
            unitTabsReplacement={
              <p className="rentals-units-summary">
                {properties.map((p) => {
                  const status = unitOccupancyStatus(upcomingBookings, p.id)
                  const statusText = status.occupied
                    ? `Occupied through ${formatDateStr(status.through)} — ${status.guest}`
                    : status.next
                      ? `Vacant — next ${status.next.pending ? 'request' : 'guest'} ${formatDateStr(status.next.checkIn)}`
                      : 'Vacant'
                  return (
                    <span key={p.id} className="rentals-units-summary-item">
                      <span className="rental-unit-dot" style={{ background: p.color }} />
                      {p.unit_name} ${Number(p.monthly_rent).toLocaleString()}/mo: {statusText}
                    </span>
                  )
                })}
              </p>
            }
          />
        </div>

        <div className="rentals-financials-col">
          <h3 className="task-section-heading">Financials</h3>
          <RentalFinancials
            company={COMPANY}
            properties={properties}
            bookings={bookings}
            expenses={expenses}
            monthDate={monthDate}
            goals={goals}
            onGoalsChanged={reloadGoals}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="tab-panel">
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
        <button
          type="button"
          className={`period-tab${view === 'overview' ? ' period-tab-active' : ''}`}
          onClick={() => setView('overview')}
        >
          Overview
        </button>
      </div>

      {view !== 'overview' && (
        <div className="month-nav-row">
          <button type="button" className="icon-button" onClick={() => shiftMonth(-1)} title="Previous month">
            ‹
          </button>
          <span className="month-nav-label">{monthLabel}</span>
          <button type="button" className="icon-button" onClick={() => shiftMonth(1)} title="Next month">
            ›
          </button>
        </div>
      )}

      {view === 'calendar' && (
        <RentalCalendar
          properties={properties}
          bookings={bookings}
          monthDate={monthDate}
          createdBy={me?.id}
          onBookingsChanged={handleBookingsChanged}
          selectedUnitId={selectedUnitId}
          onSelectUnit={setSelectedUnitId}
        />
      )}

      {view === 'financials' && (
        <RentalFinancials
          company={COMPANY}
          properties={properties}
          bookings={bookings}
          expenses={expenses}
          monthDate={monthDate}
          goals={goals}
          onGoalsChanged={reloadGoals}
        />
      )}

      {view === 'overview' && (
        <RentalOverview
          properties={properties}
          bookings={upcomingBookings}
          selectedUnitId={selectedUnitId}
          onSelectUnit={setSelectedUnitId}
        />
      )}
    </div>
  )
}

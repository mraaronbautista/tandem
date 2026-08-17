import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import {
  fetchRentalProperties,
  fetchRentalExpenses,
  fetchRentalBookings,
  fetchUpcomingRentalBookings,
  fetchSavingsGoals,
  monthRangeStrings,
} from '../lib/rentals'
import { useMediaQuery } from '../lib/useMediaQuery'
import RentalCalendar from './RentalCalendar'
import RentalFinancials from './RentalFinancials'
import RentalOverview from './RentalOverview'
import RentalPropertyForm from './RentalPropertyForm'

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
  // Property add/edit lives at this level (not inside RentalCalendar,
  // which only ever deals with bookings) — properties/COMPANY are
  // already owned here, and both layouts need to reach it.
  const [propertyFormOpen, setPropertyFormOpen] = useState(false)
  const [editingProperty, setEditingProperty] = useState(null)

  function openNewProperty() {
    setEditingProperty(null)
    setPropertyFormOpen(true)
  }

  function openEditProperty(property) {
    setEditingProperty(property)
    setPropertyFormOpen(true)
  }

  function closePropertyForm() {
    setPropertyFormOpen(false)
    setEditingProperty(null)
  }

  useEffect(() => {
    reloadProperties()
    reloadExpenses()
    reloadGoals()
    reloadUpcoming()
  }, [])

  // Rentals didn't get the same live-update treatment tasks/members/Cork
  // Board already have (see TaskBoard.jsx/CorkBoardView.jsx) — without
  // this, Ada adding a booking from her phone wouldn't show up for Aaron
  // until something else forced a refetch (e.g. changing months). One
  // channel covers every rental_* table this view reads; re-subscribed
  // on monthDate change so the bookings handler always refetches the
  // month actually being browsed, not whatever it was on mount.
  useEffect(() => {
    const channel = supabase
      .channel('rentals-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_properties' }, reloadProperties)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_bookings' }, handleBookingsChanged)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_expenses' }, reloadExpenses)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_savings_goal' }, reloadGoals)
      .subscribe()

    return () => supabase.removeChannel(channel)
    // Deliberately not listing reload*/handleBookingsChanged — they're
    // plain functions redefined every render, not memoized, so listing
    // them would resubscribe this channel on every render instead of
    // just on the month changes that actually require a fresh range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthDate])

  function reloadProperties() {
    fetchRentalProperties(COMPANY)
      .then(setProperties)
      .catch((err) => setError(err.message))
  }

  function reloadExpenses() {
    fetchRentalExpenses(COMPANY)
      .then(setExpenses)
      .catch((err) => setError(err.message))
  }

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
              <button
                type="button"
                className="icon-button"
                onClick={() => shiftMonth(-1)}
                title="Previous month"
                aria-label="Previous month"
              >
                ‹
              </button>
              <span className="month-nav-label">{monthLabel}</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => shiftMonth(1)}
                title="Next month"
                aria-label="Next month"
              >
                ›
              </button>
            </div>
            <div className="month-nav-row">
              <span className="month-nav-label">{selectedUnit?.unit_name}</span>
              <button
                type="button"
                className="rental-add-booking"
                onClick={() => calendarRef.current?.openAddBooking()}
              >
                + Add booking
              </button>
              <button
                type="button"
                className="rental-add-booking"
                onClick={() => openEditProperty(selectedUnit)}
                disabled={!selectedUnit}
              >
                Edit unit
              </button>
              <button type="button" className="rental-add-booking" onClick={openNewProperty}>
                + Add unit
              </button>
            </div>
          </div>

          {/* The per-unit status list renders in place of the (hidden)
              unit-tabs toolbar row and, same as mobile's Overview tab,
              doubles as the way to switch units here — it's the only unit
              switcher in the toolbar now that the plain unit-tabs are
              hidden (the ‹ Unit › nav above is the other one). The bold
              $/mo unit header and the toolbar's own "+ Add booking" are
              both suppressed here too — this list already shows each
              unit's price, and the button moved up beside the unit nav. */}
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
              <RentalOverview
                properties={properties}
                bookings={upcomingBookings}
                selectedUnitId={selectedUnitId}
                onSelectUnit={setSelectedUnitId}
              />
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
            onExpensesChanged={reloadExpenses}
          />
        </div>

        {propertyFormOpen && (
          <RentalPropertyForm
            company={COMPANY}
            property={editingProperty}
            onClose={closePropertyForm}
            onSaved={() => {
              closePropertyForm()
              reloadProperties()
            }}
            onArchived={() => {
              closePropertyForm()
              reloadProperties()
            }}
          />
        )}
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
          <button
            type="button"
            className="icon-button"
            onClick={() => shiftMonth(-1)}
            title="Previous month"
            aria-label="Previous month"
          >
            ‹
          </button>
          <span className="month-nav-label">{monthLabel}</span>
          <button
            type="button"
            className="icon-button"
            onClick={() => shiftMonth(1)}
            title="Next month"
            aria-label="Next month"
          >
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
          onExpensesChanged={reloadExpenses}
        />
      )}

      {view === 'overview' && (
        <>
          <RentalOverview
            properties={properties}
            bookings={upcomingBookings}
            selectedUnitId={selectedUnitId}
            onSelectUnit={setSelectedUnitId}
            onEditUnit={openEditProperty}
          />
          <button type="button" className="rental-add-booking" onClick={openNewProperty}>
            + Add unit
          </button>
        </>
      )}

      {propertyFormOpen && (
        <RentalPropertyForm
          company={COMPANY}
          property={editingProperty}
          onClose={closePropertyForm}
          onSaved={() => {
            closePropertyForm()
            reloadProperties()
          }}
          onArchived={() => {
            closePropertyForm()
            reloadProperties()
          }}
        />
      )}
    </div>
  )
}

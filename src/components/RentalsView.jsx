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
// stacks Overview, Calendar, and Financials into one scrollable column
// (no tabs — Overview also doubles as the only unit-switcher, so Calendar
// renders with showUnitTabs/showUnitHeader off rather than duplicating
// it), desktop is an always-mounted 2-column dashboard (calendar + unit
// list stacked in the main column, financials in its own column, all
// visible together) — see useMediaQuery.js for why that split happens in
// JS here instead of CSS like everywhere else in the app. Desktop still
// dedupes Calendar's unit-switcher differently (unitTabsReplacement,
// rendering Overview inside Calendar's own toolbar) rather than reusing
// mobile's side-by-side-sections approach — that toolbar-scoped CSS
// (.rental-calendar-toolbar .rental-overview-list) is tuned for a wide
// row, not a narrow column, so the two layouts solve the same redundancy
// in different ways on purpose.
export default function RentalsView({ me }) {
  const isDesktop = useMediaQuery('(min-width: 900px)')
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

  // Swipe left/right on mobile to step the calendar to the previous/next
  // month — same gesture/threshold TaskBoard.jsx's own Day and Month
  // views already use, mobile-only since desktop's ‹ › month arrows
  // (right above the calendar there) already cover it and there's no
  // touch gesture to hook anyway. Only wired on the mobile render below,
  // not the desktop one, rather than gating inside the handler like
  // TaskBoard.jsx does — Rentals' mobile/desktop layouts are already two
  // fully separate JSX trees (see file-top comment), so there's no single
  // shared element both branches render that a runtime isDesktop check
  // would need to guard.
  const monthSwipeStart = useRef(null)
  const SWIPE_MIN_DISTANCE = 60

  function handleMonthSwipeStart(e) {
    const t = e.touches[0]
    monthSwipeStart.current = { x: t.clientX, y: t.clientY }
  }

  function handleMonthSwipeEnd(e) {
    const start = monthSwipeStart.current
    monthSwipeStart.current = null
    if (!start) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) < SWIPE_MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return
    shiftMonth(dx > 0 ? 1 : -1)
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
            <button
              type="button"
              className="rental-add-booking rental-add-booking-primary rentals-combined-nav-unit"
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
            allBookings={upcomingBookings}
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
      <h3 className="task-section-heading">Overview</h3>
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

      {/* Overview's cards above are the only unit-switcher here — no
          .rental-unit-tabs strip and no bold $/mo header, both redundant
          once Overview is always visible and already showing per-unit
          price. Deliberately not the same unitTabsReplacement trick the
          desktop dashboard uses for this: that renders Overview *inside*
          Calendar's own toolbar, and the CSS that makes it fit there
          (.rental-calendar-toolbar .rental-overview-list, a horizontal
          wrapping row) is tuned for a wide desktop toolbar — forcing
          Overview's multi-line cards into that same row at 375px would
          just squeeze them. Kept as its own section instead; the two
          components staying visually separate doesn't matter since they
          already share selectedUnitId/onSelectUnit from here regardless
          of whether one is nested inside the other. */}
      <div onTouchStart={handleMonthSwipeStart} onTouchEnd={handleMonthSwipeEnd}>
        <RentalCalendar
          properties={properties}
          bookings={bookings}
          monthDate={monthDate}
          createdBy={me?.id}
          onBookingsChanged={handleBookingsChanged}
          selectedUnitId={selectedUnitId}
          onSelectUnit={setSelectedUnitId}
          showUnitTabs={false}
          showUnitHeader={false}
        />
      </div>

      <h3 className="task-section-heading">Financials</h3>
      <RentalFinancials
        company={COMPANY}
        properties={properties}
        bookings={bookings}
        allBookings={upcomingBookings}
        expenses={expenses}
        monthDate={monthDate}
        goals={goals}
        onGoalsChanged={reloadGoals}
        onExpensesChanged={reloadExpenses}
      />

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

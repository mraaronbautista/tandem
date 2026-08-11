import { useState } from 'react'
import { chargeDatesForBooking, monthRangeStrings, BOOKING_SOURCE_LABEL } from '../lib/rentals'
import RentalSavingsGoal from './RentalSavingsGoal'
import RentalExpenseForm from './RentalExpenseForm'

function money(n) {
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

// Revenue is recognized by upfront charge, not by calendar-day occupancy —
// a guest who checked in Aug 15 already paid for the Aug 15 - Sep 13
// cycle, so September shows no revenue for that unit even though the
// guest is still physically there. Pending (unconfirmed) requests never
// count toward revenue, only confirmed bookings. `bookings` is scoped to
// the visible month (see RentalsView's fetch), which is enough here since
// any charge landing in this month implies the booking overlaps this
// month too.
export default function RentalFinancials({
  company,
  properties,
  bookings,
  expenses,
  monthDate,
  goals,
  onGoalsChanged,
  onExpensesChanged,
}) {
  const [expenseFormOpen, setExpenseFormOpen] = useState(false)
  const [editingExpense, setEditingExpense] = useState(null)
  // Collapsed by default — the Financials column already stacks goals,
  // summary, source breakdown, overhead, and units, so starting these
  // two closed keeps the common case (glancing at the top summary)
  // short instead of scrolling past a full breakdown every time.
  const [sourceOpen, setSourceOpen] = useState(false)
  const [overheadOpen, setOverheadOpen] = useState(false)

  function openNewExpense() {
    setEditingExpense(null)
    setExpenseFormOpen(true)
  }

  function openEditExpense(expense) {
    setEditingExpense(expense)
    setExpenseFormOpen(true)
  }

  const { start, end } = monthRangeStrings(monthDate)

  const confirmedBookings = bookings.filter((b) => b.status === 'confirmed')
  const pendingBookings = bookings.filter((b) => b.status === 'pending')

  const chargesByProperty = new Map()
  for (const b of confirmedBookings) {
    const count = chargeDatesForBooking(b).filter((d) => d >= start && d < end).length
    if (count > 0) chargesByProperty.set(b.property_id, (chargesByProperty.get(b.property_id) || 0) + count)
  }

  const confirmedOccupiedIds = new Set(confirmedBookings.map((b) => b.property_id))
  const pendingOnlyIds = new Set(
    pendingBookings.filter((b) => !confirmedOccupiedIds.has(b.property_id)).map((b) => b.property_id),
  )

  // properties arrives sorted by monthly_rent desc (see fetchRentalProperties),
  // so filtering preserves highest-rent-first order for the "fill next" priority.
  const billed = properties.filter((p) => chargesByProperty.has(p.id))
  const occupiedNoCharge = properties.filter((p) => confirmedOccupiedIds.has(p.id) && !chargesByProperty.has(p.id))
  const pendingOnly = properties.filter((p) => pendingOnlyIds.has(p.id))
  const vacant = properties.filter((p) => !confirmedOccupiedIds.has(p.id) && !pendingOnlyIds.has(p.id))

  const revenue = billed.reduce((sum, p) => sum + Number(p.monthly_rent) * chargesByProperty.get(p.id), 0)
  const overhead = expenses.reduce((sum, e) => sum + Number(e.amount), 0)
  const surplus = revenue - overhead

  // Which channel is actually landing (billed) tenants, not just which
  // has the most bookings on file — a pending or never-charged booking
  // this month tells you nothing about a platform's real return. Grouped
  // by revenue like the rest of this component, so the "most effective"
  // platform reads as the top row without needing to eyeball it.
  const propertyById = new Map(properties.map((p) => [p.id, p]))
  const sourceBreakdown = new Map()
  for (const b of confirmedBookings) {
    const property = propertyById.get(b.property_id)
    if (!property) continue
    const count = chargeDatesForBooking(b).filter((d) => d >= start && d < end).length
    if (count === 0) continue
    const key = b.source || 'unspecified'
    const entry = sourceBreakdown.get(key) || { count: 0, revenue: 0 }
    entry.count += 1
    entry.revenue += count * Number(property.monthly_rent)
    sourceBreakdown.set(key, entry)
  }
  const sourceRows = [...sourceBreakdown.entries()].sort((a, b) => b[1].revenue - a[1].revenue)

  return (
    <div className="rental-financials">
      <RentalSavingsGoal company={company} goals={goals} onGoalsChanged={onGoalsChanged} />

      <div className="rental-financials-summary">
        <div className="rental-financials-row">
          <span>
            Revenue ({billed.length}/{properties.length} units billed)
          </span>
          <span>{money(revenue)}</span>
        </div>
        <div className="rental-financials-row">
          <span>Overhead</span>
          <span>-{money(overhead)}</span>
        </div>
        <div
          className={`rental-financials-row rental-financials-total ${surplus >= 0 ? 'rental-surplus' : 'rental-deficit'}`}
        >
          <span>{surplus >= 0 ? 'Surplus' : 'Shortfall'}</span>
          <span>{surplus >= 0 ? money(surplus) : `-${money(Math.abs(surplus))}`}</span>
        </div>
      </div>

      {sourceRows.length > 0 && (
        <>
          <button
            type="button"
            className="rental-financials-subheading rental-financials-subheading-toggle"
            onClick={() => setSourceOpen((v) => !v)}
          >
            Bookings by source
            <span className="rental-financials-subheading-chevron">{sourceOpen ? '▾' : '▸'}</span>
          </button>
          {sourceOpen &&
            sourceRows.map(([key, { count, revenue: sourceRevenue }]) => (
              <div key={key} className="rental-financials-row">
                <span>{BOOKING_SOURCE_LABEL[key]}</span>
                <span>
                  {count} {count === 1 ? 'booking' : 'bookings'} — {money(sourceRevenue)}
                </span>
              </div>
            ))}
        </>
      )}

      <button
        type="button"
        className="rental-financials-subheading rental-financials-subheading-toggle"
        onClick={() => setOverheadOpen((v) => !v)}
      >
        Overhead breakdown
        <span className="rental-financials-subheading-chevron">{overheadOpen ? '▾' : '▸'}</span>
      </button>
      {overheadOpen && (
        <>
          {expenses.map((e) => (
            <button
              type="button"
              key={e.id}
              className="rental-expense-row rental-expense-row-editable"
              onClick={() => openEditExpense(e)}
            >
              <span>{e.label}</span>
              <span>{money(e.amount)}</span>
            </button>
          ))}
          <button type="button" className="rental-add-booking" onClick={openNewExpense}>
            + Add overhead
          </button>
        </>
      )}

      {expenseFormOpen && (
        <RentalExpenseForm
          company={company}
          expense={editingExpense}
          onClose={() => setExpenseFormOpen(false)}
          onSaved={() => {
            setExpenseFormOpen(false)
            onExpensesChanged()
          }}
          onDeleted={() => {
            setExpenseFormOpen(false)
            onExpensesChanged()
          }}
        />
      )}

      <h3 className="rental-financials-subheading">Units</h3>
      {billed.map((p) => {
        const count = chargesByProperty.get(p.id)
        return (
          <div key={p.id} className="rental-unit-status-row">
            <span>
              <span className="rental-unit-dot" style={{ background: p.color }} />
              {p.unit_name}
            </span>
            <span className="rental-unit-badge rental-unit-badge-billed">
              Billed{count > 1 ? ` ×${count}` : ''} — {money(Number(p.monthly_rent) * count)}
            </span>
          </div>
        )
      })}
      {occupiedNoCharge.map((p) => (
        <div key={p.id} className="rental-unit-status-row">
          <span>
            <span className="rental-unit-dot" style={{ background: p.color }} />
            {p.unit_name}
          </span>
          <span className="rental-unit-badge rental-unit-badge-nocharge">Occupied, no charge this month</span>
        </div>
      ))}
      {pendingOnly.map((p) => (
        <div key={p.id} className="rental-unit-status-row">
          <span>
            <span className="rental-unit-dot" style={{ background: p.color }} />
            {p.unit_name}
          </span>
          <span className="rental-unit-badge rental-unit-badge-request">
            Pending request — {money(p.monthly_rent)} if accepted
          </span>
        </div>
      ))}
      {vacant.map((p, i) => (
        <div key={p.id} className="rental-unit-status-row">
          <span>
            <span className="rental-unit-dot" style={{ background: p.color }} />
            {p.unit_name}
          </span>
          <span className="rental-unit-badge rental-unit-badge-vacant">
            Vacant — {money(p.monthly_rent)}
            {i === 0 && <span className="rental-fill-next-badge">Fill next</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

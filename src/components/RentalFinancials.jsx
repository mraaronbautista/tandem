import { chargeDatesForBooking, monthRangeStrings } from '../lib/rentals'
import RentalSavingsGoal from './RentalSavingsGoal'

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
export default function RentalFinancials({ company, properties, bookings, expenses, monthDate, goals, onGoalsChanged }) {
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

      <h3 className="rental-financials-subheading">Overhead breakdown</h3>
      {expenses.map((e) => (
        <div key={e.id} className="rental-expense-row">
          <span>{e.label}</span>
          <span>{money(e.amount)}</span>
        </div>
      ))}

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

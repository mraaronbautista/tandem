function money(n) {
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

// `bookings` is already scoped to the visible month (see RentalsView's
// fetch), so any property with a booking in that list is occupied that
// month — no per-day proration, matching how these units are actually
// billed (monthly, Furnished-Finder style), not nightly.
export default function RentalFinancials({ properties, bookings, expenses }) {
  const occupiedIds = new Set(bookings.map((b) => b.property_id))
  const occupied = properties.filter((p) => occupiedIds.has(p.id))
  // properties arrives sorted by monthly_rent desc (see fetchRentalProperties),
  // so this preserves highest-rent-first order for the "fill next" priority.
  const vacant = properties.filter((p) => !occupiedIds.has(p.id))

  const revenue = occupied.reduce((sum, p) => sum + Number(p.monthly_rent), 0)
  const overhead = expenses.reduce((sum, e) => sum + Number(e.amount), 0)
  const surplus = revenue - overhead

  return (
    <div className="rental-financials">
      <div className="rental-financials-summary">
        <div className="rental-financials-row">
          <span>Revenue ({occupied.length}/{properties.length} units)</span>
          <span>{money(revenue)}</span>
        </div>
        <div className="rental-financials-row">
          <span>Overhead</span>
          <span>-{money(overhead)}</span>
        </div>
        <div className={`rental-financials-row rental-financials-total ${surplus >= 0 ? 'rental-surplus' : 'rental-deficit'}`}>
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
      {occupied.map((p) => (
        <div key={p.id} className="rental-unit-status-row">
          <span>
            <span className="rental-unit-dot" style={{ background: p.color }} />
            {p.unit_name}
          </span>
          <span className="rental-unit-badge rental-unit-badge-occupied">Occupied — {money(p.monthly_rent)}</span>
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

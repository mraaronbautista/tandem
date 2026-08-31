import { useState } from 'react'
import {
  chargeDatesForBooking,
  monthRangeStrings,
  todayDateStr,
  formatDateStr,
  BOOKING_SOURCE_LABEL,
  nextAvailability,
  setChargePaid,
} from '../lib/rentals'
import RentalSavingsGoal from './RentalSavingsGoal'
import RentalExpenseForm from './RentalExpenseForm'
import RentalButton from './RentalButton'

function money(n) {
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

// "Available {date}[ – {until}]" from nextAvailability()'s raw
// {date, until?} — "now" instead of spelling out today's own date, since
// that reads faster for the single most common case (a unit that's
// vacant this instant, or just freed up).
function formatAvailability({ date, until }) {
  const when = date === todayDateStr() ? 'now' : formatDateStr(date)
  return until ? `Available ${when} – ${formatDateStr(until)}` : `Available ${when}`
}

// Tenant chain + availability sharing one sub-line rather than two — a
// third line per unit just to name tenants would eat more vertical space
// than the badge-text crowding this was meant to fix in the first place.
// `blocking` (from nextAvailability itself, not a separate lookup) lists
// every tenant actually standing between today and the shown date, in
// order — a back-to-back turnover otherwise jumps straight from "Abdul"
// to a date months out with nothing explaining why, which reads as
// arbitrary or wrong (reported as exactly that) even when the date is
// correct. Only ever populated for confirmed occupants, so a pending
// request's own requester never shows up here.
function unitSubLine({ blocking, ...availability }) {
  const avail = formatAvailability(availability)
  return blocking?.length ? `${blocking.join(' → ')} · ${avail}` : avail
}

// A charge only counts toward revenue once its billing day has actually
// arrived — a tenant who moved in on the 30th isn't billed for this
// month until the 30th actually happens, even while browsing the current
// month, so a unit whose next cycle starts later this month doesn't show
// as already paid before it's due. Past months are unaffected (every
// charge date in a fully-elapsed month is already <= today); a future
// month you're browsing ahead just shows nothing yet, for the same
// reason. `paidCharges` (the booking's own paid_charges array) is the
// one override to all of this — an advance/early payment manually
// confirmed via the "Mark paid" button below counts as billed even
// though the date itself hasn't happened yet.
function isBillableCharge(d, start, end, paidCharges) {
  return d >= start && d < end && (d <= todayDateStr() || paidCharges?.includes(d))
}

// Revenue is recognized by upfront charge, not by calendar-day occupancy —
// a guest who checked in Aug 15 already paid for the Aug 15 - Sep 14
// cycle, so September shows no revenue for that unit even though the
// guest is still physically there. Pending (unconfirmed) requests never
// count toward revenue, only confirmed bookings. `bookings` is scoped to
// the visible month (see RentalsView's fetch), which is enough here since
// any charge landing in this month implies the booking overlaps this
// month too. `allBookings` (RentalsView's own `upcomingBookings`, already
// fetched for RentalOverview) is the unscoped counterpart used only for
// nextAvailability() below — a blocking booking there can be months past
// the currently-browsed one.
export default function RentalFinancials({
  company,
  properties,
  bookings,
  allBookings,
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
  const [markingPaidId, setMarkingPaidId] = useState(null)

  // Marks one specific charge date paid ahead of schedule — see
  // isBillableCharge's paidCharges branch. No local optimistic update or
  // refetch call needed: rental_bookings is already on RentalsView.jsx's
  // Realtime channel, so the write here lands and the resulting refetch
  // moves this unit from occupiedNoCharge into billed on its own.
  async function handleMarkPaid(booking, date) {
    setMarkingPaidId(booking.id)
    try {
      await setChargePaid(booking.id, booking.paid_charges || [], date)
    } finally {
      setMarkingPaidId(null)
    }
  }

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

  // Tracks bookingIds alongside the raw count, not just a running total —
  // ×2 in one month can come from two different tenants (a checkout and
  // the next tenant's move-in both landing in the same calendar month)
  // or, rarely, from one tenant's own cycles (a check-in day near a
  // month's end can roll two of the SAME booking's cycles into one
  // calendar month — see addCalendarMonths' day-31 rollover). Those read
  // very differently to a person scanning this list, so the Units row
  // below only calls out "N tenants" when it's actually more than one
  // booking, rather than always implying a double payment from the same
  // tenant.
  const chargesByProperty = new Map()
  for (const b of confirmedBookings) {
    const count = chargeDatesForBooking(b).filter((d) => isBillableCharge(d, start, end, b.paid_charges)).length
    if (count > 0) {
      const existing = chargesByProperty.get(b.property_id) || { count: 0, bookingIds: new Set() }
      existing.count += count
      existing.bookingIds.add(b.id)
      chargesByProperty.set(b.property_id, existing)
    }
  }

  // For a unit that's occupied but hasn't hit a billable charge date yet
  // this month (occupiedNoCharge below) — the soonest upcoming one, so
  // "no charge yet" can say when the money's actually coming instead of
  // leaving it a bare status. Covers both a current tenant's own next
  // cycle and an already-booked replacement tenant's move-in charge
  // (the back-to-back-turnover case) the same way — whichever charge
  // date lands first this month is what's shown, regardless of which
  // booking it belongs to. chargeDatesForBooking returns dates in
  // chronological order already, so the first one left after filtering
  // is the soonest. Keeps the whole booking, not just the date, so the
  // "Mark paid" button below has the booking id + its current
  // paid_charges to act on.
  const upcomingChargeByProperty = new Map()
  for (const b of confirmedBookings) {
    const soonest = chargeDatesForBooking(b).find((d) => d >= start && d < end && d > todayDateStr())
    if (!soonest) continue
    const existing = upcomingChargeByProperty.get(b.property_id)
    if (!existing || soonest < existing.date) upcomingChargeByProperty.set(b.property_id, { date: soonest, booking: b })
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

  const revenue = billed.reduce((sum, p) => sum + Number(p.monthly_rent) * chargesByProperty.get(p.id).count, 0)
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
    const count = chargeDatesForBooking(b).filter((d) => isBillableCharge(d, start, end, b.paid_charges)).length
    if (count === 0) continue
    const key = b.source || 'unspecified'
    const entry = sourceBreakdown.get(key) || { count: 0, revenue: 0 }
    entry.count += 1
    entry.revenue += count * Number(property.monthly_rent)
    sourceBreakdown.set(key, entry)
  }
  const sourceRows = [...sourceBreakdown.entries()].sort((a, b) => b[1].revenue - a[1].revenue)

  return (
    <div className="flex flex-col gap-3">
      <RentalSavingsGoal company={company} goals={goals} onGoalsChanged={onGoalsChanged} />

      <div className="flex flex-col gap-1.5 rounded-md border border-border px-3.5 py-3">
        <div className="flex justify-between text-sm">
          <span>
            Revenue ({billed.length}/{properties.length} units billed)
          </span>
          <span>{money(revenue)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>Overhead</span>
          <span>-{money(overhead)}</span>
        </div>
        <div
          className={`flex justify-between border-t border-border mt-1 pt-2 text-[15px] font-bold ${surplus >= 0 ? 'text-[#22c55e]' : 'text-[#dc2626]'}`}
        >
          <span>{surplus >= 0 ? 'Surplus' : 'Shortfall'}</span>
          <span>{surplus >= 0 ? money(surplus) : `-${money(Math.abs(surplus))}`}</span>
        </div>
      </div>

      {sourceRows.length > 0 && (
        <>
          <button
            type="button"
            className="mt-1 -mb-1 flex w-full cursor-pointer items-center justify-between rounded-sm border-0 bg-transparent px-1.5 py-1 -ml-1.5 opacity-60 [font-family:inherit] [font-size:inherit] [line-height:inherit] hover:bg-pill-bg"
            onClick={() => setSourceOpen((v) => !v)}
          >
            Bookings by source
            <span className="text-[18px] font-bold leading-none text-accent opacity-100">
              {sourceOpen ? '▾' : '▸'}
            </span>
          </button>
          {sourceOpen &&
            sourceRows.map(([key, { count, revenue: sourceRevenue }]) => (
              <div key={key} className="flex justify-between text-sm">
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
        className="mt-1 -mb-1 flex w-full cursor-pointer items-center justify-between rounded-sm border-0 bg-transparent px-1.5 py-1 -ml-1.5 opacity-60 [font-family:inherit] [font-size:inherit] [line-height:inherit] hover:bg-pill-bg"
        onClick={() => setOverheadOpen((v) => !v)}
      >
        Overhead breakdown
        <span className="text-[18px] font-bold leading-none text-accent opacity-100">
          {overheadOpen ? '▾' : '▸'}
        </span>
      </button>
      {overheadOpen && (
        <>
          {expenses.map((e) => (
            <button
              type="button"
              key={e.id}
              className="flex w-full cursor-pointer items-center justify-between rounded-sm border-0 bg-transparent py-1 text-left text-inherit transition-colors duration-[180ms] ease-tactile [font-family:inherit] [font-size:inherit] [line-height:inherit] hover:bg-pill-bg active:bg-border"
              onClick={() => openEditExpense(e)}
            >
              <span>{e.label}</span>
              <span>{money(e.amount)}</span>
            </button>
          ))}
          <RentalButton onClick={openNewExpense}>+ Add overhead</RentalButton>
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

      <h3 className="mt-1 -mb-1 text-[13px] opacity-60">Units</h3>
      {billed.map((p) => {
        const { count, bookingIds } = chargesByProperty.get(p.id)
        const tenantCount = bookingIds.size
        return (
          <div key={p.id} className="py-1">
            <div className="flex items-center justify-between text-sm">
              <span>
                <span className="rental-unit-dot" style={{ background: p.color }} />
                {p.unit_name}
              </span>
              <span className="text-[13px] text-[#22c55e]">
                Billed{count > 1 ? ` ×${count}` : ''}
                {tenantCount > 1 ? ` (${tenantCount} tenants)` : ''} — {money(Number(p.monthly_rent) * count)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 pl-[15px] text-xs opacity-55">
              {unitSubLine(nextAvailability(allBookings, p.id))}
            </div>
          </div>
        )
      })}
      {occupiedNoCharge.map((p) => {
        const upcoming = upcomingChargeByProperty.get(p.id)
        return (
          <div key={p.id} className="py-1">
            <div className="flex items-center justify-between text-sm">
              <span>
                <span className="rental-unit-dot" style={{ background: p.color }} />
                {p.unit_name}
              </span>
              {/* Dropped "Occupied, no charge yet" down to just "Occupied"
                  — the tenant name on the line below already confirms
                  it's occupied, so spelling that out twice just made this
                  the longest badge in the list for no extra information. */}
              <span className="text-[13px] italic opacity-60">
                {upcoming
                  ? `Occupied — ${money(p.monthly_rent)} due ${formatDateStr(upcoming.date)}`
                  : 'Occupied — no charge this month'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 pl-[15px] text-xs opacity-55">
              <span>{unitSubLine(nextAvailability(allBookings, p.id))}</span>
              {/* Advance/early payment — the normal date-driven revenue
                  calc otherwise never counts this charge until its due
                  date actually arrives (see isBillableCharge). Only
                  offered here, on the one charge that's actually next in
                  line — not a general per-date payment history. */}
              {upcoming && (
                <button
                  type="button"
                  className="flex-none cursor-pointer rounded-full border border-border bg-pill-bg px-2 py-0.5 text-[11px] text-text disabled:cursor-default disabled:opacity-60"
                  disabled={markingPaidId === upcoming.booking.id}
                  onClick={() => handleMarkPaid(upcoming.booking, upcoming.date)}
                >
                  {markingPaidId === upcoming.booking.id ? 'Marking…' : 'Mark paid'}
                </button>
              )}
            </div>
          </div>
        )
      })}
      {pendingOnly.map((p) => (
        <div key={p.id} className="py-1">
          <div className="flex items-center justify-between text-sm">
            <span>
              <span className="rental-unit-dot" style={{ background: p.color }} />
              {p.unit_name}
            </span>
            <span className="text-[13px] text-accent">Pending — {money(p.monthly_rent)} if accepted</span>
          </div>
          <div className="flex items-center justify-between gap-2 pl-[15px] text-xs opacity-55">
            {unitSubLine(nextAvailability(allBookings, p.id))}
          </div>
        </div>
      ))}
      {vacant.map((p, i) => (
        <div key={p.id} className="py-1">
          <div className="flex items-center justify-between text-sm">
            <span>
              <span className="rental-unit-dot" style={{ background: p.color }} />
              {p.unit_name}
            </span>
            <span className="text-[13px] opacity-75">
              Vacant — {money(p.monthly_rent)}
              {i === 0 && (
                <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">
                  Fill next
                </span>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 pl-[15px] text-xs opacity-55">
            {unitSubLine(nextAvailability(allBookings, p.id))}
          </div>
        </div>
      ))}
    </div>
  )
}

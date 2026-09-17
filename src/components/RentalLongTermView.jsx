import { Bell, Plus } from 'lucide-react'
import { bookingGuestLabel, daysBetweenStrs, monthsAndDaysBetween, formatMonthsAndDays, formatDateStr, todayDateStr } from '../lib/rentals'

// The Long Term half of RentalsView.jsx's term toggle — deliberately not a
// filtered copy of the Short/Midterm dashboard. A long-term unit's rent is
// fixed for the life of the lease and its income is static, so a month
// calendar has nothing useful to say about it; this leads with the lease
// itself instead (who's there, how far through the lease they are, how
// much is left) — see the mockup this shipped from,
// https://claude.ai/artifact/2gqmBNACDjdLMzC6JF22NU.
//
// `bookings` must be the unscoped set (RentalsView.jsx's upcomingBookings,
// same as RentalOverview.jsx/nextAvailability() already require) — a
// long-term lease's own check_in is almost always outside whatever month
// happens to be browsed elsewhere in the tab.
export default function RentalLongTermView({ properties, bookings, onEditUnit, onAddUnit }) {
  const units = properties.filter((p) => p.term === 'long_term')
  const todayStr = todayDateStr()

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5 rounded-[10px] bg-pill-bg px-3.5 py-3 text-[12.5px] leading-relaxed text-text">
        <Bell size={15} className="mt-0.5 flex-none text-text-h" />
        <span>
          You'll get a heads-up the month a tenant's lease ends, and again a week before move-out — this page won't
          need daily checking.
        </span>
      </div>

      {units.map((unit) => {
        // The lease covering today, if any — a booking whose check_in is
        // still in the future (an already-confirmed upcoming lease with no
        // current tenant yet) deliberately doesn't count as "current" here.
        const current = bookings.find(
          (b) => b.property_id === unit.id && b.status === 'confirmed' && b.check_in <= todayStr && b.check_out >= todayStr,
        )

        return (
          <div key={unit.id} className="rounded-[10px] border border-border bg-card-bg p-4 shadow-[var(--shadow-resting)]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: unit.color }} />
                <button
                  type="button"
                  className="cursor-pointer truncate bg-transparent p-0 text-[16px] font-bold text-text-h"
                  onClick={() => onEditUnit(unit)}
                  title={unit.unit_name}
                >
                  {unit.unit_name}
                </button>
              </div>
              {unit.monthly_rent != null && (
                <div className="flex-none text-[20px] font-bold text-text-h">
                  ${Number(unit.monthly_rent).toLocaleString()}
                  <span className="text-xs font-medium text-text opacity-70">/mo</span>
                </div>
              )}
            </div>

            {current ? (
              <>
                <div className="mt-1 text-[13px] text-text">{bookingGuestLabel(current)}</div>
                <div className="mt-3.5">
                  <div className="mb-1 flex justify-between text-[11px] text-text opacity-70">
                    <span>{formatDateStr(current.check_in)}</span>
                    <span>{formatDateStr(current.check_out)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-pill-bg">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-accent to-accent-h"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(
                            0,
                            (daysBetweenStrs(current.check_in, todayStr) / daysBetweenStrs(current.check_in, current.check_out)) * 100,
                          ),
                        )}%`,
                      }}
                    />
                  </div>
                  <div className="mt-1.5 text-[11.5px] text-text opacity-75">
                    {formatMonthsAndDays(monthsAndDaysBetween(todayStr, current.check_out))} remaining
                  </div>
                </div>
              </>
            ) : (
              <div className="mt-2 text-[13px] text-text opacity-70">Vacant</div>
            )}
          </div>
        )
      })}

      <button
        type="button"
        onClick={onAddUnit}
        className="flex cursor-pointer flex-col items-center gap-1 rounded-[10px] border-[1.5px] border-dashed border-border py-5 text-text opacity-60 hover:opacity-90"
      >
        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full border-[1.5px] border-dashed border-border">
          <Plus size={15} />
        </span>
        <span className="text-[12.5px] font-semibold">Add a long-term unit</span>
      </button>
    </div>
  )
}

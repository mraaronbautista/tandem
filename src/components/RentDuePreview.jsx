import {
  chargeAmount,
  chargeScheduleForBooking,
  dueDayLabel,
  formatDateStr,
  formatRent,
  prorationNote,
  todayDateStr,
} from '../lib/rentals'

const MAX_ROWS = 8

// The tenant to preview: the current confirmed tenant, otherwise the next
// confirmed one. A pending request is not certain, so it is never previewed.
export function previewBookingFor(bookings, propertyId, today = todayDateStr()) {
  const mine = (bookings || [])
    .filter((b) => b.property_id === propertyId && b.status === 'confirmed' && b.check_out >= today)
    .sort((a, b) => a.check_in.localeCompare(b.check_in))
  return mine.find((b) => b.check_in <= today) || mine[0] || null
}

function total(charges, rent) {
  return Math.round(charges.reduce((sum, c) => sum + chargeAmount(rent, c), 0) * 100) / 100
}

// "What would change?" under the Rent due day dropdown in Edit unit. Purely a
// calculation on the unit's own booking: it reads the dropdown as it is right
// now and writes nothing, so trying a day and pressing Cancel leaves the unit
// exactly as it was.
export default function RentDuePreview({ property, bookings, rent, currentDueDay, selectedDueDay }) {
  if (!property) return null
  const today = todayDateStr()
  const booking = previewBookingFor(bookings, property.id, today)
  const heading = booking && booking.check_in > today ? 'Charges for the next tenant' : 'Charges for the current tenant'

  if (!booking) {
    return (
      <div className="rounded-[8px] border border-border px-3 py-2.5 text-[13px] text-text">
        No tenant to preview. Once a confirmed booking exists for this unit, this shows what each rent setting would charge.
      </div>
    )
  }

  const monthlyRent = Number(rent) > 0 ? Number(rent) : Number(property.monthly_rent) || 0
  const before = chargeScheduleForBooking(booking, currentDueDay)
  const after = chargeScheduleForBooking(booking, selectedDueDay)
  const changed = (currentDueDay ?? null) !== (selectedDueDay ?? null)
  const stay = `${formatDateStr(booking.check_in)} to ${formatDateStr(booking.check_out)}`
  const marks = booking.paid_charges || []
  const afterDates = new Set(after.map((c) => c.date))
  const lostMarks = marks.filter((d) => !afterDates.has(d))

  if (!changed) {
    const shown = before.slice(0, MAX_ROWS)
    return (
      <div className="flex flex-col gap-1.5 rounded-[8px] border border-border px-3 py-2.5" aria-label="Charge preview">
        <div className="text-[13px] font-semibold text-text-h">{heading}</div>
        <div className="text-xs text-text">
          {stay}. Rent is charged on {dueDayLabel(selectedDueDay)}.
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[13px]">
          {shown.map((c) => (
            <ChargeRow key={c.date} left={`${formatDateStr(c.date)}${c.date <= today ? ' · billed' : ''}${c.fraction < 1 ? ` · ${prorationNote(c)}` : ''}`} right={formatRent(chargeAmount(monthlyRent, c))} />
          ))}
          {before.length > shown.length && <span className="col-span-2 text-xs text-text">…and {before.length - shown.length} more</span>}
          <span className="border-t border-border pt-1 font-semibold text-text-h">Total</span>
          <span className="border-t border-border pt-1 text-right font-semibold text-text-h">{formatRent(total(before, monthlyRent))}</span>
        </div>
      </div>
    )
  }

  const rows = Math.min(Math.max(before.length, after.length), MAX_ROWS)
  const longer = Math.max(before.length, after.length)
  return (
    <div className="flex flex-col gap-2 rounded-[8px] border border-border px-3 py-2.5" aria-label="Charge preview">
      <div className="rounded-[8px] bg-notice/15 px-2.5 py-1.5 text-xs text-notice-text" role="status">
        Not saved yet. Press Cancel to leave this unit as it was.
      </div>
      <div className="text-[13px] font-semibold text-text-h">What would change</div>
      <div className="text-xs text-text">{heading.replace('Charges for', 'For')}: {stay}.</div>
      <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3.5 gap-y-1 text-[13px]">
        <span className="text-[11px] text-text">Charge</span>
        <span className="text-right text-[11px] text-text">Today</span>
        <span className="text-right text-[11px] text-text">With {dueDayLabel(selectedDueDay).replace('the ', '')}</span>
        {Array.from({ length: rows }, (_, i) => {
          const was = before[i]
          const now = after[i]
          const label = now || was
          const sameDate = was && now && was.date === now.date
          return (
            <Row
              key={i}
              label={`${formatDateStr(label.date)}${now && now.date <= today ? ' · billed' : ''}${now && now.fraction < 1 ? ` · ${prorationNote(now)}` : ''}`}
              was={was ? `${sameDate ? '' : `${formatDateStr(was.date)} `}${formatRent(chargeAmount(monthlyRent, was))}` : 'none'}
              now={now ? formatRent(chargeAmount(monthlyRent, now)) : 'none'}
            />
          )
        })}
        {longer > rows && <span className="col-span-3 text-xs text-text">…and {longer - rows} more</span>}
        <span className="border-t border-border pt-1 font-semibold text-text-h">Total</span>
        <span className="border-t border-border pt-1 text-right text-text">{formatRent(total(before, monthlyRent))}</span>
        <span className="border-t border-border pt-1 text-right font-semibold text-text-h">{formatRent(total(after, monthlyRent))}</span>
      </div>
      <div className="text-xs text-text">
        Already billed charges stay billed.
        {marks.length > 0 &&
          (lostMarks.length === 0
            ? ` Your paid-in-advance mark${marks.length > 1 ? 's' : ''} still match${marks.length > 1 ? '' : 'es'}.`
            : ` These paid-in-advance marks would no longer match a charge date: ${lostMarks.map(formatDateStr).join(', ')}.`)}
      </div>
    </div>
  )
}

function ChargeRow({ left, right }) {
  return (
    <>
      <span className="min-w-0 [overflow-wrap:anywhere]">{left}</span>
      <span className="text-right">{right}</span>
    </>
  )
}

function Row({ label, was, now }) {
  return (
    <>
      <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
      <span className="text-right text-text">{was}</span>
      <span className="text-right font-medium text-accent-text">{now}</span>
    </>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Handshake } from 'lucide-react'
import { dueDayLabel, formatDateStr, nextAvailability, todayDateStr, unitOccupancyStatus } from '../lib/rentals'
import { filterRentalContacts } from '../lib/rentalContacts'
import RentalButton from './RentalButton'
import RentalContacts from './RentalContacts'

// The Rentals page's unit pieces: a slim strip (desktop) or swipeable strip
// (phone) to pick a unit, a one line summary of the picked unit, and quiet
// collapsed rows for what is secondary (contacts, visits and the house
// manager's note). RentalOverview's cards are no longer used.

function tenantLine(status) {
  if (status.occupied) return status.guest
  if (status.next) return `Vacant, next ${status.next.pending ? 'request' : 'guest'} ${formatDateStr(status.next.checkIn)}`
  return 'Vacant'
}

// One unit chip: dot, name, tenant and rent, "N visits" and the In talks
// toggle. The toggle stops propagation so it never changes the selection.
function UnitChip({ unit: p, bookings, selected, visits, onSelect, onToggleNegotiating, chipRef }) {
  const line = tenantLine(unitOccupancyStatus(bookings, p.id))
  return (
    <div
      ref={chipRef}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className={`flex h-full min-w-0 cursor-pointer flex-col gap-0.5 rounded-[10px] border px-3 py-2 text-left ${
        selected ? 'border-accent bg-pill-bg' : 'border-border bg-card-bg'
      }`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onSelect()
      }}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="rental-unit-dot flex-none" style={{ background: p.color }} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-h" title={p.unit_name}>
          {p.unit_name}
        </span>
        {onToggleNegotiating && (
          <button
            type="button"
            className={`flex h-6 min-w-6 flex-none cursor-pointer items-center justify-center gap-1 rounded-full border px-1 text-[11px] font-semibold leading-none ${
              p.in_negotiation ? 'border-[#e0a83e] bg-[#e0a83e] px-2 text-on-accent' : 'border-border bg-card-bg text-text-h opacity-80'
            }`}
            onClick={(e) => {
              e.stopPropagation()
              onToggleNegotiating(p)
            }}
            onKeyDown={(e) => e.stopPropagation()}
            title={p.in_negotiation ? 'In talks. Click to clear.' : 'Mark as in talks'}
            aria-pressed={!!p.in_negotiation}
            aria-label={`${p.unit_name}: ${p.in_negotiation ? 'in talks' : 'not in talks'}`}
          >
            <Handshake size={13} aria-hidden="true" />
            {p.in_negotiation && 'In talks'}
          </button>
        )}
      </span>
      <span className="min-w-0 truncate text-xs text-text" title={line}>
        {line} · ${Number(p.monthly_rent).toLocaleString()}
      </span>
      {visits > 0 && <span className="text-[11px] font-semibold text-accent-text">{visits} {visits === 1 ? 'visit' : 'visits'}</span>}
    </div>
  )
}

const NO_UNITS = <p className="task-notes-empty">No units yet. Tap "+ Add unit" to add your first rental.</p>

export function RentalUnitStrip({ properties, bookings, selectedUnitId, onSelectUnit, onToggleNegotiating, visitCounts }) {
  if (properties.length === 0) return NO_UNITS
  return (
    <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2 p-0">
      {properties.map((p) => (
        <li key={p.id} className="min-w-0">
          <UnitChip
            unit={p}
            bookings={bookings}
            selected={p.id === selectedUnitId}
            visits={visitCounts?.get(p.id) || 0}
            onSelect={() => onSelectUnit(p.id)}
            onToggleNegotiating={onToggleNegotiating}
          />
        </li>
      ))}
    </ul>
  )
}

// Phone version of the strip: the picked unit's chip is centered with its
// neighbours peeking in, dots show where you are, and two faint arrows step to
// the previous or next unit. Swiping the strip selects whichever chip it comes
// to rest on, so the calendar below always matches the centered chip.
const CHIP_WIDTH = 140
const SETTLE_MS = 180

export function RentalUnitCarousel({ properties, bookings, selectedUnitId, onSelectUnit, onToggleNegotiating, visitCounts }) {
  const scroller = useRef(null)
  const chips = useRef(new Map())
  const touching = useRef(false)
  const settle = useRef(0)
  const index = Math.max(0, properties.findIndex((p) => p.id === selectedUnitId))

  const centerChip = useCallback((id, behavior) => {
    const box = scroller.current
    const chip = chips.current.get(id)
    if (!box || !chip) return
    box.scrollTo({ left: chip.offsetLeft - (box.clientWidth - chip.offsetWidth) / 2, behavior })
  }, [])

  // Keep the picked chip centered however it was picked (arrow, dot, tap, or
  // the page choosing a default). The first run is instant, later ones glide.
  const first = useRef(true)
  useEffect(() => {
    if (!selectedUnitId) return
    centerChip(selectedUnitId, first.current ? 'auto' : 'smooth')
    first.current = false
  }, [selectedUnitId, properties.length, centerChip])

  useEffect(() => () => clearTimeout(settle.current), [])

  if (properties.length === 0) return NO_UNITS

  const pick = (id) => {
    if (id !== selectedUnitId) onSelectUnit(id)
  }

  // After a swipe comes to rest, select the chip nearest the middle.
  function onScroll() {
    clearTimeout(settle.current)
    settle.current = setTimeout(() => {
      const box = scroller.current
      if (!box || touching.current) return
      // At either end the first or last chip cannot reach the middle, so the
      // end of the scroll decides instead of the nearest-to-middle rule.
      if (box.scrollLeft <= 2) return pick(properties[0].id)
      if (box.scrollLeft >= box.scrollWidth - box.clientWidth - 2) return pick(properties[properties.length - 1].id)
      const middle = box.scrollLeft + box.clientWidth / 2
      let best = null
      for (const p of properties) {
        const chip = chips.current.get(p.id)
        if (!chip) continue
        const distance = Math.abs(chip.offsetLeft + chip.offsetWidth / 2 - middle)
        if (!best || distance < best.distance) best = { id: p.id, distance }
      }
      if (best) pick(best.id)
    }, SETTLE_MS)
  }

  const step = (delta) => onSelectUnit(properties[Math.min(properties.length - 1, Math.max(0, index + delta))].id)
  const arrow = 'absolute top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border-strong bg-card-bg p-0 text-text-h opacity-60 after:absolute after:-inset-2 after:content-[""]'

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="relative">
        <ul
          ref={scroller}
          aria-label="Units"
          className="m-0 flex list-none snap-x snap-mandatory gap-2 overflow-x-auto p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={onScroll}
          onTouchStart={() => { touching.current = true }}
          onTouchEnd={() => { touching.current = false; onScroll() }}
        >
          {properties.map((p) => (
            <li key={p.id} className="flex-none snap-center" style={{ width: CHIP_WIDTH }}>
              <UnitChip
                unit={p}
                bookings={bookings}
                selected={p.id === selectedUnitId}
                visits={visitCounts?.get(p.id) || 0}
                chipRef={(el) => (el ? chips.current.set(p.id, el) : chips.current.delete(p.id))}
                onSelect={() => onSelectUnit(p.id)}
                onToggleNegotiating={onToggleNegotiating}
              />
            </li>
          ))}
        </ul>
        {index > 0 && (
          <button type="button" className={`${arrow} -left-1.5`} aria-label="Previous unit" onClick={() => step(-1)}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
        )}
        {index < properties.length - 1 && (
          <button type="button" className={`${arrow} -right-1.5`} aria-label="Next unit" onClick={() => step(1)}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {properties.length > 1 && (
        <div className="flex items-center justify-center" role="group" aria-label="Choose a unit">
          {properties.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className="flex h-6 cursor-pointer items-center border-0 bg-transparent px-[3px]"
              aria-label={`Show ${p.unit_name}`}
              aria-current={i === index}
              onClick={() => onSelectUnit(p.id)}
            >
              <span className={`block h-1.5 rounded-full ${i === index ? 'w-3.5 bg-accent-text' : 'w-1.5 bg-[var(--control-border)]'}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// "Ian through Dec 12 · rent due the 1st · available Dec 13", with Edit unit.
export function RentalUnitHeader({ unit, bookings, onEdit }) {
  const status = unitOccupancyStatus(bookings, unit.id)
  const available = nextAvailability(bookings, unit.id)
  const bits = []
  if (status.occupied) bits.push(`${status.guest} through ${formatDateStr(status.through)}`)
  else bits.push(tenantLine(status))
  if (unit.rent_due_day !== null && unit.rent_due_day !== undefined) bits.push(`rent due ${dueDayLabel(unit.rent_due_day)}`)
  bits.push(available.date <= todayDateStr() ? 'available now' : `available ${formatDateStr(available.date)}`)
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 min-w-0 text-[15px] font-semibold text-text-h [overflow-wrap:anywhere]">{unit.unit_name}</h3>
        <RentalButton className="flex-none" onClick={() => onEdit(unit)}>
          Edit unit
        </RentalButton>
      </div>
      <span className="min-w-0 text-[13px] text-text">{bits.join(' · ')}</span>
    </div>
  )
}

function Row({ title, hint, open, onClick, children }) {
  return (
    <button
      type="button"
      className="flex w-full min-w-0 cursor-pointer items-center justify-between gap-3 rounded-[10px] border border-border bg-card-bg px-3.5 py-2.5 text-left text-sm text-text-h"
      aria-expanded={open}
      onClick={onClick}
    >
      <span className="min-w-0">
        <span className="font-semibold">{title}</span>
        {hint && <span className="text-text"> · {hint}</span>}
      </span>
      {children}
    </button>
  )
}

// Contacts opens in place; What's happening opens the existing sheet (which
// also holds the note for the house manager).
export function RentalUnitDetails({ unit, contactStore, visitCount, onOpenActivity }) {
  const [contactsOpen, setContactsOpen] = useState(false)
  const loaded = !contactStore.error && contactStore.contacts
  const contactCount = loaded ? filterRentalContacts(contactStore.contacts, { propertyId: unit.id, workSiteId: unit.work_site_id }).length : null
  const contactsHint = contactStore.error ? "couldn't load" : contactCount === null ? 'loading' : contactCount === 0 ? 'none yet' : String(contactCount)
  const happening = [visitCount > 0 ? `${visitCount} ${visitCount === 1 ? 'visit' : 'visits'}` : 'nothing scheduled']
  if (unit.staff_note) happening.push('note for the house manager')

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Row title="Contacts" hint={contactsHint} open={contactsOpen} onClick={() => setContactsOpen((v) => !v)}>
        {contactsOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
      </Row>
      {contactsOpen && <RentalContacts store={contactStore} property={unit} />}
      <Row title="What's happening" hint={happening.join(' · ')} onClick={() => onOpenActivity(unit)}>
        <ChevronRight size={16} aria-hidden="true" />
      </Row>
    </div>
  )
}

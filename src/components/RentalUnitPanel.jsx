import { useState } from 'react'
import { ChevronDown, ChevronRight, Handshake } from 'lucide-react'
import { dueDayLabel, formatDateStr, nextAvailability, todayDateStr, unitOccupancyStatus } from '../lib/rentals'
import { filterRentalContacts } from '../lib/rentalContacts'
import RentalButton from './RentalButton'
import RentalContacts from './RentalContacts'

// The desktop Rentals page's unit pieces: a slim strip to pick a unit, a one
// line summary of the picked unit, and quiet collapsed rows for what is
// secondary (contacts, visits and the house manager's note). Mobile keeps
// RentalOverview's cards.

function tenantLine(status) {
  if (status.occupied) return status.guest
  if (status.next) return `Vacant, next ${status.next.pending ? 'request' : 'guest'} ${formatDateStr(status.next.checkIn)}`
  return 'Vacant'
}

export function RentalUnitStrip({ properties, bookings, selectedUnitId, onSelectUnit, onToggleNegotiating, visitCounts }) {
  if (properties.length === 0) {
    return <p className="task-notes-empty">No units yet. Tap "+ Add unit" to add your first rental.</p>
  }
  return (
    <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2 p-0">
      {properties.map((p) => {
        const status = unitOccupancyStatus(bookings, p.id)
        const selected = p.id === selectedUnitId
        const visits = visitCounts?.get(p.id) || 0
        const line = tenantLine(status)
        const select = () => onSelectUnit(p.id)
        return (
          <li key={p.id} className="min-w-0">
            <div
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              className={`flex h-full min-w-0 cursor-pointer flex-col gap-0.5 rounded-[10px] border px-3 py-2 text-left ${
                selected ? 'border-accent bg-pill-bg' : 'border-border bg-card-bg'
              }`}
              onClick={select}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                select()
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
                      p.in_negotiation ? 'border-[#e0a83e] bg-[#e0a83e] px-2 text-on-accent' : 'border-border bg-card-bg text-text-h opacity-60'
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
          </li>
        )
      })}
    </ul>
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h3 className="m-0 text-[15px] font-semibold text-text-h">{unit.unit_name}</h3>
      <span className="min-w-0 text-[13px] text-text">{bits.join(' · ')}</span>
      <RentalButton className="ml-auto" onClick={() => onEdit(unit)}>
        Edit unit
      </RentalButton>
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

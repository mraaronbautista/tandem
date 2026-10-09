import { useMemo, useRef, useState } from 'react'
import { CalendarCheck, CircleCheck, ClipboardCheck, LogIn, LogOut, Sparkles, TriangleAlert, Wrench } from 'lucide-react'
import { formatDateStr, todayDateStr } from '../lib/rentals'
import { deleteRentalVisit, setRentalVisitDone } from '../lib/rentalVisits'
import { addDaysStr, buildUnitTimeline, formatVisitTime } from '../lib/unitTimeline'
import { friendlyError } from '../lib/friendlyError'
import { useConfirm } from '../lib/confirmContext'
import Modal from './Modal'
import ModalCard from './ModalCard'
import RentalButton from './RentalButton'
import VisitForm from './VisitForm'
import LoadingText from './LoadingText'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

const SMALL = 'min-h-10 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-accent-text disabled:opacity-60'

function weekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short' })
}

function visitIcon(kind) {
  if (/clean/i.test(kind)) return Sparkles
  if (/repair|plumb|fix|handy|electric|hvac|maint/i.test(kind)) return Wrench
  if (/inspect/i.test(kind)) return ClipboardCheck
  return CalendarCheck
}

// What is happening at one unit: upcoming move-outs and move-ins, plus the
// visits someone has scheduled (a cleaner, a plumber, an inspection). Opened
// from the "What's happening" button on a unit card.
export default function UnitActivitySheet({ unit, bookings, visitStore, contacts, locations, onClose }) {
  const [form, setForm] = useState(null) // null | { visit?: row, preset?: {...} }
  const [showPast, setShowPast] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [notice, setNotice] = useState('')
  const pending = useRef(false)
  const confirm = useConfirm()
  const { visits, error, reload } = visitStore
  const today = todayDateStr()
  const timeline = useMemo(
    () => buildUnitTimeline({ unit, bookings, visits: visits || [], today }),
    [unit, bookings, visits, today],
  )
  const locationName = unit.work_site_id ? locations?.find((site) => site.id === unit.work_site_id)?.name : ''

  async function run(id, action, done) {
    if (pending.current) return
    pending.current = true; setBusyId(id); setNotice('')
    try { await action(); reload(); if (done) setNotice(done) }
    catch (err) { setNotice(friendlyError(err)) }
    finally { pending.current = false; setBusyId('') }
  }
  async function removeVisit(visit) {
    const ok = await confirm({
      title: `Delete this ${visit.kind.toLowerCase()} visit?`,
      message: 'It will be removed for everyone. If it just got done, use Mark done instead.',
      confirmLabel: 'Delete visit',
    })
    if (ok) run(visit.id, () => deleteRentalVisit(visit.id), 'Visit deleted.')
  }

  function visitBody(event) {
    const v = event.visit
    const Icon = visitIcon(v.kind)
    const detail = [v.who, v.note].filter(Boolean).join(' · ')
    return (
      <>
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon size={16} className="flex-none text-accent-text" aria-hidden="true" />
          <span className="min-w-0 font-semibold text-text-h [overflow-wrap:anywhere]">{v.kind}{v.visit_time ? ` · ${formatVisitTime(v.visit_time)}` : ''}</span>
        </div>
        {detail && <div className="text-xs text-text [overflow-wrap:anywhere]">{detail}</div>}
        {v.work_site_id && <div className="text-xs text-text">Whole building{locationName ? ` · ${locationName}` : ''}</div>}
        {event.overdue && (
          <div className="flex items-center gap-1 text-xs font-semibold text-overdue-text">
            <TriangleAlert size={13} aria-hidden="true" /> Date passed. Did it happen?
          </div>
        )}
        <div className="flex flex-wrap gap-x-4">
          <button type="button" className={SMALL} disabled={busyId === v.id} onClick={() => run(v.id, () => setRentalVisitDone(v.id, true), 'Marked done.')}>Mark done</button>
          <button type="button" className={SMALL} disabled={busyId === v.id} onClick={() => { setNotice(''); setForm({ visit: v }) }}>Edit</button>
          <button type="button" className={SMALL} disabled={busyId === v.id} onClick={() => removeVisit(v)}>Delete</button>
        </div>
      </>
    )
  }

  function eventBody(event) {
    if (event.type === 'visit') return visitBody(event)
    if (event.type === 'move-out') {
      return (
        <>
          <div className="flex items-center gap-1.5">
            <LogOut size={16} className="flex-none text-notice-text" aria-hidden="true" />
            <span className="font-semibold text-text-h">Move-out</span>
          </div>
          <div className="text-xs text-text [overflow-wrap:anywhere]">{event.guest} · last day</div>
          {event.needsCleaning && (
            <div className="flex flex-wrap items-center gap-x-3">
              <span className="text-xs font-semibold text-notice-text">No cleaning booked yet</span>
              <button type="button" className={SMALL} onClick={() => { setNotice(''); setForm({ preset: { kind: 'Cleaning', visit_date: addDaysStr(event.date, 1) } }) }}>Schedule cleaning</button>
            </div>
          )}
        </>
      )
    }
    if (event.type === 'move-in') {
      return (
        <>
          <div className="flex items-center gap-1.5">
            <LogIn size={16} className="flex-none text-text-h" aria-hidden="true" />
            <span className="font-semibold text-text-h">{event.pending ? 'Possible move-in' : 'Move-in'}</span>
          </div>
          <div className="text-xs text-text [overflow-wrap:anywhere]">{event.guest}{event.pending ? ' · request, not confirmed' : ''}</div>
        </>
      )
    }
    return (
      <>
        <div className="flex items-center gap-1.5">
          <CircleCheck size={16} className="flex-none text-text-h" aria-hidden="true" />
          <span className="font-semibold text-text-h">Available</span>
        </div>
        <div className="text-xs text-text">{event.nextMoveIn ? `Until the next move-in on ${formatDateStr(event.nextMoveIn)}` : 'Nothing booked after this'}</div>
      </>
    )
  }

  const row = (event) => (
    <li key={event.key} className="grid min-w-0 grid-cols-[56px_minmax(0,1fr)] gap-x-3 border-b border-border py-2.5">
      <span className="text-[13px] text-text">
        <span className="block font-semibold text-text-h">{formatDateStr(event.date)}</span>
        {weekday(event.date)}
      </span>
      <div className="min-w-0 text-sm">{eventBody(event)}</div>
    </li>
  )

  return (
    <Modal onClose={() => { if (!pending.current) onClose() }}>
      <ModalCard>
        <h2>{unit.unit_name}</h2>
        <p className="mt-0 text-sm text-text">What is happening at this unit: move-outs, move-ins and any visits you have scheduled.</p>
        {error ? (
          <p role="alert" className="text-sm">{error} <RentalButton className="min-h-[44px]" onClick={reload}>Try again</RentalButton></p>
        ) : !visits ? (
          <LoadingText />
        ) : form ? (
          <VisitForm
            key={form.visit?.id || 'new'}
            unit={unit}
            visit={form.visit}
            preset={form.preset}
            visits={visits}
            contacts={contacts}
            locationName={locationName}
            onCancel={() => setForm(null)}
            onSaved={() => { setForm(null); reload(); setNotice('Visit saved.') }}
          />
        ) : (
          <>
            <RentalButton variant="primary" className="min-h-[44px]" onClick={() => { setNotice(''); setForm({}) }}>+ Schedule a visit</RentalButton>
            {timeline.upcoming.length ? (
              <ul className="m-0 mt-3 list-none p-0">{timeline.upcoming.map(row)}</ul>
            ) : (
              <p className="text-sm text-text">Nothing scheduled yet. Tap + Schedule a visit when you book a cleaner or a repair, and it will show up here.</p>
            )}
            {timeline.past.length > 0 && (
              <>
                <button type="button" className={`${SMALL} mt-3`} aria-expanded={showPast} onClick={() => setShowPast((v) => !v)}>
                  Past visits ({timeline.past.length}) {showPast ? '▴' : '▾'}
                </button>
                {showPast && (
                  <ul className="m-0 list-none p-0">
                    {timeline.past.map((event) => (
                      <li key={event.key} className="grid min-w-0 grid-cols-[56px_minmax(0,1fr)] gap-x-3 border-b border-border py-2.5">
                        <span className="text-[13px] text-text">{formatDateStr(event.date)}</span>
                        <div className="min-w-0 text-sm">
                          <div className="flex min-w-0 items-center gap-1.5 font-semibold text-text-h">
                            <CircleCheck size={16} className="flex-none text-text-h" aria-hidden="true" />
                            <span className="min-w-0 [overflow-wrap:anywhere]">{event.visit.kind}{event.visit.visit_time ? ` · ${formatVisitTime(event.visit.visit_time)}` : ''}</span>
                          </div>
                          {[event.visit.who, event.visit.note].filter(Boolean).length > 0 && (
                            <div className="text-xs text-text [overflow-wrap:anywhere]">{[event.visit.who, event.visit.note].filter(Boolean).join(' · ')}</div>
                          )}
                          <div className="flex flex-wrap gap-x-4">
                            <button type="button" className={SMALL} disabled={busyId === event.visit.id} onClick={() => run(event.visit.id, () => setRentalVisitDone(event.visit.id, false), 'Moved back to scheduled.')}>Not done</button>
                            <button type="button" className={SMALL} disabled={busyId === event.visit.id} onClick={() => removeVisit(event.visit)}>Delete</button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
        {notice && <p role="status" className="break-words text-sm">{notice}</p>}
        <SubmissionActions><SubmissionButton className="min-h-[44px]" onClick={() => { if (!pending.current) onClose() }}>Close</SubmissionButton></SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

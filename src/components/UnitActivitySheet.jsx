import { useMemo, useRef, useState } from 'react'
import { CalendarCheck, CircleCheck, ClipboardCheck, LogIn, LogOut, Sparkles, TriangleAlert, Wrench } from 'lucide-react'
import { formatDateStr, todayDateStr } from '../lib/rentals'
import { VISIT_KIND_SUGGESTIONS, deleteRentalVisit, saveRentalVisit, setRentalVisitDone } from '../lib/rentalVisits'
import { addDaysStr, buildUnitTimeline, formatVisitTime, recentVisitKinds } from '../lib/unitTimeline'
import { friendlyError } from '../lib/friendlyError'
import { useConfirm } from '../lib/confirmContext'
import Modal from './Modal'
import ModalCard from './ModalCard'
import RentalButton from './RentalButton'
import LoadingText from './LoadingText'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

const INPUT = 'w-full min-h-[44px] rounded-[8px] border border-border bg-bg px-3 py-2 text-[15px] text-text-h'
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

function VisitForm({ unit, visit, preset, visits, contacts, locationName, onCancel, onSaved }) {
  const start = { kind: '', visit_date: todayDateStr(), visit_time: '', who: '', note: '', contact_id: '', ...preset }
  const people = (contacts || [])
    .filter((c) => c.active && c.kind !== 'tenant')
    .sort((a, b) => a.name.localeCompare(b.name))
  // A visit whose contact was archived (or deleted) since keeps its name as
  // typed text, so editing it never silently drops who was coming.
  const linkedContactListed = !!visit?.contact_id && people.some((c) => c.id === visit.contact_id)
  const [kind, setKind] = useState(visit?.kind ?? start.kind)
  const [date, setDate] = useState(visit?.visit_date ?? start.visit_date)
  const [time, setTime] = useState(visit?.visit_time ? visit.visit_time.slice(0, 5) : start.visit_time)
  const [contactId, setContactId] = useState(linkedContactListed ? visit.contact_id : start.contact_id)
  // 'who' is either a picked contact (name copied in) or whatever was typed.
  const [typedWho, setTypedWho] = useState(visit && !linkedContactListed ? visit.who : '')
  const [otherWho, setOtherWho] = useState(!!visit && !linkedContactListed && !!visit.who)
  const [note, setNote] = useState(visit?.note ?? start.note)
  const [wholeBuilding, setWholeBuilding] = useState(!!visit?.work_site_id)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const pending = useRef(false)

  const kinds = [...new Set([...VISIT_KIND_SUGGESTIONS, ...recentVisitKinds(visits)])]
  const picked = people.find((c) => c.id === contactId)
  const whoValue = otherWho ? '__other' : contactId

  async function submit(event) {
    event.preventDefault()
    if (pending.current) return
    if (!kind.trim()) { setError('Choose or type what kind of visit this is.'); return }
    if (!date) { setError('Choose a date.'); return }
    pending.current = true; setSaving(true); setError('')
    try {
      await saveRentalVisit(visit?.id, {
        kind,
        visit_date: date,
        visit_time: time,
        who: otherWho ? typedWho : picked?.name || '',
        note,
        contact_id: otherWho ? null : picked?.id || null,
        property_id: wholeBuilding ? null : unit.id,
        work_site_id: wholeBuilding ? unit.work_site_id : null,
      })
      onSaved()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      pending.current = false; setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-1 min-w-0">
      <h3 className="m-0 text-base font-semibold text-text-h">{visit ? 'Edit visit' : 'Schedule a visit'}</h3>
      <fieldset disabled={saving} className="m-0 min-w-0 border-0 p-0">
        <p className="mb-1 text-sm text-text-h">What kind of visit?</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Kind of visit">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind.trim().toLowerCase() === k.toLowerCase()}
              className={`min-h-10 cursor-pointer rounded-full border px-3.5 text-sm ${kind.trim().toLowerCase() === k.toLowerCase() ? 'border-accent bg-accent font-semibold text-on-accent' : 'border-border bg-pill-bg text-text-h'}`}
              onClick={() => setKind(k)}
            >
              {k}
            </button>
          ))}
        </div>
        <label className="mt-2 block">Or type your own<input className={INPUT} value={kind} maxLength={40} onChange={(e) => setKind(e.target.value)} placeholder="Pest control, Locksmith, Painting…" /></label>
        <div className="mt-2 grid min-w-0 grid-cols-2 gap-3">
          <label>Date<input className={INPUT} type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Time (optional)<input className={INPUT} type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        </div>
        <label className="mt-2 block">Who is coming
          <select
            className={INPUT}
            value={whoValue}
            onChange={(e) => {
              if (e.target.value === '__other') { setOtherWho(true); setContactId('') }
              else { setOtherWho(false); setContactId(e.target.value) }
            }}
          >
            <option value="">Not sure yet</option>
            {people.map((c) => <option key={c.id} value={c.id}>{c.name}{c.trade ? ` · ${c.trade}` : ''}</option>)}
            <option value="__other">Someone else (type a name)</option>
          </select>
        </label>
        {otherWho && <label className="mt-2 block">Name<input className={INPUT} value={typedWho} maxLength={120} onChange={(e) => setTypedWho(e.target.value)} /></label>}
        <label className="mt-2 block">Note (optional)<input className={INPUT} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Deep clean, fix bathroom sink…" /></label>
        {unit.work_site_id && (
          <label className="mt-2 flex min-h-11 items-center gap-2" style={{ flexDirection: 'row' }}>
            <input type="checkbox" checked={wholeBuilding} onChange={(e) => setWholeBuilding(e.target.checked)} />
            Whole building{locationName ? ` (${locationName})` : ''}: show on every unit there
          </label>
        )}
      </fieldset>
      {error && <p role="alert" className="error">{error}</p>}
      <SubmissionActions>
        <SubmissionButton className="min-h-[44px]" disabled={saving} onClick={onCancel}>Cancel</SubmissionButton>
        <SubmissionButton className="min-h-[44px]" variant="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save visit'}</SubmissionButton>
      </SubmissionActions>
    </form>
  )
}

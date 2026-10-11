import { useRef, useState } from 'react'
import { todayDateStr } from '../lib/rentals'
import { todayInZone, visitTimeText, zoneName } from '../lib/locationTime'
import { VISIT_KIND_SUGGESTIONS, saveRentalVisit } from '../lib/rentalVisits'
import { recentVisitKinds } from '../lib/unitTimeline'
import { friendlyError } from '../lib/friendlyError'
import { alertStaff, visitAlertText } from '../lib/staffAlerts'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

const INPUT = 'w-full min-h-[44px] rounded-[8px] border border-border bg-bg px-3 py-2 text-[15px] text-text-h'

// The add/edit visit form, shared by the unit's "What's happening" sheet and
// the turnover task's "Schedule visit" shortcut.
// `timezone` is the location's zone (or null when the unit has no location);
// `locationOnly` is the Locations row's form, where a visit always belongs to
// the whole location; `locationUnitCount` words the "Where" choice.
export default function VisitForm({ unit, visit, preset, visits, contacts, locationName, timezone = null, locationOnly = false, locationUnitCount = 0, onCancel, onSaved }) {
  const start = { kind: '', visit_date: timezone ? todayInZone(timezone) : todayDateStr(), visit_time: '', who: '', note: '', contact_id: '', ...preset }
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
  const [wholeBuilding, setWholeBuilding] = useState(locationOnly || !!visit?.work_site_id)
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
      const fields = {
        kind,
        visit_date: date,
        visit_time: time,
        who: otherWho ? typedWho : picked?.name || '',
        note,
        contact_id: otherWho ? null : picked?.id || null,
        property_id: wholeBuilding ? null : unit.id,
        work_site_id: wholeBuilding ? unit.work_site_id : null,
      }
      await saveRentalVisit(visit?.id, fields)
      // Tell the house manager (best effort, after the save): a new visit is
      // "booked"; an edit only alerts when something he cares about changed,
      // so pressing Save without a change stays quiet.
      const same = visit
        && visit.kind === fields.kind.trim()
        && visit.visit_date === fields.visit_date
        && (visit.visit_time ? visit.visit_time.slice(0, 5) : '') === (fields.visit_time || '')
        && (visit.who || '') === fields.who.trim()
        && (visit.property_id || null) === fields.property_id
        && (visit.work_site_id || null) === fields.work_site_id
      if (!same) {
        const place = wholeBuilding ? locationName || unit.unit_name : unit.unit_name
        const text = visitAlertText({ visit: { ...fields, kind: fields.kind.trim(), visit_time: fields.visit_time || null }, place, tz: timezone, change: visit ? 'changed' : 'booked' })
        alertStaff(text.title, text.body)
      }
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
        {timezone && time && (() => {
          const { yours } = visitTimeText({ date, time, tz: timezone })
          return (
            <p className="mb-0 mt-1 text-xs text-text">
              {zoneName(timezone)} time, at the property.{yours ? ` That is ${yours.replace(' your time', '')} for you.` : ''}
            </p>
          )
        })()}
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
        {unit.work_site_id && !locationOnly && (
          <fieldset className="mt-3 min-w-0 border-0 p-0" aria-label="Where is this visit">
            <legend className="mb-1 p-0 text-sm text-text-h">Where</legend>
            {[
              [true, locationUnitCount > 1 ? `All ${locationUnitCount} units at ${locationName || 'this location'}` : `Everything at ${locationName || 'this location'}`],
              [false, `${unit.unit_name} only`],
            ].map(([whole, label]) => (
              <label
                key={String(whole)}
                className={`mt-1.5 flex min-h-11 cursor-pointer items-center gap-2 rounded-[8px] border px-3 text-sm ${wholeBuilding === whole ? 'border-accent bg-pill-bg font-semibold text-text-h' : 'border-border text-text'}`}
                style={{ flexDirection: 'row' }}
              >
                <input type="radio" name="visit-where" checked={wholeBuilding === whole} onChange={() => setWholeBuilding(whole)} />
                {label}
              </label>
            ))}
          </fieldset>
        )}
        {locationOnly && (
          <p className="mb-0 mt-3 rounded-[8px] bg-pill-bg px-3 py-2 text-sm text-text-h">
            {locationUnitCount > 1 ? `Shows on all ${locationUnitCount} units at ${locationName}.` : `Shows on everything at ${locationName}.`}
          </p>
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

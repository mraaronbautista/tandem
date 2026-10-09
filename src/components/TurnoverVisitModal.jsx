import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { todayDateStr } from '../lib/rentals'
import { fetchRentalVisits } from '../lib/rentalVisits'
import { fetchRentalContacts, fetchRentalLocations } from '../lib/rentalContacts'
import { cleaningPreset, tickCleanerStep } from '../lib/turnoverTask'
import { friendlyError } from '../lib/friendlyError'
import Modal from './Modal'
import ModalCard from './ModalCard'
import LoadingText from './LoadingText'
import VisitForm from './VisitForm'
import RentalButton from './RentalButton'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

// "Schedule visit" from a turnover task: opens the visit form for the task's
// unit with Cleaning and the day after the move-out already filled in. When
// the visit is saved the task's "book the cleaner" step is ticked. Loads what
// it needs once (no live channels) since it is open for a moment.
export default function TurnoverVisitModal({ task, onUpdateTask, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [saved, setSaved] = useState(null) // null | { ticked: boolean, error?: string }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data: booking, error: bookingError } = await supabase
          .from('rental_bookings')
          .select('id, property_id, check_out')
          .eq('id', task.rental_turnover_booking_id)
          .maybeSingle()
        if (bookingError) throw bookingError
        if (!booking) throw new Error('That booking no longer exists, so there is no unit to schedule a visit for.')
        const { data: unit, error: unitError } = await supabase
          .from('rental_properties')
          .select('id, unit_name, work_site_id')
          .eq('id', booking.property_id)
          .single()
        if (unitError) throw unitError
        const [visits, contacts, locations] = await Promise.all([
          fetchRentalVisits(),
          fetchRentalContacts(),
          fetchRentalLocations().catch(() => []),
        ])
        if (!cancelled) setData({ booking, unit, visits, contacts, locations })
      } catch (err) {
        if (!cancelled) {
          setError(['42P01', 'PGRST205'].includes(err.code)
            ? 'Visits are not set up yet. Ask Aaron to run the visits SQL (add-rental-visits.sql), then try again.'
            : friendlyError(err))
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [task.rental_turnover_booking_id, reloadKey])

  async function handleSaved() {
    const next = tickCleanerStep(task.checklist)
    if (!next) { setSaved({ ticked: false }); return }
    try {
      await onUpdateTask(task.id, { checklist: next }, { throwOnError: true })
      setSaved({ ticked: true })
    } catch (err) {
      setSaved({ ticked: false, error: friendlyError(err) })
    }
  }

  const locationName = data?.unit.work_site_id ? data.locations.find((s) => s.id === data.unit.work_site_id)?.name : ''

  return (
    <Modal onClose={onClose}>
      <ModalCard>
        <h2>{data ? data.unit.unit_name : 'Schedule visit'}</h2>
        {saved ? (
          <>
            <p role="status" className="text-sm text-text-h">
              Visit saved.{' '}
              {saved.error
                ? `It could not tick the task's checklist step (${saved.error}); tick it yourself.`
                : saved.ticked
                  ? 'The "book the cleaner" step on this task is ticked.'
                  : 'This task has no "book the cleaner" step to tick.'}
            </p>
            <SubmissionActions>
              <SubmissionButton variant="primary" className="min-h-[44px]" onClick={onClose}>Done</SubmissionButton>
            </SubmissionActions>
          </>
        ) : error ? (
          <>
            <p role="alert" className="text-sm">{error}</p>
            <SubmissionActions>
              <SubmissionButton className="min-h-[44px]" onClick={onClose}>Close</SubmissionButton>
              <RentalButton className="min-h-[44px]" onClick={() => { setError(''); setReloadKey((k) => k + 1) }}>Try again</RentalButton>
            </SubmissionActions>
          </>
        ) : !data ? (
          <LoadingText />
        ) : (
          <VisitForm
            unit={data.unit}
            preset={cleaningPreset(data.booking.check_out, todayDateStr())}
            visits={data.visits}
            contacts={data.contacts}
            locationName={locationName}
            onCancel={onClose}
            onSaved={handleSaved}
          />
        )}
      </ModalCard>
    </Modal>
  )
}

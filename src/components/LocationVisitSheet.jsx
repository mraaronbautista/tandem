import { useState } from 'react'
import { formatDateStr } from '../lib/rentals'
import { todayInZone, visitTimeText } from '../lib/locationTime'
import Modal from './Modal'
import ModalCard from './ModalCard'
import LoadingText from './LoadingText'
import VisitForm from './VisitForm'
import RentalButton from './RentalButton'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

// "Schedule visit" from a Locations card: a visit for the whole location. It
// is saved against the location, so it shows on every unit there and once on
// the house manager's schedule.
export default function LocationVisitSheet({ location, unitCount, visitStore, contacts, onClose }) {
  const [saved, setSaved] = useState(false)
  const { visits, error, reload } = visitStore
  const today = todayInZone(location.timezone)
  const already = (visits || [])
    .filter((v) => v.work_site_id === location.id && v.status === 'scheduled' && v.visit_date >= today)
    .sort((a, b) => a.visit_date.localeCompare(b.visit_date))
  // The form wants a unit-shaped object; this one stands for the location.
  const stand = { id: null, unit_name: location.name, work_site_id: location.id }
  return (
    <Modal onClose={onClose}>
      <ModalCard>
        <h2>{location.name}</h2>
        {error ? (
          <p role="alert" className="text-sm">{error} <RentalButton className="min-h-[44px]" onClick={reload}>Try again</RentalButton></p>
        ) : !visits ? (
          <LoadingText />
        ) : saved ? (
          <>
            <p role="status" className="text-sm text-text-h">
              Visit saved. It shows on {unitCount > 1 ? `all ${unitCount} units` : 'every unit'} at {location.name} and on the house manager's schedule, and he gets an alert if he has alerts on.
            </p>
            <SubmissionActions>
              <SubmissionButton variant="primary" className="min-h-[44px]" onClick={onClose}>Done</SubmissionButton>
            </SubmissionActions>
          </>
        ) : (
          <>
            {already.length > 0 && (
              <div className="mb-2 rounded-[8px] bg-pill-bg px-3 py-2 text-[13px] text-text">
                <span className="font-semibold text-text-h">Already scheduled here</span>
                {already.slice(0, 4).map((v) => {
                  const time = visitTimeText({ date: v.visit_date, time: v.visit_time, tz: location.timezone })
                  return (
                    <div key={v.id} className="[overflow-wrap:anywhere]">
                      {v.kind}, {formatDateStr(v.visit_date)}{time.label ? ` ${time.label}` : ''}
                    </div>
                  )
                })}
              </div>
            )}
            <VisitForm
              unit={stand}
              visits={visits}
              contacts={contacts}
              locationName={location.name}
              timezone={location.timezone}
              locationOnly
              locationUnitCount={unitCount}
              onCancel={onClose}
              onSaved={() => { reload(); setSaved(true) }}
            />
          </>
        )}
      </ModalCard>
    </Modal>
  )
}

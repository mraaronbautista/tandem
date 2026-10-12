import { CalendarPlus, MapPin } from 'lucide-react'
import { formatDateStr } from '../lib/rentals'
import { todayInZone, visitTimeText } from '../lib/locationTime'
import { zoneAbbreviation } from '../lib/timezone'

// The next scheduled visit that belongs to the whole location (not one unit),
// judged by the location's own calendar day.
function nextLocationVisit(visits, location) {
  const today = todayInZone(location.timezone)
  return (visits || [])
    .filter((v) => v.work_site_id === location.id && v.status === 'scheduled' && v.visit_date >= today)
    .sort((a, b) => a.visit_date.localeCompare(b.visit_date) || (a.visit_time || '').localeCompare(b.visit_time || ''))[0]
}

// A slim line at the top of Rentals, one per physical location that has a
// unit in the current view. "Schedule visit" books a visit for the whole
// location (camera setup, a gate, a roof), shown on every unit there and on
// the house manager's schedule, without opening a unit first.
export default function RentalLocations({ locations, units, visibleUnitIds, visits, onSchedule }) {
  const shown = (locations || []).filter((l) => (units || []).some((u) => u.work_site_id === l.id && visibleUnitIds.has(u.id)))
  if (!shown.length) return null
  return (
    <section aria-label="Locations" className="flex min-w-0 flex-col gap-1.5">
      {shown.map((location) => {
        const unitCount = (units || []).filter((u) => u.work_site_id === location.id && u.active !== false).length
        const next = nextLocationVisit(visits, location)
        const time = next ? visitTimeText({ date: next.visit_date, time: next.visit_time, tz: location.timezone }) : null
        return (
          <div key={location.id} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-[10px] border border-border bg-card-bg px-3.5 py-2">
            <span className="min-w-0 text-[13px] text-text [overflow-wrap:anywhere]">
              <MapPin size={14} aria-hidden="true" className="mr-1.5 inline align-[-2px]" />
              <strong className="font-semibold text-text-h">{location.name}</strong>
              {' '}
              · {unitCount} unit{unitCount === 1 ? '' : 's'} · {zoneAbbreviation(location.timezone)} ·{' '}
              {next ? `Next: ${next.kind}, ${formatDateStr(next.visit_date)}${time.label ? ` ${time.label}` : ''}` : 'no building-wide visits coming up'}
            </span>
            <button
              type="button"
              className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-sm border border-border-accent bg-transparent px-2.5 text-[13px] font-semibold text-accent-text"
              onClick={() => onSchedule(location)}
            >
              <CalendarPlus size={15} aria-hidden="true" /> Schedule visit
            </button>
          </div>
        )
      })}
    </section>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { CalendarCheck, ClipboardCheck, LogIn, LogOut, Phone, Sparkles, Wrench } from 'lucide-react'
import { todayDateStr } from '../lib/rentals'
import { formatVisitTime } from '../lib/unitTimeline'
import {
  NO_LOCATION,
  SCHEDULE_DAYS,
  dayHeading,
  fetchStaffSchedule,
  groupScheduleByDay,
  isScheduleMissing,
  scheduleLocations,
  telHref,
} from '../lib/staffSchedule'
import { friendlyError } from '../lib/friendlyError'
import LoadingText from './LoadingText'

const CHIP = 'min-h-10 cursor-pointer rounded-full border px-3.5 text-[13px] [overflow-wrap:anywhere]'

function visitIcon(kind) {
  if (/clean/i.test(kind)) return Sparkles
  if (/repair|plumb|fix|handy|electric|hvac|maint/i.test(kind)) return Wrench
  if (/inspect/i.test(kind)) return ClipboardCheck
  return CalendarCheck
}

function describe(row) {
  const place = row.unit_name || (row.location_name ? `Whole building, ${row.location_name}` : 'Whole building')
  if (row.kind === 'move_out') {
    return { Icon: LogOut, headline: `${row.title || 'Tenant'} moves out`, place }
  }
  if (row.kind === 'move_in') {
    return { Icon: LogIn, headline: `${row.title || 'Tenant'} moves in`, place }
  }
  return { Icon: visitIcon(row.title), headline: row.title, place }
}

// The house manager's read-only view of what is happening at the units:
// move-ins, move-outs and the cleaners and vendors coming. It reads only
// through staff_schedule(), a narrow database function; nothing here can
// change anything.
export default function StaffScheduleView() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [locationId, setLocationId] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const today = todayDateStr()

  useEffect(() => {
    let cancelled = false
    let generation = 0
    async function load() {
      const version = ++generation
      try {
        const data = await fetchStaffSchedule(todayDateStr())
        if (!cancelled && version === generation) { setRows(data); setError('') }
      } catch (err) {
        if (!cancelled && version === generation) {
          setError(isScheduleMissing(err)
            ? 'The schedule is not set up yet. Ask Ada or Aaron to finish setting it up, then try again.'
            : friendlyError(err))
        }
      }
    }
    // Staff cannot subscribe to rental tables, so refresh whenever the phone
    // wakes up or reconnects, and every few minutes while it stays open.
    function refreshWhenVisible() {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)
    window.addEventListener('online', refreshWhenVisible)
    const timer = setInterval(refreshWhenVisible, 5 * 60 * 1000)
    load()
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
      window.removeEventListener('online', refreshWhenVisible)
    }
  }, [reloadKey])

  const locations = useMemo(() => scheduleLocations(rows || []), [rows])
  // A filter whose location no longer has anything coming up falls back to all.
  const activeFilter = locations.some((l) => l.id === locationId) ? locationId : null
  const days = useMemo(() => groupScheduleByDay(rows || [], activeFilter), [rows, activeFilter])

  if (rows === null && !error) return <LoadingText />

  if (rows === null) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="error">{error}</p>
        <button
          type="button"
          className="min-h-10 cursor-pointer rounded-sm border border-border bg-card-bg px-3 text-sm text-text-h"
          onClick={() => setReloadKey((k) => k + 1)}
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] opacity-80">
        The next {SCHEDULE_DAYS} days: tenants moving in or out, and who is coming to the units.
      </p>

      {error && <p className="error">{error} Showing what loaded last.</p>}

      {locations.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by location">
          <button
            type="button"
            className={`${CHIP} ${activeFilter === null ? 'border-accent bg-[var(--period-tab-active-bg)] font-semibold text-accent-text' : 'border-border bg-card-bg text-text'}`}
            aria-pressed={activeFilter === null}
            onClick={() => setLocationId(null)}
          >
            All
          </button>
          {locations.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`${CHIP} ${activeFilter === l.id ? 'border-accent bg-[var(--period-tab-active-bg)] font-semibold text-accent-text' : 'border-border bg-card-bg text-text'}`}
              aria-pressed={activeFilter === l.id}
              onClick={() => setLocationId(l.id)}
            >
              {l.name}
            </button>
          ))}
        </div>
      )}

      {days.length === 0 ? (
        <p className="text-sm opacity-80">
          {activeFilter
            ? activeFilter === NO_LOCATION
              ? 'Nothing coming up at units without a location.'
              : 'Nothing coming up at this location in the next 60 days.'
            : `Nothing is scheduled in the next ${SCHEDULE_DAYS} days. Move-ins, move-outs and visits that Ada or Aaron add will show up here.`}
        </p>
      ) : (
        days.map((day) => (
          <section key={day.date} className="flex flex-col gap-2">
            <h2 className="m-0 text-[13px] font-semibold uppercase tracking-wide text-text-h">
              {dayHeading(day.date, today)}
            </h2>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {day.items.map((row, i) => {
                const { Icon, headline, place } = describe(row)
                const href = telHref(row.phone)
                const who = [row.who, row.trade].filter(Boolean).join(' · ')
                return (
                  <li
                    key={`${row.kind}-${day.date}-${i}`}
                    className="flex min-w-0 gap-3 rounded-[12px] border border-border bg-card-bg p-3"
                  >
                    <Icon size={18} className="mt-0.5 flex-none text-accent-text" aria-hidden="true" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 font-semibold text-text-h [overflow-wrap:anywhere]">{headline}</span>
                        {row.event_time && (
                          <span className="flex-none text-[13px] tabular-nums">{formatVisitTime(row.event_time)}</span>
                        )}
                      </div>
                      <span className="text-[13px] opacity-80 [overflow-wrap:anywhere]">
                        {place}
                        {row.unit_name && row.location_name ? ` · ${row.location_name}` : ''}
                      </span>
                      {who && <span className="text-[13px] [overflow-wrap:anywhere]">{who}</span>}
                      {row.note && <span className="text-[13px] opacity-80 [overflow-wrap:anywhere]">{row.note}</span>}
                      {href && (
                        <a
                          href={href}
                          className="mt-1 inline-flex min-h-10 items-center gap-1.5 self-start text-[13px] font-semibold text-accent-text"
                        >
                          <Phone size={14} aria-hidden="true" /> {row.phone}
                        </a>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}

import { getWeekDays } from '../lib/tasks'

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// No header of its own — TaskBoard.jsx's persistent month/year header
// (the "‹ August 2026 ›" row, always visible regardless of view mode)
// already gives the surrounding context, so this is just the day-picker
// strip on its own.
//
// Always the 7 days (Sun-Sat) of the week containing `selectedDate` —
// same getWeekDays() Week mode already uses, so the strip and the Week
// list never disagree about which week "current" means. This replaces an
// earlier version that scrolled through a much longer fixed window of
// days centered on today: since the days shown here track the selection
// rather than a hardcoded window around today, jumping selectedDate
// forward (e.g. picking a day in MonthView, or TaskBoard.jsx navigating
// here right after creating a future-dated task) brings that day's whole
// week into view automatically, no manual scrolling required to find it.
export default function DateStrip({ selectedDate, onSelect }) {
  const today = startOfDay(new Date())
  const days = getWeekDays(selectedDate)

  return (
    <div className="date-strip">
      <div className="date-strip-scroller">
        {days.map((d) => {
          const selected = isSameDay(d, selectedDate)
          const isToday = isSameDay(d, today)
          return (
            <button
              key={d.toISOString()}
              className={`date-strip-day${selected ? ' date-strip-day-selected' : ''}${isToday ? ' date-strip-day-today' : ''}`}
              onClick={() => onSelect(startOfDay(d))}
            >
              <span className="date-strip-weekday">{WEEKDAY[d.getDay()]}</span>
              <span className="date-strip-number">{d.getDate()}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

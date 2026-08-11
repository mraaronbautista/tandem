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
// Always the 7 days (Sun-Sat) of the real current week — fixed, not tied
// to `selectedDate`/whatever's being browsed elsewhere (Month nav, a task
// landing on a future date, etc.). Picking a day outside this week still
// works via those other paths (MonthView, the month nav header); this
// strip just doesn't try to follow along and re-scope itself to match.
export default function DateStrip({ selectedDate, onSelect }) {
  const today = startOfDay(new Date())
  const days = getWeekDays(today)

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

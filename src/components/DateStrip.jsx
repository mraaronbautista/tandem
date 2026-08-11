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
// (the "[August 2026 ⌄] ‹›" row, always visible regardless of view mode)
// already gives the surrounding context, so this is just the day-picker
// strip on its own.
//
// Shows the 7 days (Sun-Sat) of the week containing `selectedDate`, not
// necessarily the real current week. This keeps it in sync with the
// header's ‹/› week-step arrows and with picking a day in
// DatePickerModal — both of those change `selectedDate`, and the strip
// re-scopes itself to match so the visible week always reflects what's
// actually selected. `today` is still tracked separately, only to
// highlight the current day when it happens to fall in the displayed week.
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

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
    <div className="mb-[18px]">
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const selected = isSameDay(d, selectedDate)
          const isToday = isSameDay(d, today)
          return (
            <button
              key={d.toISOString()}
              className="flex cursor-pointer flex-col items-center gap-1 rounded-[12px] border-0 bg-transparent py-1.5 text-text [font:inherit] transition-transform duration-[120ms] ease-tactile active:scale-[0.94]"
              onClick={() => onSelect(startOfDay(d))}
            >
              <span className="text-[11px] uppercase opacity-60">{WEEKDAY[d.getDay()]}</span>
              <span
                className={`flex h-[30px] w-[30px] items-center justify-center rounded-full border font-semibold text-[15px] ${
                  selected
                    ? 'border-transparent bg-accent text-white'
                    : isToday
                      ? 'border-accent text-text-h'
                      : 'border-transparent text-text-h'
                }`}
              >
                {d.getDate()}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

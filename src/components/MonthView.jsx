const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function pad(n) {
  return String(n).padStart(2, '0')
}

function toDateStr(year, month, day) {
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

// Weeks as 7-cell rows (Sun-Sat), padded with `null` before day 1 and
// after the month's last day — same grid-building approach as
// RentalCalendar.jsx's buildWeeks(), duplicated rather than shared since
// the two calendars otherwise have nothing in common (bookings vs. task
// counts, colored bars vs. a plain dot).
function buildWeeks(year, month) {
  const numDays = new Date(year, month + 1, 0).getDate()
  const startWeekday = new Date(year, month, 1).getDay()
  const cells = [...Array(startWeekday).fill(null), ...Array.from({ length: numDays }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

// The Month view mode's calendar — a plain dot per day with any tasks,
// not a mini agenda (that's what Day/Multi-Day/Week are for). Clicking a
// day both selects it and drops back to Day mode, the standard
// drill-down pattern: Month is for orienting "what does this month look
// like," not for reading task titles.
export default function MonthView({ monthDate, tasksByDay, selectedDate, onSelectDay }) {
  const year = monthDate.getFullYear()
  const month = monthDate.getMonth()
  const weeks = buildWeeks(year, month)
  const todayStr = toDateStr(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())
  const selectedStr = toDateStr(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate())

  return (
    <div className="month-view-grid">
      {WEEKDAY_LABELS.map((label) => (
        <div key={label} className="month-view-weekday">
          {label}
        </div>
      ))}

      {weeks.map((week, weekIndex) =>
        week.map((day, col) => {
          if (day === null) return <div key={`${weekIndex}-${col}`} className="month-view-day-empty" />

          const dateStr = toDateStr(year, month, day)
          const count = tasksByDay.get(dateStr)?.length || 0
          const isToday = dateStr === todayStr
          const isSelected = dateStr === selectedStr
          const classes = ['month-view-day']
          if (isToday) classes.push('month-view-day-today')
          if (isSelected) classes.push('month-view-day-selected')

          return (
            <button
              key={dateStr}
              type="button"
              className={classes.join(' ')}
              onClick={() => onSelectDay(new Date(year, month, day))}
            >
              <span>{day}</span>
              {count > 0 && <span className="month-view-day-dot" />}
            </button>
          )
        }),
      )}
    </div>
  )
}

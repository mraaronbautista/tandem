import { isAllDayTask } from '../lib/tasks'
import { PRIORITY_COLOR, PRIORITY_LABEL } from '../lib/priorityColors'
import { useMediaQuery } from '../lib/useMediaQuery'
import { DEFAULT_TIMEZONE, splitDueDateInZone } from '../lib/timezone'
import PriorityDot from './PriorityDot'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// However many chips reliably fit a cell before "+N more" reads better
// than a cramped fourth line — matches how tall .month-view-day ends up
// at typical desktop widths.
const MAX_VISIBLE_TASKS = 3

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
// previews, colored bars vs. task chips).
function buildWeeks(year, month) {
  const numDays = new Date(year, month + 1, 0).getDate()
  const startWeekday = new Date(year, month, 1).getDay()
  const cells = [...Array(startWeekday).fill(null), ...Array.from({ length: numDays }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

// The time a task's chip shows — always due_date, the same field that
// placed it on this day (see groupTasksByDay in tasks.js), whether or
// not the task is actually done yet. A still-open All Day task pinned to
// this date (see isAllDayTask) shows "All day" instead of the literal
// midnight it's stored at.
function timeLabel(task, displayTimezone) {
  if (task.status !== 'done' && isAllDayTask(task)) return 'All day'
  return new Date(task.due_date).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: displayTimezone,
  })
}

// The whole point of Month is a bird's-eye view of what's coming up
// across the month, not just "which days have anything at all" — so on
// desktop, where a day cell actually has room, each cell previews real
// task chips (title + time, capped at MAX_VISIBLE_TASKS with a "+N more"
// overflow) rather than a plain dot. Mobile's cells are far too narrow
// for that: a chip's title/time text was shrinking to an unreadable
// sliver (or nothing at all) once squeezed into a ~50px-wide column, so
// below the 900px breakpoint this falls back to just a task count per
// day instead — still answers "is this day busy," without pretending
// there's room to preview which tasks. Clicking a day (anywhere in its
// cell) both selects it and drops back to Day mode either way, the
// standard drill-down pattern, so the actual task list is never more
// than one tap away.
export default function MonthView({ monthDate, tasksByDay, selectedDate, onSelectDay, displayTimezone = DEFAULT_TIMEZONE }) {
  const isDesktop = useMediaQuery('(min-width: 900px)')
  const year = monthDate.getFullYear()
  const month = monthDate.getMonth()
  const weeks = buildWeeks(year, month)
  const todayStr = splitDueDateInZone(new Date().toISOString(), displayTimezone).due_date
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
          const dayTasks = tasksByDay.get(dateStr) || []
          const isToday = dateStr === todayStr
          const isSelected = dateStr === selectedStr
          const classes = ['month-view-day']
          if (isToday) classes.push('month-view-day-today')
          if (isSelected) classes.push('month-view-day-selected')

          const visible = dayTasks.slice(0, MAX_VISIBLE_TASKS)
          const hiddenCount = dayTasks.length - visible.length

          return (
            <button
              key={dateStr}
              type="button"
              className={classes.join(' ')}
              onClick={() => onSelectDay(new Date(year, month, day))}
            >
              <span className="month-view-day-number">{day}</span>

              {isDesktop ? (
                visible.length > 0 && (
                  <div className="month-view-day-tasks">
                    {visible.map((task) => (
                      <span key={task.id} className="month-view-task-chip">
                        <PriorityDot
                          size="compact"
                          color={PRIORITY_COLOR[task.priority]}
                          title={PRIORITY_LABEL[task.priority]}
                        />
                        <span className="month-view-task-title">{task.title}</span>
                        <span className="month-view-task-time">{timeLabel(task, displayTimezone)}</span>
                      </span>
                    ))}
                    {hiddenCount > 0 && <span className="month-view-day-more">{hiddenCount} more</span>}
                  </div>
                )
              ) : (
                dayTasks.length > 0 && (
                  <span className="month-view-day-count">
                    {dayTasks.length} {dayTasks.length === 1 ? 'task' : 'tasks'}
                  </span>
                )
              )}
            </button>
          )
        }),
      )}
    </div>
  )
}

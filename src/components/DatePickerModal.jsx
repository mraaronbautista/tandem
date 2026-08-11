import { useState } from 'react'
import Modal from './Modal'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// Weeks as 7-cell rows (Sun-Sat), padded with `null` before day 1 and
// after the month's last day — same approach as MonthView.jsx and
// RentalCalendar.jsx build independently. Duplicated again rather than
// shared: this grid only ever shows plain day numbers, nothing in common
// with either of those (task chips, booking bars) beyond the ~8-line
// padding math itself.
function buildWeeks(year, month) {
  const numDays = new Date(year, month + 1, 0).getDate()
  const startWeekday = new Date(year, month, 1).getDay()
  const cells = [...Array(startWeekday).fill(null), ...Array.from({ length: numDays }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

// Opened by clicking the header's "August 2026" label — the header's own
// ‹ › arrows step by week now (see TaskBoard.jsx's shiftWeek), so this is
// the only way left to jump straight to an arbitrary month/date, e.g.
// finding a future appointment DateStrip alone can't reach since it's
// fixed to just the real current week.
export default function DatePickerModal({ selectedDate, onSelect, onClose }) {
  const [viewDate, setViewDate] = useState(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1))
  const today = new Date()

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const weeks = buildWeeks(year, month)
  const label = viewDate.toLocaleDateString([], { month: 'long', year: 'numeric' })

  function shiftMonth(delta) {
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1))
  }

  return (
    <Modal onClose={onClose}>
      <div className="submission-modal date-picker-modal">
        <div className="date-picker-modal-header">
          <div className="month-nav-row">
            <button type="button" className="icon-button" onClick={() => shiftMonth(-1)} title="Previous month">
              ‹
            </button>
            <span className="month-nav-label">{label}</span>
            <button type="button" className="icon-button" onClick={() => shiftMonth(1)} title="Next month">
              ›
            </button>
          </div>
          <button type="button" className="icon-button date-picker-close" onClick={onClose} title="Close">
            ×
          </button>
        </div>

        <div className="date-picker-grid">
          {WEEKDAY_LABELS.map((wd) => (
            <div key={wd} className="date-picker-weekday">
              {wd}
            </div>
          ))}

          {weeks.map((week, weekIndex) =>
            week.map((day, col) => {
              if (day === null) return <div key={`${weekIndex}-${col}`} className="date-picker-day-empty" />
              const date = new Date(year, month, day)
              const classes = ['date-picker-day']
              if (isSameDay(date, today)) classes.push('date-picker-day-today')
              if (isSameDay(date, selectedDate)) classes.push('date-picker-day-selected')
              return (
                <button key={day} type="button" className={classes.join(' ')} onClick={() => onSelect(date)}>
                  {day}
                </button>
              )
            }),
          )}
        </div>
      </div>
    </Modal>
  )
}

import { useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import Modal from './Modal'
import IconButton from './IconButton'
import { MonthNavRow, MonthNavLabel } from './MonthNavRow'
import ModalCard from './ModalCard'

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
      <ModalCard modifier="date-picker-modal">
        <div className="flex items-center justify-between">
          <MonthNavRow>
            <IconButton onClick={() => shiftMonth(-1)} title="Previous month" aria-label="Previous month">
              <ChevronLeft size={14} />
            </IconButton>
            <MonthNavLabel>{label}</MonthNavLabel>
            <IconButton onClick={() => shiftMonth(1)} title="Next month" aria-label="Next month">
              <ChevronRight size={14} />
            </IconButton>
          </MonthNavRow>
          {/* .date-picker-close carried no CSS rule of its own (confirmed
              via grep) — dropped, since IconButton alone already
              reproduces .icon-button's full styling with nothing left
              for that modifier to have added. */}
          <IconButton onClick={onClose} title="Close" aria-label="Close">
            <X size={14} />
          </IconButton>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((wd) => (
            <div key={wd} className="pb-1 text-center text-[11px] font-semibold opacity-55">
              {wd}
            </div>
          ))}

          {weeks.map((week, weekIndex) =>
            week.map((day, col) => {
              if (day === null) return <div key={`${weekIndex}-${col}`} className="invisible flex aspect-square items-center justify-center rounded-[8px] border-0 bg-transparent text-text-h [font:inherit]" />
              const date = new Date(year, month, day)
              // bg-accent/bg-transparent (and text-white/text-text-h) must
              // never both land in the same class string — two utilities
              // targeting the same CSS property resolve by Tailwind's
              // generated stylesheet order, not by position here, so
              // "selected" previously appended bg-accent text-white on top
              // of the base's own bg-transparent text-text-h and lost the
              // background (transparent won) while winning the text color
              // (white won) — invisible white text on no fill. Same class
              // of bug PeriodTabs.jsx's activeClasses ternary already
              // avoids; kept mutually exclusive here the same way.
              const classes = [
                'flex aspect-square cursor-pointer items-center justify-center rounded-[8px] border-0 [font:inherit]',
                isSameDay(date, selectedDate) ? 'bg-accent text-white' : 'bg-transparent text-text-h',
              ]
              if (isSameDay(date, today)) classes.push('font-bold shadow-[inset_0_0_0_1px_var(--accent)]')
              return (
                <button key={day} type="button" className={classes.join(' ')} onClick={() => onSelect(date)}>
                  {day}
                </button>
              )
            }),
          )}
        </div>
      </ModalCard>
    </Modal>
  )
}

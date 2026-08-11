import { useEffect, useRef } from 'react'

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
export default function DateStrip({ selectedDate, onSelect }) {
  const scrollerRef = useRef(null)
  const today = startOfDay(new Date())

  // A generous scrollable window — a month of history to browse back
  // through, a full year ahead to plan against (not truly endless, but
  // far enough out that hitting the edge scrolling forward isn't a
  // realistic concern for a two-person household planner).
  const days = []
  for (let i = -30; i <= 365; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() + i)
    days.push(d)
  }

  // Anchors on today, not whatever's selected — the strip should always
  // open with today at the left edge (ready to scroll forward into the
  // year ahead) rather than centering around a selection that may be
  // days away, which used to leave today off-screen.
  useEffect(() => {
    scrollerRef.current?.querySelector('.date-strip-day-today')?.scrollIntoView({ inline: 'start', block: 'nearest' })
  }, [])

  return (
    <div className="date-strip">
      <div className="date-strip-scroller" ref={scrollerRef}>
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

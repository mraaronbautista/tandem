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

export default function DateStrip({ selectedDate, onSelect, headerRight }) {
  const scrollerRef = useRef(null)
  const today = startOfDay(new Date())

  // A generous scrollable window — a month of history to browse back
  // through, two weeks ahead to preview what's coming.
  const days = []
  for (let i = -30; i <= 14; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() + i)
    days.push(d)
  }

  useEffect(() => {
    scrollerRef.current?.querySelector('.date-strip-day-selected')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [])

  const headerLabel = selectedDate.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="date-strip">
      <div className="date-strip-header-row">
        <h2 className="date-strip-header">{headerLabel}</h2>
        {headerRight}
      </div>
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

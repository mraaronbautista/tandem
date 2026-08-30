import { useMemo, useState } from 'react'
import { isAllDayTask } from '../lib/tasks'
import { DEFAULT_TIMEZONE, splitDueDateInZone, zoneAbbreviation } from '../lib/timezone'
import { WHO_LABEL } from '../lib/whoLabels'
import Modal from './Modal'
import { PeriodTabs, PeriodTab } from './PeriodTabs'

// "Tue, Aug 25, 2026" from a plain 'YYYY-MM-DD' — parsed as local
// calendar fields (not `new Date(dateStr)`, which reads a bare date as
// UTC midnight and can roll back a day depending on the viewer's own
// offset), since dateStr here is already the *due_timezone's* calendar
// day, not tied to whichever zone the viewer happens to be in.
function dayHeaderLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

// Shown in the task's own due_timezone, same reasoning (and same fix) as
// TaskRow.jsx's dueLabel — this list exists specifically to let someone
// double-check "is this actually scheduled right," which a silently
// viewer-converted time would defeat.
function timeLabel(task) {
  const tz = task.due_timezone || DEFAULT_TIMEZONE
  const zone = zoneAbbreviation(tz)
  if (isAllDayTask(task)) {
    if (!task.duration_minutes) return 'All day'
    const endDate = new Date(new Date(task.due_date).getTime() + task.duration_minutes * 60000)
    const endDay = splitDueDateInZone(endDate.toISOString(), tz).due_date
    return `All day, through ${dayHeaderLabel(endDay)}`
  }
  const fmt = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })
  const start = new Date(task.due_date)
  if (!task.duration_minutes) return `${fmt(start)} ${zone}`
  const end = new Date(start.getTime() + task.duration_minutes * 60000)
  // Compared as calendar dates in due_timezone, not browser-local — same
  // fix as TaskRow.jsx's dueLabel: a bare "9:00 AM–9:00 AM" for a task
  // whose duration actually spans multiple days reads as same-day and
  // hides exactly the kind of scheduling mistake this export exists to
  // catch.
  const startDay = splitDueDateInZone(task.due_date, tz).due_date
  const endDay = splitDueDateInZone(end.toISOString(), tz).due_date
  if (endDay !== startDay) return `${fmt(start)} – ${fmt(end)} ${zone}, through ${dayHeaderLabel(endDay)}`
  return `${fmt(start)}–${fmt(end)} ${zone}`
}

// One line per task, grouped under a day header (the due_timezone's own
// calendar day, matching timeLabel above) so same-day tasks visually
// cluster the same way the app's own Today/Week view does — dateless
// tasks trail in their own group at the end, same sort order Bulk
// Edit's own task picker already uses.
function buildExportText(tasks) {
  const sorted = [...tasks].sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0
    if (!a.due_date) return 1
    if (!b.due_date) return -1
    return new Date(a.due_date) - new Date(b.due_date)
  })

  const lines = []
  let currentDayKey
  for (const task of sorted) {
    const dayKey = task.due_date ? splitDueDateInZone(task.due_date, task.due_timezone || DEFAULT_TIMEZONE).due_date : null
    if (dayKey !== currentDayKey) {
      if (lines.length) lines.push('')
      lines.push(dayKey ? dayHeaderLabel(dayKey) : 'No date')
      currentDayKey = dayKey
    }
    const who = WHO_LABEL[task.who] || task.who
    const done = task.status === 'done' ? ' [Completed]' : ''
    const time = task.due_date ? timeLabel(task) : 'No date'
    lines.push(`  ${time} — [${who}] ${task.title}${done}`)
  }
  return lines.length ? lines.join('\n') : 'No tasks match this filter.'
}

// A plain read-only dump of every task's title/date/time/timezone —
// meant to be copied out and pasted somewhere else entirely (another
// app, a note, back to an AI) to sanity-check the schedule at a glance,
// not something the app itself parses back in (unlike Bulk add's own
// paste format, which this deliberately echoes the shape of anyway,
// since it's a familiar layout already established in this app).
export default function TaskExportForm({ tasks, onClose }) {
  // Defaults to All, not the signed-in member's own tasks (unlike Bulk
  // Add's Who picker) — double-checking a shared schedule is normally
  // about seeing everything at once, not just one person's slice of it.
  const [whoFilter, setWhoFilter] = useState('all')
  const [includeDone, setIncludeDone] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (!includeDone && t.status === 'done') return false
      if (whoFilter !== 'all' && t.who !== whoFilter) return false
      return true
    })
  }, [tasks, whoFilter, includeDone])

  const text = useMemo(() => buildExportText(filtered), [filtered])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setError('')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('Could not copy — your browser may be blocking clipboard access.')
    }
  }

  function handleDownload() {
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tandem-tasks-export-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Modal onClose={onClose}>
      <div className="submission-modal task-export-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Export tasks</h2>

        <PeriodTabs>
          <PeriodTab active={whoFilter === 'yours'} onClick={() => setWhoFilter('yours')}>
            {WHO_LABEL.yours}
          </PeriodTab>
          <PeriodTab active={whoFilter === 'assistant'} onClick={() => setWhoFilter('assistant')}>
            {WHO_LABEL.assistant}
          </PeriodTab>
          <PeriodTab active={whoFilter === 'all'} onClick={() => setWhoFilter('all')}>
            All
          </PeriodTab>
        </PeriodTabs>

        <label className="task-export-include-done">
          <input type="checkbox" checked={includeDone} onChange={(e) => setIncludeDone(e.target.checked)} />
          Include completed tasks
        </label>

        <textarea className="task-export-textarea" value={text} readOnly onClick={(e) => e.target.select()} />

        {error && <p className="error">{error}</p>}

        <div className="submission-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" onClick={handleDownload}>
            Download .txt
          </button>
          <button type="button" className="submission-save" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy to clipboard'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

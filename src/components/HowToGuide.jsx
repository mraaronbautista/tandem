import { useState } from 'react'
import Modal from './Modal'

const SECTIONS = [
  {
    title: 'Today',
    items: [
      'The default view — a daily planner grouped into All Day, Overdue, and the selected day\'s tasks.',
      'Tap a task to check it off, or tap the row to open its details, checklist, and comments.',
      'Switch days with the date strip up top; switch whose tasks you\'re viewing with the All / Ada / Aaron picker.',
    ],
  },
  {
    title: 'Adding a task',
    items: [
      'Tap the + button to open the new task form.',
      'Set a due date/time and optional duration to get a time range, or check "All day" for something with no specific time.',
      'Recurring tasks (daily/weekly/monthly) spawn their next occurrence automatically once the current one is marked done.',
    ],
  },
  {
    title: 'Rentals',
    items: [
      'Tracks occupancy and finances for Awa Rentalz.',
      'Calendar: click a unit tab to switch units, click a booked day to view or delete that booking.',
      'Financials: monthly revenue vs. expenses and savings goal progress.',
      'Overview: every unit\'s current status — occupied through a date, or vacant — at a glance.',
    ],
  },
  {
    title: 'Cork Board',
    items: [
      'Pin a task or note with no deadline, just so it doesn\'t get lost.',
      'Private by default — toggle "Share to both boards" to let the other person see it too.',
      'Only you can edit or unpin your own pins, even once shared.',
    ],
  },
  {
    title: 'Reports',
    items: ['Browse past end-of-day / week / month reports, grouped by month.'],
  },
  {
    title: 'The + menu',
    items: [
      'Priorities: set shared planning goals for the day/week/month — each bullet also creates a real task.',
      'Vault: a shared, encrypted password manager — the master password is shared and re-entered every time you open it.',
      'Submit report (Aaron only): log completed work and minutes for the day/week/month.',
      'Nudge (Ada only): pings Aaron immediately for something urgent.',
    ],
  },
  {
    title: 'Notifications',
    items: [
      'Toggle push notifications from this settings menu.',
      'On iPhone, push only works after adding this app to your Home Screen — a regular Safari tab can\'t receive push at all.',
    ],
  },
]

// Collapsible so the guide stays scannable instead of one long wall of
// text — same expand/collapse pattern as EodReportsList's month groups.
// Nested inside SettingsMenu's own Modal; Modal.jsx renders via a portal,
// so this works regardless of the outer modal's DOM position/transform.
export default function HowToGuide({ onClose }) {
  const [expanded, setExpanded] = useState(() => new Set([SECTIONS[0].title]))

  function toggle(title) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

  return (
    <Modal onClose={onClose}>
      <div className="submission-modal" onClick={(e) => e.stopPropagation()}>
        <h2>How this app works</h2>

        <div className="how-to-guide-list">
          {SECTIONS.map((section) => (
            <div key={section.title} className="how-to-guide-section">
              <button type="button" className="how-to-guide-header" onClick={() => toggle(section.title)}>
                <span>{section.title}</span>
                <span>{expanded.has(section.title) ? '▾' : '▸'}</span>
              </button>
              {expanded.has(section.title) && (
                <ul className="how-to-guide-items">
                  {section.items.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        <div className="submission-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}

import { useState } from 'react'
import Modal from './Modal'

// Items starting with 'Tip: ' render distinctly from plain how-to/
// context bullets (see .how-to-guide-tip in App.css) — the prefix itself
// is stripped before display, it's just a marker for which items get the
// different treatment.
const SECTIONS = [
  {
    title: 'Today',
    items: [
      'The home tab — a daily planner grouped into All Day, Overdue, and the selected day\'s tasks.',
      'Day view lays tasks out on a real time-scaled timeline: position and height reflect actual time and duration, and two tasks that overlap render side-by-side so a real conflict is obvious at a glance, not just a badge you might miss.',
      'Tip: a big empty gap between tasks (say, one at 6am and the next at 9pm) automatically collapses into a small marker instead of stretching the whole day out, so a light day doesn\'t turn into endless scrolling.',
      'Tap the "Month Year" label up top to jump straight to any date via the calendar popover; the ‹ › arrows next to it step by week.',
      'Switch whose tasks you\'re viewing with the All / Ada / Aaron picker.',
    ],
  },
  {
    title: 'Adding a task',
    items: [
      'Tap the + button to open the new task form.',
      'A new task defaults to being due "now," rounded up to the next half hour — not a fixed hour unrelated to when you actually added it.',
      'Tip: check "All day" for something with no exact time. You can still give it a specific date (e.g. "call the vet, sometime Tuesday") so it shows up that day without pretending to have a time nobody\'s going to keep — or leave the date blank too and it just floats until done.',
      'Add a duration to get a time range; leave it blank for a plain point-in-time deadline.',
      'Recurring tasks (daily/weekly/monthly) only spawn their next occurrence once the current one is marked done — not generated ahead of time, so you won\'t see next week\'s copy sitting there today.',
    ],
  },
  {
    title: 'Task details',
    items: [
      'Checklist: break a task into subtasks. Mark an item "blocked" (with an optional reason) instead of done, for something that turned out impossible rather than just unfinished.',
      'Comments: ask a question or leave a note on any task — either of you can comment regardless of who created or is assigned it, and files (PDFs, docs, photos, anything) can go on the message itself.',
      'Marking a task done lets you attach a completion note and files as proof of what was actually delivered.',
      'Tip: an "⚠ Overlap" badge means two of your own timed tasks collide — Ada and Aaron having things at the same time isn\'t flagged, since that\'s not a real conflict.',
    ],
  },
  {
    title: 'Rentals',
    items: [
      'Tracks occupancy and finances for Awa Rentalz.',
      'Calendar: switch units via the tabs (or the unit nav on desktop); tap a booked day to view, edit, or delete that booking. A striped cell is a pending request, not yet confirmed.',
      'Tip: record where a booking came from (Airbnb, Furnished Finder, Referral, etc.) when adding or editing it — Financials tallies revenue by source every month, so you can actually see which platform is worth the effort instead of guessing.',
      'Financials: revenue is recognized by upfront charge cycle (roughly every 30 days from check-in), not day-by-day occupancy — a guest still there in month two doesn\'t get double-counted.',
      'Tip: tap any overhead line to edit or delete it, or use "+ Add overhead" — it\'s not a fixed list, keep it current as costs change.',
      'Savings goal progress is a manually-updated number, not calculated from bookings — update it directly in its own edit form.',
      'Overview: every unit\'s status at a glance — occupied through a date, or vacant with the next upcoming booking if there is one.',
    ],
  },
  {
    title: 'Cork Board',
    items: [
      'Pin a task or note with no deadline, so a stray idea doesn\'t get lost.',
      'Private by default — toggle "Share to both boards" to let the other person see it too.',
      'Tip: "Focus today" turns any pin (yours, or shared with you) into a real task due today — so a good idea from last week can actually become something you do.',
      'Only the original author can edit or unpin a pin, even once shared.',
    ],
  },
  {
    title: 'Reports',
    items: [
      'Aaron submits end-of-day/week/month reports; Ada can read them all, grouped by month.',
      'The auto-filled draft only lists what you completed since your last submission for that bucket, not the whole day again, so reopening it doesn\'t duplicate old entries.',
      'Tip: minutes logged is overwritten each time, not added up — match it to your actual time tracker\'s running total rather than trying to sum sessions yourself.',
      'Any files attached as proof of a completed task carry through into the report automatically.',
    ],
  },
  {
    title: 'The + menu',
    items: [
      'Priorities: shared planning goals for the day/week/month — each bullet also creates a real task, so setting a priority isn\'t just a note that gets forgotten. Day priorities are due today; week/month ones are All Day and stick around until done.',
      'Vault: a shared, encrypted password manager. The master password is the same for both of you and has to be re-entered every time you open it — it\'s never saved on the device.',
      'Tip: there\'s no password reset for the vault — if the master password is forgotten, "Reset vault" wipes everything, so keep it somewhere safe.',
      'Submit report (Aaron only) / Nudge (Ada only) — asymmetric on purpose, see Notifications below for why.',
    ],
  },
  {
    title: 'Notifications',
    items: [
      'Toggle push notifications from this settings menu.',
      'Tip: on iPhone, push only works after adding this app to your Home Screen — a regular Safari tab can\'t receive push at all, no matter what\'s toggled here.',
      'Assignment pings are symmetric: whoever gets assigned a task by the other person is notified right away, either direction — assigning yourself a task doesn\'t ping you, since you already know. Completion pings go both ways too.',
      'The green/gray badge next to Settings shows whether Aaron\'s currently working — Aaron can toggle it himself; Ada\'s version is read-only since it\'s self-reported.',
    ],
  },
]

// Accordion — one section open at a time, opening another closes
// whichever was open — instead of an independent expand/collapse per
// section, so the guide stays scannable instead of one long wall of text
// with several sections open at once. Nested inside SettingsMenu's own
// Modal; Modal.jsx renders via a portal, so this works regardless of the
// outer modal's DOM position/transform.
export default function HowToGuide({ onClose }) {
  const [openTitle, setOpenTitle] = useState(SECTIONS[0].title)

  function toggle(title) {
    setOpenTitle((prev) => (prev === title ? null : title))
  }

  return (
    <Modal onClose={onClose}>
      <div className="submission-modal how-to-guide-modal" onClick={(e) => e.stopPropagation()}>
        <h2>How this app works</h2>

        <div className="how-to-guide-list">
          {SECTIONS.map((section) => (
            <div key={section.title} className="how-to-guide-section">
              <button type="button" className="how-to-guide-header" onClick={() => toggle(section.title)}>
                <span>{section.title}</span>
                <span>{openTitle === section.title ? '▾' : '▸'}</span>
              </button>
              {openTitle === section.title && (
                <ul className="how-to-guide-items">
                  {section.items.map((item, i) => {
                    const isTip = item.startsWith('Tip: ')
                    return (
                      <li key={i} className={isTip ? 'how-to-guide-tip' : undefined}>
                        {isTip ? item.slice('Tip: '.length) : item}
                      </li>
                    )
                  })}
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

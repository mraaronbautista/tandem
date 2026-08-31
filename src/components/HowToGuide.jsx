import { useState } from 'react'
import Modal from './Modal'
import { PeriodTabs, PeriodTab } from './PeriodTabs'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

// Items starting with 'Tip: ' render distinctly from plain how-to/
// context bullets (see .how-to-guide-tip in App.css) — the prefix itself
// is stripped before display, it's just a marker for which items get the
// different treatment. Shared by both the Guide and FAQ tabs below.
const SECTIONS = [
  {
    title: 'Getting around',
    items: [
      'Five tabs — Today, Rentals, Reports, Cork Board, Inbox. On a phone they sit in a bar along the bottom; on a tablet or wider screen they fold into the top header next to Settings instead, since there\'s no separate sidebar.',
      'The + button (bottom right) is for one-shot actions, not another tab you browse — Priorities, Bulk add/edit tasks, Vault, plus Submit report (Aaron only) or Nudge (Ada only).',
      'The ⚙️ icon opens Settings: who\'s signed in, notifications, theme, default timezone, and this guide.',
    ],
  },
  {
    title: 'Today',
    items: [
      'The home tab — a daily planner grouped into All Day, Overdue, and the selected day\'s tasks.',
      'Day view lays tasks out on a real time-scaled timeline: position and height reflect actual time and duration, and two tasks that overlap render side-by-side so a real conflict is obvious at a glance, not just a badge you might miss.',
      'Tip: a big empty gap between tasks (say, one at 6am and the next at 9pm) automatically collapses into a small marker instead of stretching the whole day out, so a light day doesn\'t turn into endless scrolling.',
      'Tap the "Month Year" label up top to jump straight to any date via the calendar popover; the ‹ › arrows next to it step by week.',
      'Switch whose tasks you\'re viewing with the All / Ada / Aaron picker.',
      'Day / Week / Month tabs sit above the list. Week always snaps back to the current week when you tap it, even if you were browsing a different one in Day mode — Day and Month keep wherever you last left them. Month shows each day as a small grid cell with up to 3 task chips (plus a "N more" line); it hides the day-picker strip below the tabs since a day-by-day scroller doesn\'t make sense next to a full month grid.',
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
      'A 💬 badge on a task\'s collapsed row means there\'s a question or comment waiting on your reply — open the task to answer it, or check the Inbox tab to see every open one across all tasks in one place.',
    ],
  },
  {
    title: 'Rentals',
    items: [
      'Tracks occupancy and finances for a rental business — tap the company name at the top to switch between Awa Rentalz and Azu Rentals, each with its own separate units, bookings, and financials.',
      'Layout adapts to screen width: on a phone, switch between Calendar / Financials / Overview with tabs, one panel at a time. On a tablet or desktop-width screen, all three show together instead — Calendar and Overview share the main column, Financials stays visible in a column of its own — and you switch units by tapping one in Overview or the calendar\'s own unit-nav arrows rather than tabs.',
      'Calendar: tap a booked day to view, edit, or delete that booking. A striped cell is a pending request, not yet confirmed — it still blocks the dates, but doesn\'t count toward revenue until you confirm it.',
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
      'Only the original author can edit or unpin a pin, even once shared — the other person can see and comment on it, not manage it.',
    ],
  },
  {
    title: 'Inbox',
    items: [
      'Collects every open question or comment across all tasks in one place — the only reliable way to catch a stray 💬 without stumbling onto that specific task first.',
      '"New" — unanswered questions directed at you, shown first. "Resolved" — your own questions that got closed out, either with an actual reply or dismissed with "No reply needed".',
      '"Submissions" — tasks that were finished with a note or file attached as proof, newest first, so you don\'t have to stumble onto the task itself just to see what was submitted.',
      'Tabs above the list (All / New / Resolved / Submissions) narrow it down to one kind at a time — handy once there\'s enough activity that scrolling past everything else gets old.',
      'Tapping an item jumps straight to that task\'s full detail, regardless of which day it\'s on.',
      'Tip: a plain comment that isn\'t really a question can be dismissed with "No reply needed" — no push notification fires for that, since clearing something as not needing a reply isn\'t news worth pinging over.',
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
      'Bulk add/edit tasks: paste in a whole schedule at once on the Add tab instead of one task at a time. One line per task — "date – description" (e.g. "Aug 30 – Renew the lease"), with an optional time or time range right before the dash for anything that needs one ("Aug 28 8am-9am – Plumber at 1072 Rachel"). The Edit tab picks from your existing tasks — filterable to just Ada\'s, just Aaron\'s, or all — to retitle, reassign, re-timezone, reschedule, or delete a batch together.',
      'Tip: the Edit tab\'s Date/Time field has two modes — "Shift by" moves each selected task from its own current date/time by an amount you set (e.g. -1 day for a batch that all needs to move a day earlier), while "Set to" pins every selected task to one exact date and time, dateless ones included.',
      'Tip: "Export tasks" (top-right of that same Bulk add/edit screen) dumps every task\'s title, date, time, and timezone as plain text — filterable, and with a toggle for completed tasks — so you can copy or download it to double-check the whole schedule somewhere else at a glance.',
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

// Real questions grounded in the app's actual (sometimes asymmetric or
// non-obvious) behavior — written from Ada's side, since she's the one
// without an edit/write toggle on several of these (working status,
// reports) and the one running Rentals day to day. Answers call out a
// mobile/desktop split only where the UI actually differs (mainly nav
// placement and the Rentals layout) — most behavior here is identical on
// both, so most answers don't need it.
const FAQS = [
  {
    title: "Why can't I toggle my own \"working\" status?",
    items: [
      'That toggle is Aaron-only, on purpose — "working" is inherently self-reported, so there\'s nothing meaningful for Ada to toggle about her own status. Your side of it is the read-only green/gray badge next to Settings showing whether Aaron\'s currently on.',
    ],
  },
  {
    title: "Why don't I have a \"Submit report\" option?",
    items: [
      'End-of-day/week/month reports are Aaron\'s log of what he worked on — you can read every one of them, grouped by month, from the Reports tab. There\'s nothing for you to submit there.',
      'Tip: if you want to flag something to Aaron rather than read a past report, use Nudge in the + menu instead — that one\'s Ada-only.',
    ],
  },
  {
    title: 'How do I remind Aaron about something?',
    items: [
      'Tap + then Nudge — it sends Aaron a push notification directly. It\'s the Ada-side counterpart to Aaron\'s Submit report action.',
    ],
  },
  {
    title: 'I checked off an overdue task and it vanished from Overdue — did it delete?',
    items: [
      'No — it moved to Today\'s list. A completed task is grouped by when you actually finished it, not its original due date, so a task overdue from last week that you finish today shows up under Today (still with its original due time and a small "Completed" tag) rather than staying buried in Overdue or disappearing.',
    ],
  },
  {
    title: "Why does a task's time look different than what I typed?",
    items: [
      'It shouldn\'t — a task always displays in whatever timezone it was set in (shown as a small badge like "CT" or "PHT" next to the time), not converted to whichever of you happens to be looking at it. If the badge shows the zone you expect, the time next to it is correct as entered.',
      'Tip: if a whole batch of tasks came out in the wrong zone (e.g. you pasted Aaron\'s schedule using your own zone by mistake), Bulk edit → Time zone can reinterpret the same wall-clock time in the correct zone for all of them at once, instead of fixing each one by hand.',
    ],
  },
  {
    title: "How do I see just my tasks, or just Aaron's?",
    items: [
      'The All / Ada / Aaron picker on the Today tab, next to the Day/Week/Month tabs. Bulk edit\'s own task picker has the same three-way filter, separately, for narrowing down which tasks you\'re selecting to edit or delete.',
    ],
  },
  {
    title: "I tapped Week and it jumped to a different week than I was looking at — why?",
    items: [
      'Week always resets to the current week the moment you tap it, so it always answers "how does this week look right now" rather than showing whatever week you last happened to be browsing in Day mode. Day and Month don\'t do this — they keep whatever date you last picked.',
    ],
  },
  {
    title: "What's the difference between checking off a checklist item and marking it blocked?",
    items: [
      'Done means it got finished. Blocked means it turned out not to be doable at all (with an optional reason why) — the two are mutually exclusive, so setting one clears the other.',
    ],
  },
  {
    title: 'How do I add my whole week\'s schedule at once instead of one task at a time?',
    items: [
      'Tap + → Bulk add/edit tasks (the Add tab). One line per task: "date – description", with an optional time or time range right before the dash for anything that needs one ("Aug 28 8am-9am – Plumber at 1072 Rachel"). A live preview shows exactly what will be created before you confirm.',
    ],
  },
  {
    title: 'Can I edit or delete several tasks at once?',
    items: [
      'Yes — same Bulk add/edit tasks screen, on the Edit tab. Filter the list to Ada\'s, Aaron\'s, or all of them, select the ones you want, then either apply a change (title, who, timezone, or notes) across all of them, or hit "Delete N tasks" to remove them together. Deleting asks you to confirm first, since it can\'t be undone.',
    ],
  },
  {
    title: "What does the 💬 badge on a task mean?",
    items: [
      'There\'s an unanswered question or comment on that task directed at you. Open the task to reply, or check the Inbox tab to see every one of these across every task in one place instead of hunting for the badge.',
    ],
  },
  {
    title: 'What are the sections in Inbox?',
    items: [
      '"New" — questions aimed at you with no answer yet, always shown first. "Resolved" — your own questions that got closed out, either an actual reply or dismissed with "No reply needed". "Submissions" — tasks finished with a note or file attached as proof, newest first.',
    ],
  },
  {
    title: "I pinned something on the Cork Board — can Aaron see it?",
    items: [
      'Not unless you share it. New pins are private by default; toggle "Share to both boards" to let Aaron see it too. Even shared, only you can edit or unpin it — he can view and comment, not manage it.',
    ],
  },
  {
    title: 'What does "Focus today" do on a Cork Board pin?',
    items: [
      'It turns that pin into a real task due today, assigned to whoever tapped the button — not necessarily the pin\'s original author, since claiming a shared idea as today\'s work is the point. The pin itself stays on the board untouched, so you can promote it again later if needed.',
    ],
  },
  {
    title: 'I forgot the Vault master password — how do I get back in?',
    items: [
      'There\'s no password-reset flow. The only way out is "Reset vault," which wipes every saved entry and requires typing a confirmation word first — so it\'s worth keeping the shared password written down somewhere safe rather than relying on memory alone.',
    ],
  },
  {
    title: 'Why do I have to re-type the Vault password every time I open it?',
    items: [
      "It's never saved to the device or browser — only kept in memory while the vault happens to be open — so your saved passwords stay unreadable even if a device is lost or a browser session is compromised.",
    ],
  },
  {
    title: "I'm not getting push notifications on my phone — why?",
    items: [
      'On iPhone, push only works from this app after it\'s added to your Home Screen (iOS 16.4+) — a regular Safari tab can\'t receive push at all, no matter what\'s toggled in Settings. Confirm it\'s installed that way first, then check the notification toggle in Settings.',
      'Tip: if you and Aaron ever share a device, check "Signed in as {name}" at the top of Settings before flipping the toggle — it\'s easy to accidentally change the other person\'s notification setting.',
    ],
  },
  {
    title: 'Rentals looks completely different on my phone than on my laptop — is something broken?',
    items: [
      'That\'s expected, not a bug. On a phone, Rentals is three separate tabs (Calendar / Financials / Overview) you flip between one at a time. On a tablet or desktop-width screen, all three show together side by side instead, and unit switching moves from tabs to tapping a unit in the Overview list or using the calendar\'s own unit-nav arrows.',
    ],
  },
  {
    title: 'A guest stayed two months but Financials only shows one lump of revenue — is that right?',
    items: [
      'Yes — revenue is recognized by upfront charge cycle (about every 30 days from check-in, like a security-deposit-style payment), not by counting calendar days of occupancy. A later cycle only counts once there\'s an actual day of stay left beyond it, so a long stay doesn\'t get billed twice at the boundary.',
    ],
  },
  {
    title: 'What does a striped/diagonal booking cell mean on the calendar?',
    items: [
      "A pending request (e.g. an inbound inquiry) rather than a confirmed booking. It still blocks those dates against a double-booking, but it won't count toward revenue until you explicitly confirm it.",
    ],
  },
  {
    title: 'Does the rental savings goal update itself from bookings?',
    items: [
      "No — it's a plain number you update by hand in the goal's own edit form. Two earlier attempts at calculating it automatically from booking revenue both turned out to be more hassle than just editing the total directly.",
    ],
  },
  {
    title: "Why hasn't next week's copy of a recurring task shown up yet?",
    items: [
      'The next occurrence is only created once you mark the current one done — it\'s not generated ahead of time, so you won\'t see it sitting there early.',
    ],
  },
  {
    title: "What does the ⚠ Overlap badge mean, and why doesn't it show when Aaron and I both have something scheduled at the same time?",
    items: [
      'It only flags two of your own timed tasks colliding with each other. You and Aaron having separate tasks at the same time isn\'t treated as a real conflict, so that combination is never flagged.',
    ],
  },
  {
    title: 'How do I change which timezone new tasks default to?',
    items: [
      'Settings (⚙️) → Default timezone. Once set, it\'s used automatically for any new task, priority, or Cork Board pin you create — Aaron bulk-adding your schedule for you uses your saved zone too, not his device\'s.',
    ],
  },
]

// Two independent accordions (Guide sections, FAQ questions) sharing this
// one render path — same "one open at a time" behavior, just against
// whichever list/openTitle/toggle triple the caller passes in, so
// switching the top-level tab doesn't have to reset or merge either
// accordion's own open/closed state into the other's.
function AccordionList({ sections, openTitle, onToggle }) {
  return (
    <div className="flex flex-col gap-1.5">
      {sections.map((section) => (
        <div key={section.title} className="overflow-hidden rounded-[8px] border border-border">
          <button type="button" className="flex w-full cursor-pointer items-center justify-between border-0 bg-pill-bg px-3 py-2.5 text-left text-sm font-semibold text-text-h [font-family:inherit] [font-style:inherit] [font-variant:inherit] [line-height:inherit] transition-colors duration-[180ms] ease-tactile" onClick={() => onToggle(section.title)}>
            <span>{section.title}</span>
            <span>{openTitle === section.title ? '▾' : '▸'}</span>
          </button>
          {openTitle === section.title && (
            <ul className="m-0 flex flex-col gap-1.5 py-2.5 pr-4 pb-3 pl-[30px] text-[13px] opacity-85">
              {section.items.map((item, i) => {
                const isTip = item.startsWith('Tip: ')
                return (
                  <li key={i} className={isTip ? "text-accent [list-style:'💡_']" : undefined}>
                    {isTip ? item.slice('Tip: '.length) : item}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}

// Accordion — one section/question open at a time, opening another closes
// whichever was open — instead of an independent expand/collapse per
// item, so either tab stays scannable instead of one long wall of text
// with several sections open at once. Nested inside SettingsMenu's own
// Modal; Modal.jsx renders via a portal, so this works regardless of the
// outer modal's DOM position/transform.
export default function HowToGuide({ onClose }) {
  const [view, setView] = useState('guide')
  const [openSection, setOpenSection] = useState(SECTIONS[0].title)
  const [openFaq, setOpenFaq] = useState(FAQS[0].title)

  function toggleSection(title) {
    setOpenSection((prev) => (prev === title ? null : title))
  }

  function toggleFaq(title) {
    setOpenFaq((prev) => (prev === title ? null : title))
  }

  return (
    <Modal onClose={onClose}>
      <ModalCard modifier="how-to-guide-modal">
        <h2>How this app works</h2>

        <PeriodTabs>
          <PeriodTab active={view === 'guide'} onClick={() => setView('guide')}>
            Guide
          </PeriodTab>
          <PeriodTab active={view === 'faq'} onClick={() => setView('faq')}>
            FAQ
          </PeriodTab>
        </PeriodTabs>

        {view === 'guide' ? (
          <AccordionList sections={SECTIONS} openTitle={openSection} onToggle={toggleSection} />
        ) : (
          <AccordionList sections={FAQS} openTitle={openFaq} onToggle={toggleFaq} />
        )}

        <SubmissionActions>
          <SubmissionButton onClick={onClose}>Close</SubmissionButton>
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

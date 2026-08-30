import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import {
  fetchTasks,
  createTask,
  updateTask,
  deleteTask,
  getOverdueTasks,
  getTasksForDay,
  getOverlappingTaskIds,
  getWeekDays,
  groupTasksByDay,
  hasUnseenInboxItems,
  INBOX_LAST_VIEWED_KEY,
} from '../lib/tasks'
import { fetchMembers, updateDefaultTimezone } from '../lib/members'
import { setPreferredTimezone } from '../lib/timezone'
import { useMediaQuery } from '../lib/useMediaQuery'
import { pushSupported, getPushSubscription, subscribeToPush, unsubscribeFromPush } from '../lib/pushNotifications'
import { sendNudge } from '../lib/manualNotify'
import { useAuth } from '../lib/AuthContext'
import { WHO_LABEL, whoKeyForName } from '../lib/whoLabels'
import TaskRow from './TaskRow'
import TimelineRow from './TimelineRow'
import DayTimeline from './DayTimeline'
import AllDayRow from './AllDayRow'
import NewTaskForm from './NewTaskForm'
import Modal from './Modal'
import DateStrip from './DateStrip'
import DatePickerModal from './DatePickerModal'
import PullToRefresh from './PullToRefresh'
import WorkingStatusToggle from './WorkingStatusToggle'
import EndOfDayReportForm from './EndOfDayReportForm'
import EodReportsList from './EodReportsList'
import PrioritiesForm from './PrioritiesForm'
import BulkAddTasksForm from './BulkAddTasksForm'
import SettingsMenu from './SettingsMenu'
import RentalsView from './RentalsView'
import VaultView from './VaultView'
import CorkBoardView from './CorkBoardView'
import InboxView from './InboxView'
import MonthView from './MonthView'

const WHO_TABS = [
  { key: 'all', label: 'All' },
  { key: 'yours', label: WHO_LABEL.yours },
  { key: 'assistant', label: WHO_LABEL.assistant },
]

const VIEW_MODES = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
]

function isSameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// "Today"/"Tomorrow" where they apply, otherwise a short weekday+date —
// only used to label day-sections in Week mode (Day mode's single
// section keeps its own special-cased heading below, to preserve its
// existing look).
function daySectionLabel(day, today) {
  if (isSameLocalDay(day, today)) return 'Today'
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (isSameLocalDay(day, tomorrow)) return 'Tomorrow'
  return day.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

// Bottom bar on mobile, folded inline into the header row on wide
// screens (`.header-nav` — see App.css and the isDesktop branch below)
// — the four sections that are actually places you go browse, as
// opposed to the "+" menu's one-shot actions (New task, Priorities,
// Submit report, Nudge, Vault).
const TABS = [
  { key: 'today', icon: '📋', label: 'Today' },
  { key: 'rentals', icon: '🏠', label: 'Rentals' },
  { key: 'reports', icon: '📄', label: 'Reports' },
  { key: 'corkboard', icon: '📌', label: 'Cork Board' },
  { key: 'inbox', icon: '📥', label: 'Inbox' },
]

// The header's page title for every tab except Today (which shows the
// month navigator instead) — "Awa Rentalz" rather than "Rentals" for the
// company name shown inside RentalsView.jsx, so it doesn't just repeat
// the nav item's own label.
const PAGE_LABELS = {
  rentals: 'Awa Rentalz',
  reports: 'Reports',
  corkboard: 'Cork Board',
  inbox: 'Inbox',
}

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export default function TaskBoard({ theme, toggleTheme }) {
  const { session, signOut } = useAuth()
  const isDesktop = useMediaQuery('(min-width: 900px)')
  const [tasks, setTasks] = useState([])
  const [members, setMembers] = useState([])
  const [whoTab, setWhoTab] = useState('all')
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [peekTaskId, setPeekTaskId] = useState(null)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState('')
  const [reportOpen, setReportOpen] = useState(false)
  const [prioritiesOpen, setPrioritiesOpen] = useState(false)
  const [bulkAddOpen, setBulkAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [vaultOpen, setVaultOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('today')
  const [viewMode, setViewMode] = useState('day')
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [inboxLastViewedAt, setInboxLastViewedAt] = useState(() => localStorage.getItem(INBOX_LAST_VIEWED_KEY) || '')

  // Bumping this on every visit (not just once ever) is what lets the nav
  // badge clear as soon as you open the tab, and what lets InboxView know
  // which answers are new since the *previous* visit rather than the very
  // first one.
  useEffect(() => {
    if (activeTab !== 'inbox') return
    const now = new Date().toISOString()
    localStorage.setItem(INBOX_LAST_VIEWED_KEY, now)
    setInboxLastViewedAt(now)
  }, [activeTab])

  // Week always opens on the calendar week containing today, regardless
  // of whatever selectedDate happened to be set to (e.g. from browsing
  // around in Day mode first) — "how does this week's workload look"
  // means starting from now, not wherever you last left the date strip.
  // Day/Month don't get the same reset: Day mode's whole point is
  // picking a specific day, and Month wasn't asked to reset.
  function handleViewModeClick(key) {
    if (key === 'week') setSelectedDate(startOfDay(new Date()))
    setViewMode(key)
  }

  // Tapping the Today nav item is "take me home" — resets back to today's
  // date in Day mode, same reset-to-today idea handleViewModeClick already
  // uses for the Week tab above. Day/Week/Month are all view-modes inside
  // this one tab rather than separate tabs, so this is the only "jump back
  // to today" control needed — you're always already on Today whenever
  // you're deep in Week or Month view, and tapping it again just resets it.
  // Shared by the Today nav tab (tapping it while already there) and the
  // header's own "Today" button below — same destination, two different
  // ways to reach for it depending on whether the bottom nav or the
  // header is already in front of you.
  function resetToToday() {
    setSelectedDate(startOfDay(new Date()))
    setViewMode('day')
  }

  function handleTabClick(key) {
    setActiveTab(key)
    if (key === 'today') resetToToday()
  }

  // The 👋 header icon this triggers (see .header-actions below) is a
  // single tap with no per-click local state of its own — a quick
  // confirmation alert is simpler feedback than adding a "sent" flash
  // state just for this one button.
  async function handleNudge() {
    try {
      await sendNudge()
      alert('Nudge sent to Aaron.')
    } catch {
      // No persistent surface to show this inline on, so alert() is the
      // only option — but the raw Supabase error text isn't meant for a
      // person to read.
      alert("Couldn't send the nudge — try again.")
    }
  }

  useEffect(() => {
    if (pushSupported()) getPushSubscription().then((sub) => setPushEnabled(Boolean(sub)))
  }, [])

  async function handleTogglePush() {
    setPushBusy(true)
    setPushError('')
    try {
      if (pushEnabled) {
        await unsubscribeFromPush()
        setPushEnabled(false)
      } else {
        await subscribeToPush(session.user.id)
        setPushEnabled(true)
      }
    } catch {
      // The browser/OS's own push registration error (e.g. permission
      // blocked, no push service available) isn't meant for an end user
      // to read verbatim — show one plain, actionable sentence instead.
      setPushError("Couldn't update notifications — check your browser's notification permission for this site.")
    } finally {
      setPushBusy(false)
    }
  }

  async function reload() {
    try {
      const data = await fetchTasks()
      setTasks(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function reloadMembers() {
    try {
      setMembers(await fetchMembers())
    } catch (err) {
      // Used to swallow this silently ("attribution just falls back to
      // blank") — true for task attribution, but `me` (derived from
      // `members` below) also gates WorkingStatusToggle and a few other
      // Aaron-only UI bits, which don't degrade to "blank," they just
      // vanish outright with nothing to explain why. A transient failure
      // here (e.g. a PWA resuming from the background mid-reconnect) used
      // to leave `members` empty indefinitely with zero visible trace.
      setError(err.message)
    }
  }

  useEffect(() => {
    reload()
    reloadMembers()

    const tasksChannel = supabase
      .channel('tasks-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => reload())
      .subscribe()

    // So Ada's "working" badge (and anything else about the other
    // person) updates live too — reloadMembers() otherwise only ran once
    // on mount.
    const membersChannel = supabase
      .channel('members-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, () => reloadMembers())
      .subscribe()

    return () => {
      supabase.removeChannel(tasksChannel)
      supabase.removeChannel(membersChannel)
    }
  }, [])

  const me = useMemo(() => members.find((m) => m.id === session.user.id), [members, session])
  const memberName = (id) => members.find((m) => m.id === id)?.display_name

  // Default to your own tasks, not the shared "All" view — you should only
  // see the other person's tasks by deliberately switching to their tab.
  useEffect(() => {
    if (me) setWhoTab(whoKeyForName(me.display_name) || 'all')
  }, [me])

  // Keeps timezone.js's detectDefaultTimezone() in sync with whatever the
  // signed-in member has saved in Settings, so every call site that
  // already relies on that function (TaskForm's emptyTaskForm,
  // CorkBoardView, PrioritiesForm) picks it up without each needing
  // `me`/`members` threaded through as props.
  useEffect(() => {
    setPreferredTimezone(me?.default_timezone)
  }, [me?.default_timezone])

  async function handleChangeDefaultTimezone(timezone) {
    if (!me) return
    await updateDefaultTimezone(me.id, timezone)
    reloadMembers()
  }

  // Whichever "who" filter is active becomes the default for a new task —
  // viewing Ada's list and tapping + New task assumes it's for Ada. On the
  // "All" tab there's no filter context, so default to whoever is logged in.
  const defaultWho =
    whoTab === 'yours' || whoTab === 'assistant' ? whoTab : whoKeyForName(me?.display_name) || 'yours'

  const whoFiltered = useMemo(() => {
    return tasks.filter((t) => whoTab === 'all' || t.who === whoTab)
  }, [tasks, whoTab])

  // All Day is date-agnostic — undated tasks aren't "for" any particular
  // day, so they stay visible no matter which date is selected.
  const allDay = useMemo(() => whoFiltered.filter((t) => t.status !== 'done' && !t.due_date), [whoFiltered])

  const isToday = useMemo(() => selectedDate.getTime() === startOfDay(new Date()).getTime(), [selectedDate])

  // Overdue is a "right now" signal, only ever shown alongside today — not
  // something that quietly disappears once you scroll away from today.
  const overdue = useMemo(() => (isToday ? getOverdueTasks(whoFiltered) : []), [whoFiltered, isToday])

  // Day/Week share one rendering path: a list of day-sections. Day mode
  // is just that list with a single entry, so it doesn't need its own
  // special case here — only its heading (below) differs. Month is a
  // distinct grid, handled separately via tasksByDay.
  const daysToShow = useMemo(() => {
    if (viewMode === 'week') return getWeekDays(selectedDate)
    return [selectedDate]
  }, [viewMode, selectedDate])

  const daySections = useMemo(
    () => daysToShow.map((date) => ({ date, tasks: getTasksForDay(whoFiltered, date) })),
    [daysToShow, whoFiltered],
  )

  // Grouped once for the whole visible month rather than calling
  // getTasksForDay per day inside MonthView's render loop.
  const tasksByDay = useMemo(() => groupTasksByDay(whoFiltered), [whoFiltered])

  // The header's ‹ › arrows step by week, not month — jumping to an
  // arbitrary month is what the date-picker popover (opened by clicking
  // the label itself) is for now; see datePickerOpen below.
  function shiftWeek(delta) {
    setSelectedDate((d) => {
      const next = new Date(d)
      next.setDate(next.getDate() + delta * 7)
      return startOfDay(next)
    })
  }

  function shiftDay(delta) {
    setSelectedDate((d) => {
      const next = new Date(d)
      next.setDate(next.getDate() + delta)
      return startOfDay(next)
    })
  }

  // Swipe left/right on mobile Day view to step selectedDate to the day
  // before/after — same result as tapping the next/previous day in
  // DateStrip, just without needing that day to already be scrolled into
  // view in the strip. Mobile-only (no touch gesture on desktop, and the
  // header's own ‹ › arrows already cover stepping there, albeit by week
  // — see shiftWeek) and Day-mode-only (Week/Month have their own shape,
  // not a single date to step). touchend's dx/dy, not a running
  // touchmove delta — this only needs to fire once, at the end of the
  // gesture, unlike PullToRefresh's own live-tracked pull distance.
  const daySwipeStart = useRef(null)
  const SWIPE_MIN_DISTANCE = 60

  function handleDaySwipeStart(e) {
    if (isDesktop || viewMode !== 'day') return
    const t = e.touches[0]
    daySwipeStart.current = { x: t.clientX, y: t.clientY }
  }

  function handleDaySwipeEnd(e) {
    const start = daySwipeStart.current
    daySwipeStart.current = null
    if (!start) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    // Requires the gesture to be clearly more horizontal than vertical —
    // otherwise an ordinary vertical scroll through a long task list
    // would occasionally read as a stray day-change.
    // dx > 0 is a swipe *right* (finger moved rightward) — that steps
    // back, not forward, matching the common carousel/calendar
    // convention (swipe left to advance) rather than the literal
    // direction-of-motion mapping this shipped with initially.
    if (Math.abs(dx) < SWIPE_MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return
    shiftDay(dx > 0 ? -1 : 1)
  }

  // Resets to day 1 of the target month rather than shifting the day
  // number as-is — selectedDate's only job here is naming which month
  // MonthView shows, and a naive setMonth() on e.g. Jan 31 would overflow
  // into early March instead of landing in February, silently skipping a
  // month. Same fix RentalsView.jsx's own shiftMonth already uses.
  function shiftMonth(delta) {
    setSelectedDate((d) => startOfDay(new Date(d.getFullYear(), d.getMonth() + delta, 1)))
  }

  // Swipe left/right on mobile Month view to step to the previous/next
  // month — same gesture as handleDaySwipe above, just Month-mode-only
  // instead of Day-mode-only, and stepping shiftMonth instead of
  // shiftDay. Deliberately a second copy rather than a shared helper —
  // each is a handful of lines with a different mode gate and step
  // function, not worth a hook for.
  const monthSwipeStart = useRef(null)

  function handleMonthSwipeStart(e) {
    if (isDesktop || viewMode !== 'month') return
    const t = e.touches[0]
    monthSwipeStart.current = { x: t.clientX, y: t.clientY }
  }

  function handleMonthSwipeEnd(e) {
    const start = monthSwipeStart.current
    monthSwipeStart.current = null
    if (!start) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    // Same swipe-left-to-advance convention as handleDaySwipeEnd above.
    if (Math.abs(dx) < SWIPE_MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return
    shiftMonth(dx > 0 ? -1 : 1)
  }

  const monthLabel = selectedDate.toLocaleDateString([], { month: 'long', year: 'numeric' })

  // Computed across all tasks, not just whoFiltered — a conflict is real
  // regardless of which "who" tab you happen to be looking at.
  const overlappingIds = useMemo(() => getOverlappingTaskIds(tasks), [tasks])

  const peekTask = peekTaskId ? tasks.find((t) => t.id === peekTaskId) : null

  useEffect(() => {
    // If the peeked task was deleted (or no longer matches), close the modal
    // instead of rendering a TaskRow with no data.
    if (peekTaskId && !tasks.find((t) => t.id === peekTaskId)) setPeekTaskId(null)
  }, [tasks, peekTaskId])

  // Navigates to wherever the new task actually landed — otherwise a
  // future-dated task (e.g. added while browsing Rentals, or just further
  // out than whatever day/week is currently shown) saves successfully but
  // never becomes visible anywhere without the person hunting it down
  // manually via Month view. All Day tasks don't need the date/viewMode
  // jump (that bucket shows regardless of selectedDate) but still land on
  // the Today tab so the task is at least on-screen.
  async function handleCreate(task) {
    const created = await createTask({ ...task, created_by: session.user.id })
    setTasks((prev) => [created, ...prev])
    setActiveTab('today')
    if (created.due_date) {
      setSelectedDate(startOfDay(new Date(created.due_date)))
      setViewMode('day')
    }
  }

  // These three used to have no error handling at all — a failed write
  // (RLS, network, a bad trigger on the DB side) became a silent
  // unhandled promise rejection: the checkbox/edit/delete would just
  // appear to do nothing, with no feedback and nothing for `error`'s own
  // display (below in the header) to show, since setError was never
  // reached. Now every write path here surfaces into that same banner.
  async function handleStatusChange(id, status) {
    try {
      const updated = await updateTask(id, { status })
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)))
      reload() // pick up any spawned recurrence
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleUpdate(id, patch) {
    try {
      const updated = await updateTask(id, patch)
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)))
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete(id) {
    try {
      await deleteTask(id)
      setTasks((prev) => prev.filter((t) => t.id !== id))
    } catch (err) {
      setError(err.message)
    }
  }

  // An exact copy — same fields, same due date/time — rather than
  // opening a blank form pre-filled from the original; the common case
  // is a near-duplicate of an existing task, so starting from a full
  // copy and editing from there is less work than starting from scratch
  // and re-entering everything. Completion history and the Q&A thread
  // don't carry over (a copy isn't a record of what already happened),
  // and the checklist resets to unchecked/unblocked — same reasoning as
  // spawn_next_recurrence()'s own reset in schema.sql. Routes through
  // handleCreate so the app also jumps to wherever the copy landed, same
  // as creating any other task.
  async function handleDuplicate(task) {
    const checklist = (task.checklist || []).map((item) => ({
      id: crypto.randomUUID(),
      text: item.text,
      done: false,
    }))
    await handleCreate({
      title: task.title,
      who: task.who,
      status: 'to_do',
      priority: task.priority,
      due_date: task.due_date,
      due_timezone: task.due_timezone,
      duration_minutes: task.duration_minutes,
      source: task.source,
      source_note: task.source_note,
      notes: task.notes,
      checklist,
      recurrence: task.recurrence,
    })
  }

  const taskRowProps = {
    onStatusChange: handleStatusChange,
    onUpdate: handleUpdate,
    onDelete: handleDelete,
    onDuplicate: handleDuplicate,
    memberName,
    meId: session.user.id,
    overlappingIds,
  }

  const hasUnseenInbox = hasUnseenInboxItems(tasks, session.user.id, inboxLastViewedAt)

  // Folded into the "+" FAB as a speed-dial rather than separate header
  // icons — that's what got cluttered as these got added one by one.
  // Rentals and Reports moved out to the persistent tab bar/sidebar (see
  // TABS above) since they're places you go browse, not one-shot actions
  // like the ones still here. Nudge moved back out to a standalone header
  // icon (see .header-actions below) — unlike these, it's reached for
  // often enough, and is time-sensitive enough in the moment, that
  // burying it two taps deep behind the FAB menu was actual friction, not
  // just tidiness; being one specific single-icon exception (Ada-only, so
  // Aaron's header is untouched) doesn't reintroduce the clutter this
  // speed-dial was built to avoid.
  // Ordered by roughly how often you'd actually reach for each one, not
  // alphabetically or by when it was added — Bulk add/Priorities are
  // routine task-management, Submit report is routine-ish but
  // person-specific, and Vault is both the rarest to open and the most
  // sensitive, so it sits furthest from an accidental tap at the top of
  // the speed-dial rather than sandwiched in the middle.
  const quickActions = [
    { key: 'bulkAdd', icon: '📋', label: 'Bulk add / edit tasks', onSelect: () => setBulkAddOpen(true) },
    { key: 'priorities', icon: '🎯', label: 'Priorities', onSelect: () => setPrioritiesOpen(true) },
    ...(me?.display_name === 'Aaron'
      ? [{ key: 'report', icon: '📝', label: 'Submit report', onSelect: () => setReportOpen(true) }]
      : []),
    { key: 'vault', icon: '🔐', label: 'Vault', onSelect: () => setVaultOpen(true) },
  ]

  const navButtons = TABS.map((tab) => (
    <button
      key={tab.key}
      type="button"
      className={`task-board-nav-item${activeTab === tab.key ? ' task-board-nav-item-active' : ''}`}
      onClick={() => handleTabClick(tab.key)}
    >
      <span className="task-board-nav-icon">
        {tab.icon}
        {tab.key === 'inbox' && hasUnseenInbox && <span className="task-board-nav-item-badge" />}
      </span>
      {tab.label}
    </button>
  ))

  return (
    <div className="task-board">
      {!isDesktop && <nav className="task-board-nav">{navButtons}</nav>}

      <div className="task-board-content">
        <header className="task-board-header">
          {activeTab === 'today' && (
            <div className="month-nav-row">
              <button
                type="button"
                className="month-nav-label month-nav-label-button"
                onClick={() => setDatePickerOpen(true)}
                title="Jump to a date"
              >
                {monthLabel} <span className="month-nav-caret">{datePickerOpen ? '▴' : '▾'}</span>
              </button>
            </div>
          )}
          {activeTab !== 'today' && <h1>{PAGE_LABELS[activeTab]}</h1>}
          {/* Nav + account controls grouped together and pinned to the
              header's right edge as one fixed unit (.header-right-group
              has margin-left: auto, not the individual pieces) — nav's
              position stays put regardless of how long the title/date on
              the left happens to be, instead of drifting left and right
              as you switch tabs. */}
          <div className="header-right-group">
            {isDesktop && <nav className="header-nav">{navButtons}</nav>}
            <div className="header-actions">
              <WorkingStatusToggle me={me} members={members} onChange={reloadMembers} />
              {me?.display_name === 'Ada' && (
                <button className="icon-button" onClick={handleNudge} title="Nudge Aaron" aria-label="Nudge Aaron">
                  👋
                </button>
              )}
              <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings">
                ⚙️
              </button>
            </div>
          </div>
        </header>

        {activeTab === 'rentals' && <RentalsView me={me} />}
        {activeTab === 'reports' && <EodReportsList memberName={memberName} />}
        {activeTab === 'corkboard' && <CorkBoardView me={me} memberName={memberName} />}
        {activeTab === 'inbox' && (
          <InboxView
            tasks={tasks}
            meId={session.user.id}
            memberName={memberName}
            onSelectTask={(task) => setPeekTaskId(task.id)}
            onUpdate={handleUpdate}
            lastViewedAt={inboxLastViewedAt}
          />
        )}

        {activeTab === 'today' && (
          <PullToRefresh onRefresh={reload}>
            <div className="view-mode-row">
              {/* The ‹ › step arrows render on mobile too, alongside its own
                  swipe gesture on .task-list (see handleDaySwipeEnd/
                  handleMonthSwipeEnd below) — swipe and the buttons cover
                  the same step-forward/back job, but the buttons stay
                  visible everywhere now so the row reads as one complete
                  ‹ Today › cluster on every width, not just desktop. */}
              <div className="month-nav-arrows">
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => shiftWeek(-1)}
                  title="Previous week"
                  aria-label="Previous week"
                >
                  ‹
                </button>
                <button type="button" className="month-nav-today-button" onClick={resetToToday}>
                  Today
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => shiftWeek(1)}
                  title="Next week"
                  aria-label="Next week"
                >
                  ›
                </button>
              </div>

              <div className="period-tabs">
                {VIEW_MODES.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    className={`period-tab${viewMode === m.key ? ' period-tab-active' : ''}`}
                    onClick={() => handleViewModeClick(m.key)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <select className="who-select" value={whoTab} onChange={(e) => setWhoTab(e.target.value)}>
                {WHO_TABS.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {viewMode !== 'month' && <DateStrip selectedDate={selectedDate} onSelect={setSelectedDate} />}

            {error && <p className="error">{error}</p>}
            {loading ? (
              <p className="loading">Loading…</p>
            ) : viewMode === 'month' ? (
              <div onTouchStart={handleMonthSwipeStart} onTouchEnd={handleMonthSwipeEnd}>
                <MonthView
                  monthDate={selectedDate}
                  tasksByDay={tasksByDay}
                  selectedDate={selectedDate}
                  onSelectDay={(d) => {
                    setSelectedDate(d)
                    setViewMode('day')
                  }}
                />
              </div>
            ) : (
              <div className="task-list" onTouchStart={handleDaySwipeStart} onTouchEnd={handleDaySwipeEnd}>
                {allDay.length > 0 && (
                  <section>
                    <h2 className="task-section-heading">All Day</h2>
                    <AllDayRow
                      tasks={allDay}
                      onSelect={(task) => setPeekTaskId(task.id)}
                      onStatusChange={handleStatusChange}
                    />
                  </section>
                )}

                {overdue.length > 0 && (
                  <section>
                    <h2 className="task-section-heading task-section-heading-overdue">Overdue</h2>
                    <div className="timeline-list">
                      {overdue.map((task, i) => (
                        <TimelineRow
                          key={task.id}
                          task={task}
                          time={task.due_date}
                          isLast={i === overdue.length - 1}
                          {...taskRowProps}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {daySections.map(
                  ({ date, tasks: dTasks }) =>
                    dTasks.length > 0 && (
                      <section key={date.toISOString()}>
                        {viewMode === 'day' ? (
                          // Only needed to disambiguate from the Overdue section
                          // above — with just one day-section there's otherwise
                          // no heading at all.
                          isToday && overdue.length > 0 && <h2 className="task-section-heading">Today</h2>
                        ) : (
                          <h2 className="task-section-heading">{daySectionLabel(date, startOfDay(new Date()))}</h2>
                        )}
                        {viewMode === 'day' ? (
                          <DayTimeline
                            tasks={dTasks}
                            onSelect={(task) => setPeekTaskId(task.id)}
                            onStatusChange={handleStatusChange}
                            overlappingIds={overlappingIds}
                            meId={session.user.id}
                          />
                        ) : (
                          <div className="timeline-list">
                            {dTasks.map((task, i) => (
                              <TimelineRow
                                key={task.id}
                                task={task}
                                time={task.status === 'done' ? task.completed_at : task.due_date}
                                isLast={i === dTasks.length - 1}
                                {...taskRowProps}
                              />
                            ))}
                          </div>
                        )}
                      </section>
                    ),
                )}

                {!allDay.length && !overdue.length && !daySections.some((s) => s.tasks.length) && (
                  <p className="empty">Nothing here.</p>
                )}
              </div>
            )}
          </PullToRefresh>
        )}
      </div>

      <NewTaskForm onCreate={handleCreate} defaultWho={defaultWho} selectedDate={selectedDate} extraActions={quickActions} />

      {datePickerOpen && (
        <DatePickerModal
          selectedDate={selectedDate}
          onSelect={(d) => {
            setSelectedDate(startOfDay(d))
            // Matches MonthView's own onSelectDay drill-down (day picked
            // → Day mode on that day) — picking one specific date here and
            // landing on Week instead was inconsistent with that, and with
            // the whole point of picking an exact day rather than a range.
            setViewMode('day')
            setDatePickerOpen(false)
          }}
          onClose={() => setDatePickerOpen(false)}
        />
      )}

      {peekTask && (
        <Modal onClose={() => setPeekTaskId(null)}>
          <div className="peek-task">
            <TaskRow task={peekTask} defaultOpen {...taskRowProps} />
          </div>
        </Modal>
      )}

      {reportOpen && <EndOfDayReportForm tasks={tasks} me={me} onClose={() => setReportOpen(false)} />}

      {prioritiesOpen && (
        <PrioritiesForm me={me} memberName={memberName} onClose={() => setPrioritiesOpen(false)} />
      )}

      {bulkAddOpen && (
        <BulkAddTasksForm
          me={me}
          members={members}
          tasks={tasks}
          defaultWho={defaultWho}
          onClose={() => setBulkAddOpen(false)}
          onCreated={() => {
            setBulkAddOpen(false)
            reload()
          }}
        />
      )}

      {vaultOpen && <VaultView me={me} onClose={() => setVaultOpen(false)} />}

      {settingsOpen && (
        <SettingsMenu
          theme={theme}
          toggleTheme={toggleTheme}
          showPush={pushSupported()}
          pushEnabled={pushEnabled}
          pushBusy={pushBusy}
          pushError={pushError}
          onTogglePush={handleTogglePush}
          onSignOut={signOut}
          onClose={() => {
            setSettingsOpen(false)
            setPushError('')
          }}
          memberName={me?.display_name}
          defaultTimezone={me?.default_timezone}
          onChangeDefaultTimezone={handleChangeDefaultTimezone}
        />
      )}
    </div>
  )
}

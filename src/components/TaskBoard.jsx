import { useEffect, useMemo, useRef, useState } from 'react'
import { GanttChart, Home, FileText, LayoutGrid, Timer, Target, ClipboardList, NotebookPen, Lock, Hand, Settings, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import {
  fetchTasks,
  createTask,
  updateTask,
  deleteTask,
  getOverdueTasks,
  getTasksForDay,
  getCompletedToday,
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
import ModalCard from './ModalCard'
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
import BoardView from './BoardView'
import StaffLogsView from './StaffLogsView'
import MonthView from './MonthView'
import MobileNav from './MobileNav'
import IconButton from './IconButton'
import NavItem from './NavItem'
import { PeriodTabs, PeriodTab } from './PeriodTabs'
import { MonthNavRow, MonthNavLabel } from './MonthNavRow'

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

// A floating capsule on mobile (MobileNav.jsx), folded inline into the
// header row on wide screens (see the isDesktop branch below) — the
// places you go browse, as opposed to the "+" menu's one-shot actions
// (New task, Priorities, Submit report, Nudge, Vault). Cork Board and
// Inbox were two separate tabs here; they're merged into one Board
// destination (BoardView.jsx, an internal Pins/Inbox segmented toggle) so
// mobile settles on 4 primary destinations instead of 5 — a
// navigation-level grouping only, neither screen's own data/logic changed.
// icon is the component TYPE, not a rendered element — NavItem sizes it
// per mount context (mobile capsule vs. desktop header row) via its own
// ICON_SIZE className, so this array stays size-agnostic.
//
// Board uses LayoutGrid, not Pin — Pin is already NewTaskForm.jsx's "New
// task" quick-action icon (and BoardView.jsx's own "Pins" sub-tab), so
// reusing it here for the top-level nav destination would give the same
// glyph two unrelated meanings depending on where you saw it.
const TABS = [
  { key: 'today', icon: GanttChart, label: 'Timeline' },
  { key: 'rentals', icon: Home, label: 'Rentals' },
  { key: 'reports', icon: FileText, label: 'Reports' },
  { key: 'board', icon: LayoutGrid, label: 'Board' },
  { key: 'staff', icon: Timer, label: 'Staff' },
]

// The header's page title for every tab except Today (which shows the
// month navigator instead) and Rentals (which shows a company picker
// instead — see COMPANY_LABEL/rentalsCompany below).
const PAGE_LABELS = {
  reports: 'Reports',
  board: 'Board',
  staff: 'Staff Hours',
}

// rental_company enum values (schema.sql) -> display name. Awa Rentalz
// is Ada's existing business; Azu Rentals (her mom's, separate and
// unrelated) reuses the exact same schema/UI, just its own company row
// on every rental_* table — see the Rentals section of CLAUDE.md.
const COMPANY_LABEL = { awa: 'Awa Rentalz', azu: 'Azu Rentals' }

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
  const [completedTodayOpen, setCompletedTodayOpen] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState('')
  const [reportOpen, setReportOpen] = useState(false)
  const [prioritiesOpen, setPrioritiesOpen] = useState(false)
  const [bulkAddOpen, setBulkAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [vaultOpen, setVaultOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('today')
  // Which rental company the Rentals tab is browsing — Awa Rentalz and
  // Azu Rentals are two separate sets of units/bookings/financials (see
  // rental_company enum in schema.sql), switched via the header's own
  // company picker in place of a static page title (see COMPANY_LABEL
  // below) rather than a tab of its own, since it's a view filter on one
  // destination, not a second nav-level place to go.
  const [rentalsCompany, setRentalsCompany] = useState('awa')
  const [viewMode, setViewMode] = useState('day')
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [inboxLastViewedAt, setInboxLastViewedAt] = useState(() => localStorage.getItem(INBOX_LAST_VIEWED_KEY) || '')

  // Bumping this on every visit (not just once ever) is what lets the nav
  // badge clear as soon as you open the tab, and what lets InboxView know
  // which answers are new since the *previous* visit rather than the very
  // first one. Inbox now lives inside the merged Board tab (BoardView.jsx,
  // a Pins/Inbox segmented toggle) rather than being its own top-level
  // tab — keyed on 'board' rather than a finer within-tab section, same
  // as before there was no sub-navigation to be more precise about; the
  // badge lived on (and now clears on opening) the tab as a whole either
  // way, and BoardView already defaults to the Inbox section whenever
  // there's something unseen, so this fires exactly when a user would
  // actually see it in practice.
  useEffect(() => {
    if (activeTab !== 'board') return
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

  // Same "right now" reasoning as overdue above — a task's own position
  // in the day-by-day list always stays on its due date now (see
  // getTasksForDay in tasks.js), so "what did I actually finish today"
  // needs its own separate signal rather than being inferred from
  // whatever happens to be sitting in today's list. who-scoped like
  // everything else on this tab, so switching the Ada/Aaron filter
  // scopes this the same way.
  const completedToday = useMemo(() => (isToday ? getCompletedToday(whoFiltered) : []), [whoFiltered, isToday])

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
    { key: 'bulkAdd', icon: <ClipboardList size={16} />, label: 'Bulk add / edit tasks', onSelect: () => setBulkAddOpen(true) },
    { key: 'priorities', icon: <Target size={16} />, label: 'Priorities', onSelect: () => setPrioritiesOpen(true) },
    ...(me?.display_name === 'Aaron'
      ? [{ key: 'report', icon: <NotebookPen size={16} />, label: 'Submit report', onSelect: () => setReportOpen(true) }]
      : []),
    { key: 'vault', icon: <Lock size={16} />, label: 'Vault', onSelect: () => setVaultOpen(true) },
  ]

  // Renders the same TABS/activeTab/badge data through NavItem.jsx at
  // either mount size — MobileNav's capsule (size="mobile") and the
  // desktop .header-nav row (size="desktop") each call this rather than
  // sharing one pre-built array, so the context-specific presentation
  // lives in NavItem, not stuffed into the TABS data model itself.
  function renderNavButtons(size) {
    return TABS.map((tab) => (
      <NavItem
        key={tab.key}
        size={size}
        active={activeTab === tab.key}
        icon={tab.icon}
        label={tab.label}
        badge={tab.key === 'board' && hasUnseenInbox}
        onClick={() => handleTabClick(tab.key)}
      />
    ))
  }

  return (
    <div
      className={`max-w-[640px] mx-auto pt-6 px-4 pb-[calc(110px+env(safe-area-inset-bottom,0px))] md:p-6 ${
        activeTab === 'rentals' ? 'md:max-w-[1360px]' : 'md:max-w-[1100px]'
      }`}
    >
      {!isDesktop && (
        <MobileNav navButtons={renderNavButtons('mobile')}>
          <NewTaskForm
            variant="mobile"
            onCreate={handleCreate}
            defaultWho={defaultWho}
            selectedDate={selectedDate}
            extraActions={quickActions}
          />
        </MobileNav>
      )}

      <div className="min-w-0">
        <header className="mb-4 flex flex-wrap items-center gap-2">
          {activeTab === 'today' && (
            <MonthNavRow>
              <MonthNavLabel
                className="text-[26px] max-[480px]:text-[22px]"
                onClick={() => setDatePickerOpen(true)}
                title="Jump to a date"
              >
                {monthLabel}{' '}
                <span className="inline-flex opacity-60">
                  {datePickerOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </span>
              </MonthNavLabel>
            </MonthNavRow>
          )}
          {activeTab === 'rentals' && (
            // Same "the page title itself is the control" pattern as the
            // Today tab's own MonthNavLabel — a plain h1 here would need a
            // separate picker UI bolted on somewhere; making the title a
            // real <select> means there's nothing else to build, and
            // switching companies happens from the exact place you'd
            // instinctively click to see what you're browsing.
            <div className="relative inline-flex items-center">
              <select
                value={rentalsCompany}
                onChange={(e) => setRentalsCompany(e.target.value)}
                className="cursor-pointer appearance-none rounded-sm border-0 bg-transparent py-1 pr-6 pl-0 text-[22px] font-bold whitespace-nowrap text-text-h [font-family:inherit]"
              >
                {/* font-size set on the options, not the select — the
                    closed trigger's own big bold look is deliberate (see
                    the comment above), only the open popover's oversized
                    text needed shrinking. Desktop browsers style an
                    <option> independently of the select's own displayed
                    value; iOS Safari's native picker mostly ignores this
                    either way, so this is a no-cost improvement there,
                    not a regression. */}
                {Object.entries(COMPANY_LABEL).map(([value, label]) => (
                  <option key={value} value={value} className="text-[15px] font-normal">
                    {label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-0 inline-flex opacity-60">
                <ChevronDown size={20} />
              </span>
            </div>
          )}
          {activeTab !== 'today' && activeTab !== 'rentals' && <h1 className="whitespace-nowrap text-[22px]">{PAGE_LABELS[activeTab]}</h1>}
          {/* Nav + account controls grouped together and pinned to the
              header's right edge as one fixed unit (this group has
              margin-left: auto, not the individual pieces) — nav's
              position stays put regardless of how long the title/date on
              the left happens to be, instead of drifting left and right
              as you switch tabs. */}
          <div className="ml-auto flex items-center gap-4">
            {/* .header-nav's own recipe was just display:flex; gap:4px —
                its last dependent, so converted directly rather than kept
                as a literal class. .header-nav itself and the compound
                .task-board-nav-item* overrides it used to carry (App.css)
                are now fully orphaned, left in place until a dedicated
                dead-CSS cleanup pass. */}
            {isDesktop && <nav className="flex gap-1">{renderNavButtons('desktop')}</nav>}
            <div className="flex flex-wrap items-center justify-end gap-3 max-[480px]:gap-2">
              <WorkingStatusToggle me={me} members={members} onChange={reloadMembers} />
              {me?.display_name === 'Ada' && (
                <IconButton size="header" onClick={handleNudge} title="Nudge Aaron" aria-label="Nudge Aaron">
                  <Hand size={16} />
                </IconButton>
              )}
              <IconButton size="header" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings">
                <Settings size={16} />
              </IconButton>
            </div>
          </div>
        </header>

        {activeTab === 'rentals' && <RentalsView me={me} company={rentalsCompany} />}
        {activeTab === 'reports' && <EodReportsList memberName={memberName} />}
        {activeTab === 'board' && (
          <BoardView
            me={me}
            memberName={memberName}
            tasks={tasks}
            meId={session.user.id}
            onSelectTask={(task) => setPeekTaskId(task.id)}
            onUpdate={handleUpdate}
            lastViewedAt={inboxLastViewedAt}
            hasUnseenInbox={hasUnseenInbox}
          />
        )}
        {activeTab === 'staff' && <StaffLogsView me={me} />}

        {activeTab === 'today' && (
          <PullToRefresh onRefresh={reload}>
            <div className="view-mode-row">
              {/* The ‹ › step arrows render on mobile too, alongside its own
                  swipe gesture on .task-list (see handleDaySwipeEnd/
                  handleMonthSwipeEnd below) — swipe and the buttons cover
                  the same step-forward/back job, but the buttons stay
                  visible everywhere now so the row reads as one complete
                  ‹ Today › cluster on every width, not just desktop. */}
              <div className="flex items-center gap-1.5">
                <IconButton size="weekNav" onClick={() => shiftWeek(-1)} title="Previous week" aria-label="Previous week">
                  <ChevronLeft size={14} />
                </IconButton>
                {/* .month-nav-today-button (App.css) is single-consumer —
                    this is its only usage, always inside .view-mode-row,
                    so the compact override values (5px/8px padding, 12px
                    font) are used directly rather than the base 6px/10px/
                    13px recipe this context always overrides anyway. */}
                <button
                  type="button"
                  onClick={resetToToday}
                  className="cursor-pointer whitespace-nowrap rounded-sm border border-border bg-transparent px-2 py-[5px] text-xs font-semibold text-text [font-family:inherit] [line-height:inherit] transition-all duration-[120ms] ease-tactile hover:border-accent hover:text-accent active:scale-[0.96]"
                >
                  Today
                </button>
                <IconButton size="weekNav" onClick={() => shiftWeek(1)} title="Next week" aria-label="Next week">
                  <ChevronRight size={14} />
                </IconButton>
              </div>

              {/* size="compact": this row also holds the ‹ Today › cluster
                  and the who-filter, so it uses .view-mode-row's shrunk
                  sizing rather than a standalone .period-tabs' roomier
                  default — the only consumer with this override. flex-1
                  replicates .view-mode-row .period-tabs' own layout rule
                  (this segment fills the row's remaining space, not a
                  visual size variant), so it's passed via className
                  rather than folded into the size prop. */}
              <PeriodTabs className="flex-1">
                {VIEW_MODES.map((m) => (
                  <PeriodTab
                    key={m.key}
                    size="compact"
                    active={viewMode === m.key}
                    onClick={() => handleViewModeClick(m.key)}
                  >
                    {m.label}
                  </PeriodTab>
                ))}
              </PeriodTabs>

              <select className="who-select" value={whoTab} onChange={(e) => setWhoTab(e.target.value)}>
                {WHO_TABS.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {viewMode !== 'month' && <DateStrip selectedDate={selectedDate} onSelect={setSelectedDate} />}

            {/* A task's position in the lists below always stays on its
                own due date now (see getTasksForDay in tasks.js) — this
                is the separate "what actually got done today" signal
                that used to come from relocating a completed task into
                today's list instead. Same isToday gate Overdue already
                uses, and who-scoped the same way as everything else on
                this tab. */}
            {isToday && completedToday.length > 0 && (
              <button
                type="button"
                onClick={() => setCompletedTodayOpen(true)}
                className="flex w-fit cursor-pointer items-center gap-1.5 rounded-full border border-border bg-pill-bg px-3 py-1 text-xs font-medium text-text-h transition-all duration-[120ms] ease-tactile hover:border-accent hover:text-accent active:scale-[0.97]"
              >
                <CheckCircle2 size={13} className="text-accent" />
                {completedToday.length} completed today
              </button>
            )}

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
                    <div className="flex flex-col">
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
                          <div className="flex flex-col">
                            {dTasks.map((task, i) => (
                              <TimelineRow
                                key={task.id}
                                task={task}
                                time={task.due_date}
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

      {/* Mobile gets its own instance inside MobileNav (variant="mobile",
          rendered as a flex sibling of the nav capsule) — this one is
          desktop-only now, so there's exactly one mounted FAB/menu/modal
          at a time rather than two independent instances competing on
          mobile. */}
      {isDesktop && (
        <NewTaskForm onCreate={handleCreate} defaultWho={defaultWho} selectedDate={selectedDate} extraActions={quickActions} />
      )}

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

      {/* Same TimelineRow/TaskRow rendering the Overdue/Week sections
          already use — time is still due_date (TimelineRow's own
          contract, same as everywhere else it's used), so the leading
          column shows where each task was actually scheduled; the real
          completed_at moment shows up right below via the nested
          TaskRow's own "Completed HH:MM" tag (dueLabel), same as it
          already does anywhere else a done task renders. Each row
          expands in place (TaskRow's own open state), no separate peek
          needed, since these rows aren't height-constrained the way
          DayTimeline's blocks are.

          Falls back to completed_at when due_date is null — a genuinely
          dateless task (All Day's own "Date (optional)" left blank) can
          still be checked off, and getCompletedToday (unlike
          getTasksForDay/groupTasksByDay) doesn't require a due_date to
          surface one here, so this is the one place that case can now
          actually show up. */}
      {completedTodayOpen && (
        <Modal onClose={() => setCompletedTodayOpen(false)}>
          <ModalCard>
            <h2>Completed today</h2>
            <div className="flex flex-col">
              {completedToday.map((task, i) => (
                <TimelineRow
                  key={task.id}
                  task={task}
                  time={task.due_date || task.completed_at}
                  isLast={i === completedToday.length - 1}
                  {...taskRowProps}
                />
              ))}
            </div>
          </ModalCard>
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

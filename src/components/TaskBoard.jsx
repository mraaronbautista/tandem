import { useEffect, useMemo, useState } from 'react'
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

  // The quick-actions menu closes as soon as an item is picked (see
  // NewTaskForm), so there's no persistent button left to show a "sent"
  // state on — a quick confirmation alert is the feedback instead.
  async function handleNudge() {
    try {
      await sendNudge()
      alert('Nudge sent to Aaron.')
    } catch {
      // No persistent surface to show this inline on — the quick-actions
      // menu is already closed by the time this fires (see comment
      // above) — so alert() is the only option, but the raw Supabase
      // error text isn't meant for a person to read.
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
    } catch {
      // Non-critical: attribution just falls back to blank.
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

  async function handleStatusChange(id, status) {
    const updated = await updateTask(id, { status })
    setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)))
    reload() // pick up any spawned recurrence
  }

  async function handleUpdate(id, patch) {
    const updated = await updateTask(id, patch)
    setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)))
  }

  async function handleDelete(id) {
    await deleteTask(id)
    setTasks((prev) => prev.filter((t) => t.id !== id))
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
  // like the ones still here.
  const quickActions = [
    { key: 'priorities', icon: '🎯', label: 'Priorities', onSelect: () => setPrioritiesOpen(true) },
    { key: 'bulkAdd', icon: '📋', label: 'Bulk add tasks', onSelect: () => setBulkAddOpen(true) },
    { key: 'vault', icon: '🔐', label: 'Vault', onSelect: () => setVaultOpen(true) },
    ...(me?.display_name === 'Aaron'
      ? [{ key: 'report', icon: '📝', label: 'Submit report', onSelect: () => setReportOpen(true) }]
      : []),
    ...(me?.display_name === 'Ada' ? [{ key: 'nudge', icon: '🚨', label: 'Nudge Aaron', onSelect: handleNudge }] : []),
  ]

  const navButtons = TABS.map((tab) => (
    <button
      key={tab.key}
      type="button"
      className={`task-board-nav-item${activeTab === tab.key ? ' task-board-nav-item-active' : ''}`}
      onClick={() => setActiveTab(tab.key)}
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
                {monthLabel} <span className="month-nav-caret">{datePickerOpen ? '︿' : '﹀'}</span>
              </button>
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
              <MonthView
                monthDate={selectedDate}
                tasksByDay={tasksByDay}
                selectedDate={selectedDate}
                onSelectDay={(d) => {
                  setSelectedDate(d)
                  setViewMode('day')
                }}
              />
            ) : (
              <div className="task-list">
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

      <NewTaskForm onCreate={handleCreate} defaultWho={defaultWho} extraActions={quickActions} />

      {datePickerOpen && (
        <DatePickerModal
          selectedDate={selectedDate}
          onSelect={(d) => {
            setSelectedDate(startOfDay(d))
            setViewMode('week')
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

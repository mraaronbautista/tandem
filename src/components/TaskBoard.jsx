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
} from '../lib/tasks'
import { fetchMembers } from '../lib/members'
import { pushSupported, getPushSubscription, subscribeToPush, unsubscribeFromPush } from '../lib/pushNotifications'
import { sendNudge } from '../lib/manualNotify'
import { useAuth } from '../lib/AuthContext'
import { timeOfDayGreeting } from '../lib/greeting'
import { WHO_LABEL, whoKeyForName } from '../lib/whoLabels'
import TaskRow from './TaskRow'
import TimelineRow from './TimelineRow'
import AllDayRow from './AllDayRow'
import NewTaskForm from './NewTaskForm'
import Modal from './Modal'
import DateStrip from './DateStrip'
import PullToRefresh from './PullToRefresh'
import WorkingStatusToggle from './WorkingStatusToggle'
import EndOfDayReportForm from './EndOfDayReportForm'
import EodReportsList from './EodReportsList'
import PrioritiesForm from './PrioritiesForm'
import SettingsMenu from './SettingsMenu'
import RentalsView from './RentalsView'
import VaultView from './VaultView'
import CorkBoardView from './CorkBoardView'

const WHO_TABS = [
  { key: 'all', label: 'All' },
  { key: 'yours', label: WHO_LABEL.yours },
  { key: 'assistant', label: WHO_LABEL.assistant },
]

// Bottom bar on mobile, sidebar on wide screens (see .task-board-nav in
// App.css) — the three sections that are actually places you go browse,
// as opposed to the "+" menu's one-shot actions (New task, Priorities,
// Submit report, Nudge, Vault).
const TABS = [
  { key: 'today', icon: '📋', label: 'Today' },
  { key: 'rentals', icon: '🏠', label: 'Rentals' },
  { key: 'reports', icon: '📄', label: 'Reports' },
  { key: 'corkboard', icon: '📌', label: 'Cork Board' },
]

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export default function TaskBoard({ theme, toggleTheme }) {
  const { session, signOut } = useAuth()
  const [tasks, setTasks] = useState([])
  const [members, setMembers] = useState([])
  const [whoTab, setWhoTab] = useState('all')
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [peekTaskId, setPeekTaskId] = useState(null)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [prioritiesOpen, setPrioritiesOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [vaultOpen, setVaultOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('today')

  // The quick-actions menu closes as soon as an item is picked (see
  // NewTaskForm), so there's no persistent button left to show a "sent"
  // state on — a quick confirmation alert is the feedback instead.
  async function handleNudge() {
    try {
      await sendNudge()
      alert('Nudge sent to Aaron.')
    } catch (err) {
      alert(err.message)
    }
  }

  useEffect(() => {
    if (pushSupported()) getPushSubscription().then((sub) => setPushEnabled(Boolean(sub)))
  }, [])

  async function handleTogglePush() {
    setPushBusy(true)
    try {
      if (pushEnabled) {
        await unsubscribeFromPush()
        setPushEnabled(false)
      } else {
        await subscribeToPush(session.user.id)
        setPushEnabled(true)
      }
    } catch (err) {
      alert(err.message)
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

  const dayTasks = useMemo(() => getTasksForDay(whoFiltered, selectedDate), [whoFiltered, selectedDate])

  // Computed across all tasks, not just whoFiltered — a conflict is real
  // regardless of which "who" tab you happen to be looking at.
  const overlappingIds = useMemo(() => getOverlappingTaskIds(tasks), [tasks])

  const peekTask = peekTaskId ? tasks.find((t) => t.id === peekTaskId) : null

  useEffect(() => {
    // If the peeked task was deleted (or no longer matches), close the modal
    // instead of rendering a TaskRow with no data.
    if (peekTaskId && !tasks.find((t) => t.id === peekTaskId)) setPeekTaskId(null)
  }, [tasks, peekTaskId])

  async function handleCreate(task) {
    const created = await createTask({ ...task, created_by: session.user.id })
    setTasks((prev) => [created, ...prev])
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

  const taskRowProps = {
    onStatusChange: handleStatusChange,
    onUpdate: handleUpdate,
    onDelete: handleDelete,
    memberName,
    meId: session.user.id,
    overlappingIds,
  }

  // Folded into the "+" FAB as a speed-dial rather than separate header
  // icons — that's what got cluttered as these got added one by one.
  // Rentals and Reports moved out to the persistent tab bar/sidebar (see
  // TABS above) since they're places you go browse, not one-shot actions
  // like the ones still here.
  const quickActions = [
    { key: 'priorities', icon: '🎯', label: 'Priorities', onSelect: () => setPrioritiesOpen(true) },
    { key: 'vault', icon: '🔐', label: 'Vault', onSelect: () => setVaultOpen(true) },
    ...(me?.display_name === 'Aaron'
      ? [{ key: 'report', icon: '📝', label: 'Submit report', onSelect: () => setReportOpen(true) }]
      : []),
    ...(me?.display_name === 'Ada' ? [{ key: 'nudge', icon: '🚨', label: 'Nudge Aaron', onSelect: handleNudge }] : []),
  ]

  return (
    <div className="task-board">
      <nav className="task-board-nav">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`task-board-nav-item${activeTab === tab.key ? ' task-board-nav-item-active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <span className="task-board-nav-icon">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="task-board-content">
        <header className="task-board-header">
          <h1>{timeOfDayGreeting(me?.display_name)}</h1>
          <div className="header-actions">
            <WorkingStatusToggle me={me} members={members} onChange={reloadMembers} />
            <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Settings">
              ⚙️
            </button>
          </div>
        </header>

        {activeTab === 'rentals' && <RentalsView me={me} />}
        {activeTab === 'reports' && <EodReportsList memberName={memberName} />}
        {activeTab === 'corkboard' && <CorkBoardView me={me} memberName={memberName} />}

        {activeTab === 'today' && (
          <PullToRefresh onRefresh={reload}>
            <DateStrip
              selectedDate={selectedDate}
              onSelect={setSelectedDate}
              headerRight={
                <select className="who-select" value={whoTab} onChange={(e) => setWhoTab(e.target.value)}>
                  {WHO_TABS.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              }
            />

            {error && <p className="error">{error}</p>}
            {loading ? (
              <p className="loading">Loading…</p>
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

                {dayTasks.length > 0 && (
                  <section>
                    {/* Only needed to disambiguate from the Overdue section above —
                        on other days there's just one list, so no heading needed. */}
                    {isToday && overdue.length > 0 && <h2 className="task-section-heading">Today</h2>}
                    <div className="timeline-list">
                      {dayTasks.map((task, i) => (
                        <TimelineRow
                          key={task.id}
                          task={task}
                          time={task.status === 'done' ? task.completed_at : task.due_date}
                          isLast={i === dayTasks.length - 1}
                          {...taskRowProps}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {!allDay.length && !overdue.length && !dayTasks.length && <p className="empty">Nothing here.</p>}
              </div>
            )}
          </PullToRefresh>
        )}
      </div>

      <NewTaskForm onCreate={handleCreate} defaultWho={defaultWho} extraActions={quickActions} />

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

      {vaultOpen && <VaultView me={me} onClose={() => setVaultOpen(false)} />}

      {settingsOpen && (
        <SettingsMenu
          theme={theme}
          toggleTheme={toggleTheme}
          showPush={pushSupported()}
          pushEnabled={pushEnabled}
          pushBusy={pushBusy}
          onTogglePush={handleTogglePush}
          onSignOut={signOut}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}

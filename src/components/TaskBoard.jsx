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
import { useAuth } from '../lib/AuthContext'
import { timeOfDayGreeting } from '../lib/greeting'
import { WHO_LABEL, whoKeyForName } from '../lib/whoLabels'
import TaskRow from './TaskRow'
import TimelineRow from './TimelineRow'
import AllDayRow from './AllDayRow'
import NewTaskForm from './NewTaskForm'
import ThemeToggle from './ThemeToggle'
import Modal from './Modal'
import DateStrip from './DateStrip'
import PullToRefresh from './PullToRefresh'

const WHO_TABS = [
  { key: 'all', label: 'All' },
  { key: 'yours', label: WHO_LABEL.yours },
  { key: 'assistant', label: WHO_LABEL.assistant },
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

    const channel = supabase
      .channel('tasks-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => reload())
      .subscribe()

    return () => supabase.removeChannel(channel)
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
    overlappingIds,
  }

  return (
    <div className="task-board">
      <header className="task-board-header">
        <h1>{timeOfDayGreeting(me?.display_name)}</h1>
        <div className="header-actions">
          {pushSupported() && (
            <button
              className="push-toggle"
              onClick={handleTogglePush}
              disabled={pushBusy}
              title={pushEnabled ? 'Disable notifications' : 'Enable notifications'}
            >
              {pushEnabled ? '🔔' : '🔕'}
            </button>
          )}
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <button className="sign-out" onClick={signOut} title="Sign out">
            🚪
          </button>
        </div>
      </header>

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
                    time={task.due_date || task.completed_at}
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

      <NewTaskForm onCreate={handleCreate} defaultWho={defaultWho} />

      {peekTask && (
        <Modal onClose={() => setPeekTaskId(null)}>
          <div className="peek-task">
            <TaskRow task={peekTask} defaultOpen {...taskRowProps} />
          </div>
        </Modal>
      )}
    </div>
  )
}

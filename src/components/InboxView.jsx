import { useState } from 'react'
import { getInboxItems } from '../lib/tasks'
import { WHO_COLOR, whoKeyForName } from '../lib/whoLabels'

const KIND_LABEL = { question: 'asked', answer: 'answered', finished: 'marked finished' }

function formatWhen(iso) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function personBadge(personId, memberName) {
  const name = memberName(personId)
  const whoKey = whoKeyForName(name)
  return { name, color: whoKey ? WHO_COLOR[whoKey] : undefined }
}

function InboxItem({ item, kind, task, memberName, unread, onSelectTask, onResolve }) {
  const { name, color } = personBadge(item.otherPersonId, memberName)
  return (
    <li
      className={`inbox-item inbox-item-${kind}${kind === 'answer' && !unread ? ' inbox-item-read' : ''}`}
      onClick={() => task && onSelectTask(task)}
    >
      <div className="inbox-item-top">
        <span className="inbox-item-title">{item.taskTitle}</span>
        <span className="inbox-item-when">{formatWhen(item.at)}</span>
      </div>
      <p className="inbox-item-text">{item.text}</p>
      <div className="inbox-item-footer">
        <span className="task-who-badge" style={{ background: color }}>
          {name} {KIND_LABEL[kind]}
        </span>
        {onResolve && (
          <input
            type="checkbox"
            className="task-done-checkbox"
            title="Mark as handled — no reply needed"
            aria-label="Mark as handled — no reply needed"
            onClick={(e) => e.stopPropagation()}
            onChange={onResolve}
          />
        )}
      </div>
    </li>
  )
}

// Persistent tab content, not a modal — see RentalsView.jsx for why. Unlike
// CorkBoardView/EodReportsList this isn't self-fetching: fetchTasks() (see
// tasks.js) already loads every task with no date filter, and TaskBoard.jsx
// keeps that array live via its existing tasks-changes Realtime channel, so
// clarifications are already sitting in memory — no reason to duplicate a
// fetch/channel just for this tab.
//
// `lastViewedAt` (the last time this tab was open, before now) comes from
// TaskBoard.jsx, which owns the localStorage read/write/bump so the same
// value can drive the nav badge even while this component isn't mounted.
// Frozen into local state on mount so it stays stable for this visit,
// rather than flipping every item to "read" mid-visit once TaskBoard bumps
// it for next time.
export default function InboxView({ tasks, meId, memberName, onSelectTask, onUpdate, lastViewedAt }) {
  const [frozenLastViewedAt, setFrozenLastViewedAt] = useState(() => lastViewedAt)

  // Full history, not just recent activity — a completed task's
  // conversation should stay findable here, not age out just because the
  // work itself is long done.
  const items = getInboxItems(tasks, meId)
  const questions = items.filter((item) => item.kind === 'question')
  const answers = items.filter((item) => item.kind === 'answer')
  const finished = items.filter((item) => item.kind === 'finished')

  // Visiting this tab already marks everything read for *next* time (see
  // frozenLastViewedAt above — it's deliberately the *previous* visit's
  // timestamp so answers stay highlighted for this whole visit). This
  // button is for clearing that highlighting immediately, without
  // needing to leave and come back — e.g. after skimming the whole list
  // in one sitting, or if a new answer lands via Realtime while already
  // on this tab, which the tab-entry bump alone wouldn't catch.
  function handleMarkAllRead() {
    setFrozenLastViewedAt(new Date().toISOString())
  }

  // Same "not every clarification is a question" reasoning as
  // TaskClarifications.jsx's own handleResolve — this is the quick path
  // for dismissing a plain FYI comment right from the Inbox, without
  // having to open the task first.
  async function handleResolve(item, task) {
    if (!task) return
    const updated = task.clarifications.map((c) =>
      c.id === item.clarificationId
        ? { ...c, resolved: true, resolvedBy: meId, resolvedAt: new Date().toISOString() }
        : c,
    )
    await onUpdate(task.id, { clarifications: updated })
  }

  function renderItem(item, kind) {
    const task = tasks.find((t) => t.id === item.taskId)
    const unread = kind === 'answer' && (!frozenLastViewedAt || new Date(item.at) > new Date(frozenLastViewedAt))
    return (
      <InboxItem
        key={item.clarificationId}
        item={item}
        kind={kind}
        task={task}
        memberName={memberName}
        unread={unread}
        onSelectTask={onSelectTask}
        onResolve={kind === 'question' ? () => handleResolve(item, task) : undefined}
      />
    )
  }

  return (
    <div className="tab-panel">
      {questions.length === 0 && answers.length === 0 && finished.length === 0 && (
        <p className="task-notes-empty">Nothing waiting on you.</p>
      )}

      {questions.length > 0 && (
        <section>
          <h3 className="task-section-heading inbox-section-heading-question">Needs your reply</h3>
          <ul className="inbox-list">{questions.map((item) => renderItem(item, 'question'))}</ul>
        </section>
      )}

      {answers.length > 0 && (
        <section>
          <div className="inbox-section-heading-row">
            <h3 className="task-section-heading">Answered</h3>
            <button type="button" className="inbox-mark-read" onClick={handleMarkAllRead}>
              Mark all as read
            </button>
          </div>
          <ul className="inbox-list">{answers.map((item) => renderItem(item, 'answer'))}</ul>
        </section>
      )}

      {finished.length > 0 && (
        <section>
          <h3 className="task-section-heading">Finished</h3>
          <ul className="inbox-list">{finished.map((item) => renderItem(item, 'finished'))}</ul>
        </section>
      )}
    </div>
  )
}

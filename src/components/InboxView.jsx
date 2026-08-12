import { useState } from 'react'
import { getInboxItems } from '../lib/tasks'
import { WHO_COLOR, whoKeyForName } from '../lib/whoLabels'

const ANSWERED_WINDOW_DAYS = 14

function formatWhen(iso) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function personBadge(personId, memberName) {
  const name = memberName(personId)
  const whoKey = whoKeyForName(name)
  return { name, color: whoKey ? WHO_COLOR[whoKey] : undefined }
}

function InboxItem({ item, kind, task, memberName, unread, onSelectTask }) {
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
      <span className="task-who-badge" style={{ background: color }}>
        {name} {kind === 'question' ? 'asked' : 'answered'}
      </span>
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
export default function InboxView({ tasks, meId, memberName, onSelectTask, lastViewedAt }) {
  const [frozenLastViewedAt] = useState(() => lastViewedAt)

  const cutoff = Date.now() - ANSWERED_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const items = getInboxItems(tasks, meId).filter(
    (item) => item.kind === 'question' || new Date(item.at).getTime() >= cutoff,
  )
  const questions = items.filter((item) => item.kind === 'question')
  const answers = items.filter((item) => item.kind === 'answer')

  function renderItem(item, kind) {
    const unread = kind === 'answer' && (!frozenLastViewedAt || new Date(item.at) > new Date(frozenLastViewedAt))
    return (
      <InboxItem
        key={item.clarificationId}
        item={item}
        kind={kind}
        task={tasks.find((t) => t.id === item.taskId)}
        memberName={memberName}
        unread={unread}
        onSelectTask={onSelectTask}
      />
    )
  }

  return (
    <div className="tab-panel">
      {questions.length === 0 && answers.length === 0 && <p className="task-notes-empty">Nothing waiting on you.</p>}

      {questions.length > 0 && (
        <section>
          <h3 className="task-section-heading inbox-section-heading-question">Needs your reply</h3>
          <ul className="inbox-list">{questions.map((item) => renderItem(item, 'question'))}</ul>
        </section>
      )}

      {answers.length > 0 && (
        <section>
          <h3 className="task-section-heading">Answered</h3>
          <ul className="inbox-list">{answers.map((item) => renderItem(item, 'answer'))}</ul>
        </section>
      )}
    </div>
  )
}

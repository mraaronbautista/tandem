import { useState } from 'react'
import { getInboxItems, getCompletedSubmissions } from '../lib/tasks'
import { WHO_LABEL, WHO_COLOR, whoKeyForName } from '../lib/whoLabels'

const KIND_LABEL = { question: 'asked', answer: 'answered', finished: 'marked finished' }

// Same .period-tabs pattern EodReportsList.jsx already uses to solve
// this exact problem (several kinds of item otherwise interleaving into
// one long, hard-to-scan list) — "All" keeps today's stacked-sections
// behavior as the default, the rest narrow down to just one section.
const TABS = [
  { value: 'all', label: 'All' },
  { value: 'question', label: 'Needs your reply' },
  { value: 'answer', label: 'Answered' },
  { value: 'finished', label: 'Finished' },
  { value: 'submission', label: 'Completed' },
]

const TAB_EMPTY_LABEL = {
  question: 'Nothing needs a reply right now.',
  answer: 'No answered questions yet.',
  finished: 'Nothing finished yet.',
  submission: 'No completed submissions yet.',
}

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

// A completed task's proof-of-completion — same .inbox-item card family
// as InboxItem above, but keyed by task rather than clarification (no
// per-item resolve action; clicking straight through to the task is the
// only interaction) since a submission isn't a conversation thread with
// its own read/unread state. Badged by task.who (who the task was
// assigned to) rather than an otherPersonId, since completion_note/
// completion_attachments carry no separate "who actually submitted
// this" of their own — consistent with the rest of the app treating a
// task's `who` as its owning-person label.
function SubmissionItem({ task, onSelectTask }) {
  const attachmentCount = task.completion_attachments?.length || 0
  return (
    <li className="inbox-item inbox-item-submission" onClick={() => onSelectTask(task)}>
      <div className="inbox-item-top">
        <span className="inbox-item-title">{task.title}</span>
        <span className="inbox-item-when">{formatWhen(task.completed_at)}</span>
      </div>
      {task.completion_note ? (
        <p className="inbox-item-text">{task.completion_note}</p>
      ) : (
        <p className="inbox-item-text inbox-item-text-muted">No note — attachments only.</p>
      )}
      <div className="inbox-item-footer">
        <span className="task-who-badge" style={{ background: WHO_COLOR[task.who] }}>
          {WHO_LABEL[task.who]}
        </span>
        {attachmentCount > 0 && (
          <span className="inbox-item-attachment-count">
            📎 {attachmentCount} file{attachmentCount > 1 ? 's' : ''}
          </span>
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
  const [frozenLastViewedAt] = useState(() => lastViewedAt)
  const [view, setView] = useState('all')

  // Full history, not just recent activity — a completed task's
  // conversation should stay findable here, not age out just because the
  // work itself is long done.
  const items = getInboxItems(tasks, meId)
  const questions = items.filter((item) => item.kind === 'question')
  const answers = items.filter((item) => item.kind === 'answer')
  const finished = items.filter((item) => item.kind === 'finished')
  const submissions = getCompletedSubmissions(tasks)
  const totalCount = questions.length + answers.length + finished.length + submissions.length
  const showQuestions = (view === 'all' || view === 'question') && questions.length > 0
  const showAnswers = (view === 'all' || view === 'answer') && answers.length > 0
  const showFinished = (view === 'all' || view === 'finished') && finished.length > 0
  const showSubmissions = (view === 'all' || view === 'submission') && submissions.length > 0

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

  // Bulk version of the same per-item "no reply needed" checkbox above —
  // resolves every currently-listed question at once. Clarifications live
  // inside each task's own jsonb array, not a flat table, so this groups
  // by task first and writes each affected task exactly once (with every
  // one of its pending items resolved together) rather than firing one
  // update per clarification — several updates to the *same* task's array
  // in a row would race against each other, each one reading whatever
  // clarifications looked like before any of the others had landed.
  async function handleMarkAllRead() {
    // Unlike the single-item checkbox (a low-stakes misclick, one item),
    // this can resolve several real pending conversations in one click
    // with no undo — worth a confirm, same reasoning as other
    // consequential batch/destructive actions in this app.
    const count = questions.length
    if (!window.confirm(`Mark all ${count} item${count === 1 ? '' : 's'} as no reply needed?`)) return

    const idsByTask = new Map()
    for (const item of questions) {
      if (!idsByTask.has(item.taskId)) idsByTask.set(item.taskId, new Set())
      idsByTask.get(item.taskId).add(item.clarificationId)
    }
    await Promise.all(
      Array.from(idsByTask, ([taskId, clarificationIds]) => {
        const task = tasks.find((t) => t.id === taskId)
        if (!task) return null
        const updated = task.clarifications.map((c) =>
          clarificationIds.has(c.id)
            ? { ...c, resolved: true, resolvedBy: meId, resolvedAt: new Date().toISOString() }
            : c,
        )
        return onUpdate(taskId, { clarifications: updated })
      }),
    )
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
      {totalCount === 0 && <p className="task-notes-empty">Nothing waiting on you.</p>}

      {totalCount > 0 && (
        <div className="period-tabs">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`period-tab${view === t.value ? ' period-tab-active' : ''}`}
              onClick={() => setView(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* One section's own list being empty under "All" just means that
          section doesn't render at all (unchanged from before tabs
          existed) — this message is only for a specific tab selected on
          purpose that turns out to have nothing in it right now. */}
      {view !== 'all' &&
        { question: questions, answer: answers, finished, submission: submissions }[view].length === 0 && (
          <p className="task-notes-empty">{TAB_EMPTY_LABEL[view]}</p>
        )}

      {showQuestions && (
        <section>
          <div className="inbox-section-heading-row">
            <h3 className="task-section-heading inbox-section-heading-question">Needs your reply</h3>
            <button type="button" className="inbox-mark-read" onClick={handleMarkAllRead}>
              Mark all as read
            </button>
          </div>
          <ul className="inbox-list">{questions.map((item) => renderItem(item, 'question'))}</ul>
        </section>
      )}

      {showAnswers && (
        <section>
          <h3 className="task-section-heading">Answered</h3>
          <ul className="inbox-list">{answers.map((item) => renderItem(item, 'answer'))}</ul>
        </section>
      )}

      {showFinished && (
        <section>
          <h3 className="task-section-heading">Finished</h3>
          <ul className="inbox-list">{finished.map((item) => renderItem(item, 'finished'))}</ul>
        </section>
      )}

      {/* Full history, same reasoning as the clarification sections above
          — a completed task's proof shouldn't age out of findability just
          because it was finished a while ago. Last section: lowest
          priority, closer to a log than something waiting on you. */}
      {showSubmissions && (
        <section>
          <h3 className="task-section-heading">Completed</h3>
          <ul className="inbox-list">
            {submissions.map((task) => (
              <SubmissionItem key={task.id} task={task} onSelectTask={onSelectTask} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

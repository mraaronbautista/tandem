import { useState } from 'react'
import { Paperclip, Bell } from 'lucide-react'
import { getInboxItems, getCompletedSubmissions, getNudgedTasks } from '../lib/tasks'
import { WHO_LABEL, WHO_COLOR, whoKeyForName } from '../lib/whoLabels'
import { PeriodTabs, PeriodTab } from './PeriodTabs'

const KIND_LABEL = { question: 'asked', answer: 'answered', finished: 'marked finished' }
const inboxItemBaseClasses =
  'cursor-pointer rounded-md border border-border border-l-[3px] border-l-border bg-card-bg px-3.5 py-2.5 shadow-resting transition-all duration-[180ms] ease-tactile hover:-translate-y-px hover:shadow-raised active:translate-y-0 active:shadow-press'
const inboxItemKindClasses = {
  question: 'border-l-overdue',
  answer: 'border-l-accent',
  finished: 'opacity-70',
  submission: 'border-l-online',
  nudge: 'border-l-notice',
}

// Same .period-tabs pattern EodReportsList.jsx already uses to solve
// this exact problem (several kinds of item otherwise interleaving into
// one long, hard-to-scan list) — "All" keeps today's stacked-sections
// behavior as the default, the rest narrow down to just one section.
// Answered/Finished merged into one Resolved tab — both are "a question
// you asked that's no longer pending," just closed two different ways
// (an actual reply vs. dismissed with "No reply needed"); splitting them
// into separate tabs was a finer distinction than the tab row needed to
// make, given both were already the lowest-priority, closer-to-an-
// archive sections. Per-item kind (answer vs. finished) still drives the
// badge text and unread styling below — only the section/tab grouping
// merged, not the underlying data.
const TABS = [
  { value: 'all', label: 'All' },
  { value: 'question', label: 'New' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'submission', label: 'Submissions' },
  { value: 'nudge', label: 'Nudges' },
]

const TAB_EMPTY_LABEL = {
  question: 'Nothing needs a reply right now.',
  resolved: 'Nothing resolved yet.',
  submission: 'No submissions yet.',
  nudge: 'No nudges sent yet.',
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
      className={`${inboxItemBaseClasses} ${inboxItemKindClasses[kind]} ${kind === 'answer' && !unread ? 'opacity-65' : ''}`}
      onClick={() => task && onSelectTask(task)}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-text-h">{item.taskTitle}</span>
        <span className="flex-none text-xs whitespace-nowrap opacity-60">{formatWhen(item.at)}</span>
      </div>
      <p className="my-0.5 mb-2 overflow-hidden text-ellipsis [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]">{item.text}</p>
      <div className="flex items-center justify-between gap-2">
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
    <li className={`${inboxItemBaseClasses} ${inboxItemKindClasses.submission}`} onClick={() => onSelectTask(task)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-text-h">{task.title}</span>
        <span className="flex-none text-xs whitespace-nowrap opacity-60">{formatWhen(task.completed_at)}</span>
      </div>
      {task.completion_note ? (
        <p className="my-0.5 mb-2 overflow-hidden text-ellipsis [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]">{task.completion_note}</p>
      ) : (
        <p className="my-0.5 mb-2 overflow-hidden text-ellipsis italic opacity-60 [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]">No note — attachments only.</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="task-who-badge" style={{ background: WHO_COLOR[task.who] }}>
          {WHO_LABEL[task.who]}
        </span>
        {attachmentCount > 0 && (
          <span className="flex flex-none items-center gap-1 text-xs whitespace-nowrap opacity-70">
            <Paperclip size={12} /> {attachmentCount} file{attachmentCount > 1 ? 's' : ''}
          </span>
        )}
      </div>
    </li>
  )
}

// A task whose overdue nudge fired — same .inbox-item card family as
// SubmissionItem above, keyed by task rather than a conversation, no
// per-item action. Badged by task.who (who got nudged) for the same
// reason SubmissionItem is: overdue_nudge_sent_at carries no separate
// "who sent this" of its own to badge by instead.
function NudgeItem({ task, onSelectTask }) {
  return (
    <li className={`${inboxItemBaseClasses} ${inboxItemKindClasses.nudge}`} onClick={() => onSelectTask(task)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-text-h">{task.title}</span>
        <span className="flex-none text-xs whitespace-nowrap opacity-60">{formatWhen(task.overdue_nudge_sent_at)}</span>
      </div>
      <p className="my-0.5 mb-2 flex items-center gap-1 overflow-hidden text-ellipsis italic opacity-60 [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]">
        <Bell size={13} /> Still on your plate?
      </p>
      <div className="flex items-center justify-between gap-2">
        <span className="task-who-badge" style={{ background: WHO_COLOR[task.who] }}>
          {WHO_LABEL[task.who]}
        </span>
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
  // Merged, but re-sorted by date alone — getInboxItems' own INBOX_KIND_ORDER
  // sort (answer before finished, within each kind newest-first) doesn't
  // apply once the two are shown as a single chronological list.
  const resolved = items
    .filter((item) => item.kind === 'answer' || item.kind === 'finished')
    .sort((a, b) => new Date(b.at) - new Date(a.at))
  const submissions = getCompletedSubmissions(tasks)
  const nudged = getNudgedTasks(tasks)
  const totalCount = questions.length + resolved.length + submissions.length + nudged.length
  const showQuestions = (view === 'all' || view === 'question') && questions.length > 0
  const showResolved = (view === 'all' || view === 'resolved') && resolved.length > 0
  const showSubmissions = (view === 'all' || view === 'submission') && submissions.length > 0
  const showNudges = (view === 'all' || view === 'nudge') && nudged.length > 0

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
        <PeriodTabs>
          {TABS.map((t) => (
            <PeriodTab key={t.value} active={view === t.value} onClick={() => setView(t.value)}>
              {t.label}
            </PeriodTab>
          ))}
        </PeriodTabs>
      )}

      {/* One section's own list being empty under "All" just means that
          section doesn't render at all (unchanged from before tabs
          existed) — this message is only for a specific tab selected on
          purpose that turns out to have nothing in it right now. */}
      {view !== 'all' && { question: questions, resolved, submission: submissions, nudge: nudged }[view].length === 0 && (
        <p className="task-notes-empty">{TAB_EMPTY_LABEL[view]}</p>
      )}

      {showQuestions && (
        <section>
          <div className="flex items-center justify-between gap-2">
            <h3 className="task-section-heading m-0 text-overdue opacity-100">New</h3>
            <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold whitespace-nowrap text-accent-h" onClick={handleMarkAllRead}>
              Mark all as read
            </button>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">{questions.map((item) => renderItem(item, 'question'))}</ul>
        </section>
      )}

      {showResolved && (
        <section>
          <h3 className="task-section-heading">Resolved</h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">{resolved.map((item) => renderItem(item, item.kind))}</ul>
        </section>
      )}

      {/* Full history, same reasoning as the clarification sections above
          — a submission's proof shouldn't age out of findability just
          because it was finished a while ago. Last section: lowest
          priority, closer to a log than something waiting on you. */}
      {showSubmissions && (
        <section>
          <h3 className="task-section-heading">Submissions</h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {submissions.map((task) => (
              <SubmissionItem key={task.id} task={task} onSelectTask={onSelectTask} />
            ))}
          </ul>
        </section>
      )}

      {/* Full history, same reasoning as Submissions above — a nudge
          shouldn't age out of findability once sent. Last section: like
          Submissions, this is a log to browse, not something waiting on
          you (it already got its own push notification when it fired). */}
      {showNudges && (
        <section>
          <h3 className="task-section-heading">Nudges</h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {nudged.map((task) => (
              <NudgeItem key={task.id} task={task} onSelectTask={onSelectTask} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

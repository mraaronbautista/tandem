import { isAllDayTask } from '../lib/tasks'
import { PRIORITY_COLOR, PRIORITY_LABEL } from '../lib/priorityColors'
import { DEFAULT_TIMEZONE, splitDueDateInZone } from '../lib/timezone'
import TaskRow from './TaskRow'

export default function TimelineRow({ task, time, isLast, ...taskRowProps }) {
  const isDone = task.status === 'done'
  // `time` is always due_date now (see TaskBoard.jsx) — a task's
  // position in this list stays where it was scheduled regardless of
  // whether or when it actually got done (see getTasksForDay in
  // tasks.js). The real completed_at moment is shown separately, as its
  // own "Completed HH:MM" tag on the nested TaskRow below (its own
  // dueLabel) — this leading time column is purely about where the task
  // was due, so it reads consistently whether or not it's done. A
  // still-open All Day task, still genuinely showing its placeholder
  // due_date, gets the "All day" label instead of the literal midnight
  // it's stored at.
  const isAllDay = !isDone && isAllDayTask(task)
  // Shown in the task's own due_timezone, matching the task-zone-badge
  // rendered just below this by the nested TaskRow (see dueLabel there
  // for the full reasoning) — `time` is always due_date here, so the two
  // labels always agree on which zone they're in, done or not.
  const timeZone = task.due_timezone || DEFAULT_TIMEZONE
  const label = isAllDay ? 'All day' : new Date(time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone })

  // A still-open task with a real duration gets its own start/end dots
  // (and both time labels) instead of a single point — done tasks show
  // `time` as a single completed_at instant regardless of any duration
  // the task has, and an All Day task has no duration by definition (see
  // isAllDayTask), so neither case has a real span to show.
  const dotColor = PRIORITY_COLOR[task.priority]
  const dotTitle = PRIORITY_LABEL[task.priority]
  const hasSpan = !isDone && !isAllDay && task.duration_minutes
  // A duration long enough to land on a different calendar day than the
  // start (now possible up to a week — see TaskForm.jsx) needs its date
  // shown too, not just a bare time — two same-looking clock times with
  // no date would misread as same-day for a multi-day span. Compared as
  // calendar dates in due_timezone (hasSpan implies !isDone, so `time`
  // is always a due_date here), not browser-local, for the same reason
  // the labels themselves are zone-aware.
  const spanEnd = hasSpan ? new Date(new Date(time).getTime() + task.duration_minutes * 60000) : null
  const spansDays =
    hasSpan && splitDueDateInZone(time, timeZone).due_date !== splitDueDateInZone(spanEnd.toISOString(), timeZone).due_date
  const endTimeLabel = hasSpan
    ? spanEnd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone })
    : null
  const endLabel =
    hasSpan && spansDays
      ? `${spanEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone })}, ${endTimeLabel}`
      : endTimeLabel

  return (
    // .timeline-* (App.css) had exactly one consumer — this component
    // (.timeline-list, the parent wrapper in TaskBoard.jsx, is untouched).
    // Several offsets here are genuinely off Tailwind's 4px grid (13px/
    // 15px/3px) and are kept as arbitrary values rather than rounded to
    // the nearest step — they're load-bearing for the hand-tuned
    // start-dot/span/end-dot alignment described in App.css's own
    // comments, so exact pixel match matters more than tidiness here.
    <div className="flex gap-2.5 max-[480px]:gap-1.5">
      <div className="flex w-[54px] flex-none flex-col whitespace-nowrap pt-[13px] text-right text-xs opacity-70 max-[480px]:w-10 max-[480px]:text-[11px]">
        <span>{label}</span>
        {/* Lines up with the end dot below — both this margin and the
            connector's height are the same 28px (mt-7), so the two
            independently-flowing columns land at a matching vertical
            offset for the end point without sharing layout machinery. */}
        {hasSpan && <span className="mt-7">{endLabel}</span>}
      </div>
      <div className="flex w-2.5 flex-none flex-col items-center">
        <span className="mt-[15px] h-2 w-2 flex-none rounded-full" style={{ background: dotColor }} title={dotTitle} />
        {hasSpan && (
          <>
            <span className="mt-[3px] h-7 w-0.5 flex-none bg-border" />
            {/* The end dot's margin-top:0 relies on .timeline-span-connector
                immediately above it already supplying the vertical gap —
                the start dot's own 15px margin only exists to offset the
                *first* dot down from the row's top edge. Kept as a
                separate branch (not the same element with a conditional
                class) so the two mt-[…] values never compete on the same
                element. */}
            <span className="h-2 w-2 flex-none rounded-full" style={{ background: dotColor }} title={dotTitle} />
          </>
        )}
        {!isLast && <span className="mt-1 min-h-2 w-0.5 flex-1 bg-border" />}
      </div>
      <div className="min-w-0 flex-1 pb-2">
        <TaskRow task={task} hidePriorityDot {...taskRowProps} />
      </div>
    </div>
  )
}

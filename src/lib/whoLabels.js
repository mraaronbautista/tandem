// Per-member display: color/label now read straight off the live
// `members` array (members.color/display_name in schema.sql) instead of a
// hardcoded two-key map tied to exactly Ada/Aaron by name — see
// tasks.assignee_ids for the matching shift on the task side. Kept at this
// same file path despite the rename in spirit, since ~10 files already
// import from here and a path rename would be pure churn for no benefit.
const FALLBACK_COLOR = '#8a8a8a'

export function memberColor(members, id) {
  return members.find((m) => m.id === id)?.color || FALLBACK_COLOR
}

export function memberLabel(members, id) {
  return members.find((m) => m.id === id)?.display_name || 'Unknown'
}

// One badge per task, not a multi-avatar cluster — a drop-in replacement
// for the old single WHO_COLOR[task.who]/WHO_LABEL[task.who] badge render
// everywhere it's used (TaskRow.jsx, AllDayRow.jsx, DayTimeline.jsx,
// InboxView.jsx, BulkAddTasksForm.jsx). A single assignee keeps today's
// exact look (their own name/color); 2+ assignees join every first name
// with " + " in one neutral shared color, rather than trying to blend N
// hex values or stack N mini-avatars into tight row space.
const SHARED_COLOR = '#7d6ab8'

export function assigneeBadge(members, assigneeIds) {
  if (!assigneeIds?.length) return { label: 'Unassigned', color: FALLBACK_COLOR }
  if (assigneeIds.length === 1) {
    const id = assigneeIds[0]
    return { label: memberLabel(members, id), color: memberColor(members, id) }
  }
  const names = assigneeIds.map((id) => memberLabel(members, id).split(' ')[0])
  return { label: names.join(' + '), color: SHARED_COLOR }
}

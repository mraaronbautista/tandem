// Pure chrome for the shared "small circle indicating task priority"
// pattern — replaces .task-priority-dot (App.css, 9px) and
// .month-view-task-dot (App.css, 6px), both left in place, unused. Color
// is always passed as a style prop (PRIORITY_COLOR[task.priority]), never
// in CSS — same as both original classes.
//
// size="base" (default): 9px, matches .task-priority-dot (TaskRow.jsx's
//   collapsed row, BulkAddTasksForm.jsx's preview list).
// size="compact": 6px, matches .month-view-task-dot (MonthView.jsx's
//   cramped day-cell chips).
//
// Deliberately does NOT include TimelineRow.jsx's own dot positioning
// (mt-[15px]/mt-0, specific to its rail-column layout, already converted
// to inline Tailwind on TimelineRow's own elements) — that stays where it
// is, not absorbed into this shared component.
const SIZE = {
  base: 'h-[9px] w-[9px]',
  compact: 'h-[6px] w-[6px]',
}

export default function PriorityDot({ color, size = 'base', className = '', ...props }) {
  return <span className={`flex-none rounded-full ${SIZE[size]} ${className}`} style={{ background: color }} {...props} />
}

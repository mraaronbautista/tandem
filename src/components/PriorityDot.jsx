import { PRIORITY_LABEL, priorityDotStyle } from '../lib/priorityColors'

// Pure chrome for the shared "small circle indicating task priority"
// pattern — replaces .task-priority-dot (App.css, 9px) and
// .month-view-task-dot (App.css, 6px), both left in place, unused.
//
// Pass `priority` ('low' | 'med' | 'high'): the dot then takes its colour
// AND its form (hollow ring / solid / solid with halo — see
// priorityDotStyle) and announces itself to assistive tech, so priority is
// never carried by colour alone. `color` alone is still accepted for any
// caller that only has a raw colour; it gets no form or label.
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

export default function PriorityDot({ priority, color, size = 'base', className = '', style, ...props }) {
  const look = priority ? priorityDotStyle(priority) : { background: color }
  const a11y = priority ? { role: 'img', 'aria-label': PRIORITY_LABEL[priority], title: PRIORITY_LABEL[priority] } : {}
  return <span className={`flex-none rounded-full ${SIZE[size]} ${className}`} style={{ ...look, ...style }} {...a11y} {...props} />
}

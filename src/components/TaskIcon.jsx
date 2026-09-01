import { resolveTaskIcon } from '../lib/taskIcons'
import { PRIORITY_COLOR } from '../lib/priorityColors'
import PriorityDot from './PriorityDot'

// Replaces the plain priority-color dot next to a task's WHO badge —
// TaskRow.jsx's collapsed row and DayTimeline.jsx's block both render
// through this one component so they can't drift into different
// fallback logic. Priority still reads via the block's left border
// (untouched by this), so swapping the dot for an icon here doesn't
// lose that information, just consolidates the dot's old slot.
//
// currentColor, not a priority-tinted icon — a second independent color
// axis per icon would just compete with the left border for the same
// "what does this color mean" attention. Same treatment the existing
// StickyNote/CheckSquare/MessageCircle meta-row icons already use.
export default function TaskIcon({ task, size = 14, className = '', ...props }) {
  const Icon = resolveTaskIcon(task)
  if (!Icon) {
    return <PriorityDot color={PRIORITY_COLOR[task.priority]} className={className} {...props} />
  }
  return <Icon size={size} className={`flex-none ${className}`} {...props} />
}

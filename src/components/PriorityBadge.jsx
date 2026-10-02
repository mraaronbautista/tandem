import { ArrowDown, ArrowUp } from 'lucide-react'

// Says a task's priority in words, not only in colour. Shown only for High
// and Low — Medium is the default for nearly every task, so a badge on all
// of them would just be noise (same reasoning Bulk Add's preview already
// uses for its dot). A colour-blind person previously had no way to tell
// the priority of a task at all: the left border and dot were the only
// signals. UI/UX overhaul Phase 4.
export default function PriorityBadge({ priority, size = 12, className = '' }) {
  if (priority !== 'high' && priority !== 'low') return null
  const Icon = priority === 'high' ? ArrowUp : ArrowDown
  return (
    <span className={`inline-flex flex-none items-center gap-0.5 text-[11px] font-semibold whitespace-nowrap ${className}`}>
      <Icon size={size} aria-hidden="true" /> {priority === 'high' ? 'High' : 'Low'}
    </span>
  )
}

// Pure chrome for the shared .period-tabs/.period-tab/.period-tab-active
// pattern (App.css:2051-2082) — one pill capsule, N flex-equal segments,
// a soft accent-tinted background on whichever is active. Used by 9
// consumers for entirely different data (Day/Week/Month, Pins/Inbox,
// Add/Edit, who-filters, Guide/FAQ, period filters) — this component owns
// only the visual recipe, not any of that state/data.
//
// size="compact" replicates the one ancestor-context override that
// exists (.view-mode-row .period-tab, TaskBoard.jsx's Today-tab Day/
// Week/Month toggle, which shares its row with the ‹ Today › cluster and
// the who-filter) — smaller padding/font than every other consumer's
// plain, standalone-row sizing.
export function PeriodTabs({ className = '', ...props }) {
  return <div className={`flex gap-0.5 rounded-full bg-pill-bg p-[3px] ${className}`} {...props} />
}

const TAB_SIZE = {
  // px-0 explicitly zeroes horizontal padding (`padding: 7px 0` / `6px 0`
  // in the original) — without it, the browser's own default <button>
  // horizontal padding (6px in Chrome) leaks through unset, since neither
  // Tailwind nor this app's Preflight-less setup resets it.
  // Taller on touch screens / phones (min-h-10 = 40px, compact 36px): the
  // 30px desktop height is under what a thumb reliably hits. UI/UX
  // overhaul Phase 4.
  base: 'py-[7px] px-0 text-[13px] pointer-coarse:min-h-10 max-[480px]:min-h-10',
  compact: 'py-1.5 px-0 text-xs pointer-coarse:min-h-9 max-[480px]:min-h-9',
}

export function PeriodTab({ active = false, size = 'base', className = '', ...props }) {
  // bg-transparent and the active tint both set background-color — kept
  // mutually exclusive (one or the other, never both in the same
  // className string) rather than one being an unconditional base class,
  // since two utilities targeting the same longhand resolve by Tailwind's
  // generated-stylesheet order, not by position in this string (the same
  // class of bug caught and avoided in TimelineRow.jsx's dot margins).
  const activeClasses = active ? 'bg-[var(--period-tab-active-bg)] font-semibold text-accent-text' : 'bg-transparent text-text'
  return (
    <button
      type="button"
      className={`flex-1 cursor-pointer rounded-full border-0 transition-all duration-[120ms] ease-tactile active:scale-[0.97] ${TAB_SIZE[size]} ${activeClasses} ${className}`}
      {...props}
    />
  )
}

// Pure chrome for .task-board-nav-item/-icon/-item-badge and the
// .header-nav .task-board-nav-item* desktop override (App.css) — one
// shared nav-destination button, rendered in two mount contexts:
// MobileNav.jsx's floating capsule (size="mobile") and TaskBoard.jsx's
// desktop .header-nav row (size="desktop"). TaskBoard.jsx still owns
// TABS/activeTab/badge state via renderNavButtons(size); this component
// owns only the visual recipe, same split IconButton.jsx/PeriodTabs.jsx
// already established.
//
// No :hover/:active pseudo-class rule exists on either variant in the
// original CSS — none added here.
const SIZE_LAYOUT = {
  mobile: 'flex-1 flex-col gap-0.5 border-0 px-2.5 py-1 text-[11px]',
  desktop: 'flex-none flex-row gap-1.5 border px-3 py-2 text-sm',
}

// h-*/w-* rather than text-* now that icon is an SVG component, not an
// emoji glyph sized off font-size — same visual scale as the original
// text-xl/text-base (20px/16px).
const ICON_SIZE = {
  mobile: 'h-5 w-5',
  desktop: 'h-4 w-4',
}

// color/background/border-color computed together, exclusively, per
// active state — never split into an unconditional base class plus a
// conditional override, since Tailwind resolves same-longhand utilities
// by generated-stylesheet order, not by string position (the footgun
// PeriodTab.jsx's own activeClasses split already avoids).
function stateClasses(size, active) {
  if (size === 'desktop') {
    return active
      ? 'border-border bg-pill-bg text-accent font-semibold'
      : 'border-transparent bg-transparent text-text'
  }
  return active ? 'bg-transparent text-accent font-semibold' : 'bg-transparent text-text'
}

export default function NavItem({ size = 'mobile', active = false, icon: Icon, label, badge = false, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`flex cursor-pointer items-center rounded-[8px] [font-family:inherit] [line-height:inherit] transition-colors duration-[180ms] ease-tactile ${SIZE_LAYOUT[size]} ${stateClasses(size, active)} ${className}`}
      {...props}
    >
      <span className={`relative flex ${ICON_SIZE[size]}`}>
        <Icon className="h-full w-full" strokeWidth={2} />
        {badge && (
          <span className="absolute -right-[3px] -top-px h-2 w-2 rounded-full border-[1.5px] border-card-bg bg-[var(--overdue)]" />
        )}
      </span>
      {label}
    </button>
  )
}

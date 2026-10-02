// Pure chrome for .icon-button's three existing size contexts (App.css) —
// no icon/label opinions of its own; callers pass whatever content they
// need as children, plus any normal <button> prop.
//
// size="base" (default): the plain 32px/15px-text circle used everywhere
//   .icon-button doesn't sit inside one of the two special contexts below.
// size="header": TaskBoard.jsx's .header-actions icons (Nudge, Settings).
//   Confirmed no `:hover` rule exists on .icon-button — nothing to add.
//   Replicates the ORIGINAL'S RESPONSIVE behavior (max-width:480px, not a
//   discrete variant) — the same instance is 32px normally and grows to
//   40px only below 480px width; font-size is untouched by that override.
// size="weekNav": the ‹ Today › week-step arrows (.view-mode-row
//   .month-nav-arrows .icon-button) — a fixed 26px circle, 13px text,
//   unrelated to viewport width.
// size="headerLabeled": the header icons once they carry a visible text
//   label (pass `label`) — UI/UX overhaul Phase 1. title/aria-label alone
//   is a hover tooltip, which a phone (the app's main surface) never
//   shows, so a first-time user had no way to learn what the bare icon
//   does. Wide screens: icon and text side by side in a pill. Phones:
//   icon stacked over a small text label, the same shape the bottom nav
//   already uses, and at least a 44px touch target.
// The 32px base and 26px weekNav circles are visually fine but too small to
// tap reliably (WCAG's floor is 24px, a thumb wants ~44). A transparent
// ::after grows the tappable area past the painted circle without moving
// anything in the layout (base reaches 48px, weekNav 38px — kept tighter
// because the week arrows sit right beside the Today button).
const HIT_AREA = {
  base: "relative after:absolute after:-inset-2 after:content-['']",
  weekNav: "relative after:absolute after:-inset-1.5 after:content-['']",
}

const SIZE_CLASSES = {
  base: 'h-8 w-8 text-[15px]',
  header: 'h-8 w-8 text-[15px] max-[480px]:h-10 max-[480px]:w-10',
  weekNav: 'h-[26px] w-[26px] text-[13px]',
  headerLabeled:
    'h-8 gap-1.5 px-3 text-[13px] max-[480px]:h-auto max-[480px]:min-h-[44px] max-[480px]:min-w-[44px] max-[480px]:flex-col max-[480px]:gap-0.5 max-[480px]:rounded-lg max-[480px]:px-1 max-[480px]:py-1 max-[480px]:text-[10px]',
}

export default function IconButton({ size = 'base', className = '', label, children, ...props }) {
  return (
    <button
      type="button"
      className={`flex flex-none cursor-pointer items-center justify-center rounded-full border border-border bg-card-bg leading-none transition-all duration-[120ms] ease-tactile active:scale-[0.92] disabled:cursor-default disabled:opacity-50 ${SIZE_CLASSES[size]} ${HIT_AREA[size] || ''} ${className}`}
      {...props}
    >
      {children}
      {label && <span className="whitespace-nowrap">{label}</span>}
    </button>
  )
}

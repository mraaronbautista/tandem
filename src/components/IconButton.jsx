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
const SIZE_CLASSES = {
  base: 'h-8 w-8 text-[15px]',
  header: 'h-8 w-8 text-[15px] max-[480px]:h-10 max-[480px]:w-10',
  weekNav: 'h-[26px] w-[26px] text-[13px]',
}

export default function IconButton({ size = 'base', className = '', ...props }) {
  return (
    <button
      type="button"
      className={`flex flex-none cursor-pointer items-center justify-center rounded-full border border-border bg-card-bg leading-none transition-all duration-[120ms] ease-tactile active:scale-[0.92] disabled:cursor-default disabled:opacity-50 ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    />
  )
}

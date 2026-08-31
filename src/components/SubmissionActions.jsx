// Pure chrome for the shared .submission-actions/.submission-save/
// .rental-delete-booking+.submission-delete pattern (App.css) — NOT a
// literal-class-preserving wrapper like ModalCard.jsx, because the risk
// profile is different: .submission-actions button (bare, no class
// needed) is a self-contained descendant selector that doesn't leak into
// unrelated internal content the way .submission-modal's h2/label hooks
// did, so it's safe to fully replace with an explicit component instead
// of keeping the literal class names around.
//
// The real consequence of that: Tailwind can't replicate "any bare
// <button> inside this container gets styled automatically" without a
// global element rule (which would style buttons outside this context
// too). So every button here — not just the ones that previously carried
// .submission-save/.rental-delete-booking — has to become an explicit
// SubmissionButton, including plain "Cancel"/"Close" buttons that used to
// need no class at all.
//
// Variant naming is already how these are used in practice, not
// something invented here: .submission-save styles a "Copy to clipboard"
// button in TaskExportForm.jsx (not a save), and .rental-delete-booking
// styles VaultExportForm.jsx's destructive export-confirm button (nothing
// to do with rentals) — primary/destructive are the names already implied
// by actual usage.
export function SubmissionActions({ className = '', ...props }) {
  return <div className={`mt-1 flex flex-wrap justify-end gap-2 ${className}`} {...props} />
}

// Shared base recipe (padding/radius/font-size/cursor/transition) is
// identical across all three variants in the original CSS — only
// border/background/color/font-weight/shadow/hover/active differ. The
// transition is simplified to one uniform duration (the original splits
// transform at --dur-fast from box-shadow/background at --dur-base) —
// same documented compromise as ThemeToggle.jsx/WorkingStatusToggle.jsx,
// since Tailwind can't combine two transition-* utilities with different
// durations on one element. No :disabled rule existed in the original
// CSS either — deliberately not added here, to match exactly rather than
// improve.
const BASE = 'cursor-pointer rounded-sm border px-3.5 py-2 text-sm transition-all duration-[120ms] ease-tactile'

const VARIANT = {
  // Matches .submission-actions button (bare, no modifier) — the
  // "secondary" look every unclassed button used to get automatically.
  // No color/font-weight set, same as the original (native default
  // button text color, not one of the app's theme tokens — an existing
  // characteristic, not something to "fix" here).
  secondary: `${BASE} border-border bg-pill-bg active:scale-[0.97]`,
  // Matches .submission-actions button.submission-save.
  primary: `${BASE} border-accent bg-accent font-semibold text-white shadow-resting hover:-translate-y-px hover:shadow-raised active:translate-y-0 active:scale-[0.98] active:shadow-press`,
  // Matches .submission-actions button.rental-delete-booking /
  // .submission-delete — CSS-identical for both legacy class names,
  // unified under one variant. No dedicated :active rule existed for
  // this compound selector, so it falls through to the same
  // scale(0.97) the bare/secondary button gets.
  destructive: `${BASE} border-[#dc2626] bg-[#dc2626] font-semibold text-white active:scale-[0.97]`,
}

export function SubmissionButton({ variant = 'secondary', className = '', ...props }) {
  return <button type="button" className={`${VARIANT[variant]} ${className}`} {...props} />
}

// The one "Loading…" line for the whole app — UI/UX overhaul Phase 5. Every
// screen used to render its own copy of <p className="loading">Loading…</p>
// (or a small-text variant), none of which a screen reader would ever
// announce. role="status" makes the change audible; the look is the shared
// .loading rule, so there is exactly one loading style: plain text, not a
// spinner or skeleton (these loads are short, and a spinner for a half
// second of wait is more movement than information).
export default function LoadingText({ children = 'Loading…', className = '' }) {
  return (
    <p className={`loading ${className}`.trim()} role="status" aria-live="polite">
      {children}
    </p>
  )
}

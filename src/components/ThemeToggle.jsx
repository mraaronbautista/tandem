// .theme-toggle (App.css) is unused now — this was its one and only
// consumer (confirmed: Settings has its own separate theme control, not
// this component). Kept in App.css, not deleted, per the migration's
// don't-delete-until-verified rule.
export default function ThemeToggle({ theme, onToggle }) {
  return (
    <button
      className="flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-full border border-border bg-card-bg text-[15px] leading-none transition-all duration-[120ms] ease-tactile active:scale-[0.92]"
      onClick={onToggle}
      aria-label="Toggle light/dark mode"
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  )
}

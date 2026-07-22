export default function ThemeToggle({ theme, onToggle }) {
  return (
    <button className="theme-toggle" onClick={onToggle} aria-label="Toggle light/dark mode">
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  )
}

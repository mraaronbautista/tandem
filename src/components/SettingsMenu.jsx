import Modal from './Modal'

// Notifications, theme, and sign out — all "set once, rarely touched
// again" — folded into one settings sheet instead of three permanent
// header icons.
export default function SettingsMenu({
  theme,
  toggleTheme,
  showPush,
  pushEnabled,
  pushBusy,
  onTogglePush,
  onSignOut,
  onClose,
}) {
  return (
    <Modal onClose={onClose}>
      <div className="submission-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <div className="settings-menu-items">
          {showPush && (
            <button type="button" className="settings-menu-item" onClick={onTogglePush} disabled={pushBusy}>
              <span className="settings-menu-icon">{pushEnabled ? '🔔' : '🔕'}</span>
              {pushEnabled ? 'Notifications on' : 'Notifications off'}
            </button>
          )}

          <button type="button" className="settings-menu-item" onClick={toggleTheme}>
            <span className="settings-menu-icon">{theme === 'dark' ? '🌙' : '☀️'}</span>
            {theme === 'dark' ? 'Dark mode' : 'Light mode'}
          </button>

          <button type="button" className="settings-menu-item settings-menu-item-danger" onClick={onSignOut}>
            <span className="settings-menu-icon">🚪</span>
            Sign out
          </button>
        </div>

        <div className="submission-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}

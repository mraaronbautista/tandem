import { useState } from 'react'
import { TIMEZONE_OPTIONS, detectDefaultTimezone } from '../lib/timezone'
import Modal from './Modal'
import HowToGuide from './HowToGuide'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

// Notifications, theme, and sign out — all "set once, rarely touched
// again" — folded into one settings sheet instead of three permanent
// header icons.
export default function SettingsMenu({
  theme,
  toggleTheme,
  showPush,
  pushEnabled,
  pushBusy,
  pushError,
  onTogglePush,
  onSignOut,
  onClose,
  memberName,
  defaultTimezone,
  onChangeDefaultTimezone,
}) {
  const [guideOpen, setGuideOpen] = useState(false)

  return (
    <Modal onClose={onClose}>
      <ModalCard modifier="settings-modal">
        <h2>Settings</h2>

        {/* Both accounts share the same device/browser sometimes — a quick
            "which of us is actually signed in right now" check before
            anyone assumes the wrong person's notifications toggle. */}
        {memberName && <p className="settings-menu-account">Signed in as {memberName}</p>}

        <div className="settings-menu-items">
          {showPush ? (
            <>
              <button type="button" className="settings-menu-item" onClick={onTogglePush} disabled={pushBusy}>
                <span className="settings-menu-icon">{pushEnabled ? '🔔' : '🔕'}</span>
                {pushEnabled ? 'Notifications on' : 'Notifications off'}
              </button>
              {pushError && <p className="error settings-menu-error">{pushError}</p>}
            </>
          ) : (
            // Omitting this row entirely (the old behavior) left "why am I
            // not getting notified" with nothing to find — most commonly
            // hit on iOS Safari outside a Home Screen install, which can't
            // receive push at all (a platform limit, not fixable here).
            <div className="settings-menu-item settings-menu-item-disabled">
              <span className="settings-menu-icon">🔕</span>
              <span className="settings-menu-item-label">
                Notifications not supported
                <span className="settings-menu-item-caption">
                  On iPhone, add this app to your Home Screen first.
                </span>
              </span>
            </div>
          )}

          <button type="button" className="settings-menu-item" onClick={toggleTheme}>
            <span className="settings-menu-icon">{theme === 'dark' ? '🌙' : '☀️'}</span>
            {theme === 'dark' ? 'Dark mode' : 'Light mode'}
          </button>

          {onChangeDefaultTimezone && (
            <div className="settings-menu-item settings-menu-item-select">
              <span className="settings-menu-icon">🌐</span>
              <span className="settings-menu-item-label">
                Default timezone
                <span className="settings-menu-item-caption">Used when creating new items.</span>
              </span>
              <select
                className="settings-menu-select"
                value={defaultTimezone || detectDefaultTimezone()}
                onChange={(e) => onChangeDefaultTimezone(e.target.value)}
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button type="button" className="settings-menu-item" onClick={() => setGuideOpen(true)}>
            <span className="settings-menu-icon">❓</span>
            How to use this app
          </button>

          <button type="button" className="settings-menu-item settings-menu-item-danger" onClick={onSignOut}>
            <span className="settings-menu-icon">🚪</span>
            Sign out
          </button>
        </div>

        <SubmissionActions>
          <SubmissionButton onClick={onClose}>Close</SubmissionButton>
        </SubmissionActions>
      </ModalCard>

      {guideOpen && <HowToGuide onClose={() => setGuideOpen(false)} />}
    </Modal>
  )
}

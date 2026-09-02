import { useState } from 'react'
import { Bell, BellOff, Moon, Sun, Globe, HelpCircle, LogOut } from 'lucide-react'
import { TIMEZONE_OPTIONS, detectDefaultTimezone } from '../lib/timezone'
import Modal from './Modal'
import HowToGuide from './HowToGuide'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

const settingsItemClasses =
  'flex cursor-pointer items-center gap-2.5 rounded-sm border border-border bg-pill-bg px-3 py-2.5 text-left text-sm text-text-h [font-family:inherit] [font-style:inherit] [font-variant:inherit] [line-height:inherit] transition-transform duration-[120ms] ease-tactile active:scale-[0.98]'

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
        {memberName && <p className="-mt-1.5 text-[13px] opacity-60">Signed in as {memberName}</p>}

        <div className="flex flex-col gap-2">
          {showPush ? (
            <>
              <button type="button" className={settingsItemClasses} onClick={onTogglePush} disabled={pushBusy}>
                <span className="text-[17px]">{pushEnabled ? <Bell size={17} /> : <BellOff size={17} />}</span>
                {pushEnabled ? 'Notifications on' : 'Notifications off'}
              </button>
              {pushError && <p className="error">{pushError}</p>}
            </>
          ) : (
            // Omitting this row entirely (the old behavior) left "why am I
            // not getting notified" with nothing to find — most commonly
            // hit on iOS Safari outside a Home Screen install, which can't
            // receive push at all (a platform limit, not fixable here).
            <div className={`${settingsItemClasses} cursor-default opacity-60`}>
              <span className="text-[17px]">
                <BellOff size={17} />
              </span>
              <span className="flex flex-1 flex-col">
                Notifications not supported
                <span className="text-xs font-normal opacity-60">
                  On iPhone, add this app to your Home Screen first.
                </span>
              </span>
            </div>
          )}

          <button type="button" className={settingsItemClasses} onClick={toggleTheme}>
            <span className="text-[17px]">{theme === 'dark' ? <Moon size={17} /> : <Sun size={17} />}</span>
            {theme === 'dark' ? 'Dark mode' : 'Light mode'}
          </button>

          {onChangeDefaultTimezone && (
            <div className={`${settingsItemClasses} cursor-default justify-between`}>
              <span className="text-[17px]">
                <Globe size={17} />
              </span>
              <span className="flex flex-1 flex-col">
                Default timezone
                <span className="text-xs font-normal opacity-60">Used when creating and viewing tasks.</span>
              </span>
              <select
                className="flex-none cursor-pointer rounded-[6px] border border-border bg-card-bg px-2 py-1 text-[13px] text-text-h [font-family:inherit] [font-style:inherit] [font-variant:inherit] [font-weight:inherit] [line-height:inherit]"
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

          <button type="button" className={settingsItemClasses} onClick={() => setGuideOpen(true)}>
            <span className="text-[17px]">
              <HelpCircle size={17} />
            </span>
            How to use this app
          </button>

          <button type="button" className={`${settingsItemClasses} text-overdue`} onClick={onSignOut}>
            <span className="text-[17px]">
              <LogOut size={17} />
            </span>
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

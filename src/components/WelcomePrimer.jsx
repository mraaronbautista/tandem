import { useState } from 'react'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

const WELCOME_SEEN_KEY_PREFIX = 'tandem-welcome-seen-'

// A one-time, one-screen primer shown the first time a member signs in
// on a given device — closes the gap the UI/UX audit found: there was
// no first-login experience anywhere in the app, a brand-new member's
// very first screen was just the live, fully-populated Today tab, cold.
// Deliberately one screen, not a multi-step tour — "here's your + button,
// here's where everything lives" beats nothing without needing to be
// elaborate (rule #7 of the overhaul plan: show the minimum to get
// started).
//
// Tracked in localStorage, not a members column — same "purely local to
// one viewer's one device" reasoning the Inbox's own read-tracking
// already established (see INBOX_LAST_VIEWED_KEY in tasks.js): whether
// this device has seen the welcome card isn't data any other member or
// session needs to know, so it doesn't need a schema change or a
// presented-SQL migration. Keyed per member id, not a single flag, so a
// shared device (the household's own cross-account use case) still shows
// it to each actually-new member rather than only the first one ever to
// sign in there.
export default function WelcomePrimer({ me }) {
  const storageKey = me ? `${WELCOME_SEEN_KEY_PREFIX}${me.id}` : null
  const [dismissed, setDismissed] = useState(false)

  if (!me || !storageKey) return null
  if (dismissed) return null
  let alreadySeen = true
  try {
    alreadySeen = localStorage.getItem(storageKey) === '1'
  } catch {
    // Private browsing / blocked storage — fail open (show it) rather
    // than throw; worst case here is a harmless repeat primer, not a
    // broken app, so this isn't worth a user-visible error.
    alreadySeen = false
  }
  if (alreadySeen) return null

  function handleDismiss() {
    try {
      localStorage.setItem(storageKey, '1')
    } catch {
      // Same fail-open reasoning as the read above — losing the "seen"
      // flag just means it might show again next time, not a real error.
    }
    setDismissed(true)
  }

  return (
    <Modal onClose={handleDismiss}>
      <ModalCard>
        <h2>Welcome to Tandem</h2>
        <p>
          This is your shared task board. Tap the <strong>+</strong> button any time to add a task — everything
          else you need (Rentals, Reports, Board, Settings) is one tap away too.
        </p>
        <SubmissionActions>
          <SubmissionButton variant="primary" onClick={handleDismiss}>
            Got it
          </SubmissionButton>
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

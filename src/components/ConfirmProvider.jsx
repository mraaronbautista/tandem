import { useCallback, useRef, useState } from 'react'
import { ConfirmContext } from '../lib/confirmContext'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

// One in-app confirmation dialog for the whole app, replacing the browser's
// native window.confirm() — UI/UX overhaul Phase 3. The native one looks
// like it belongs to another program, its buttons say only "OK"/"Cancel"
// (so the person has to re-read the sentence to know what OK will do), and
// browser automation cannot drive it.
//
// The rule every confirmation follows (documented in CLAUDE.md):
//   - Reversible actions (archive, send to board, move) get NO dialog; the
//     button names the result instead.
//   - Tiny inline items (a checklist row, a roadmap step) are removed
//     immediately, with an undo where that is cheap.
//   - Permanently deleting a real record gets this dialog: a question that
//     names the item, one sentence on what is lost, a Cancel button that
//     has focus by default, and a red button labelled with the action
//     itself ("Delete task"), never "OK".
//   - Wiping everything (the vault reset, the vault CSV export) keeps its
//     existing typed confirmation instead.
//
// tone: 'danger' (default) gives the red button; 'neutral' is for
// confirmations that are not data loss (removing a folder tag, discarding
// an unsaved form).
export default function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null)
  const pendingRef = useRef(null)

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        // A second request while one is open settles the first as "no" so
        // no caller is left waiting forever.
        pendingRef.current?.(false)
        pendingRef.current = resolve
        setRequest(options)
      }),
    [],
  )

  function finish(result) {
    pendingRef.current?.(result)
    pendingRef.current = null
    setRequest(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <Modal onClose={() => finish(false)}>
          <ModalCard>
            <h2>{request.title}</h2>
            {request.message && <p>{request.message}</p>}
            <SubmissionActions>
              <SubmissionButton autoFocus onClick={() => finish(false)}>
                {request.cancelLabel || 'Cancel'}
              </SubmissionButton>
              <SubmissionButton
                variant={request.tone === 'neutral' ? 'primary' : 'destructive'}
                onClick={() => finish(true)}
              >
                {request.confirmLabel || 'Confirm'}
              </SubmissionButton>
            </SubmissionActions>
          </ModalCard>
        </Modal>
      )}
    </ConfirmContext.Provider>
  )
}

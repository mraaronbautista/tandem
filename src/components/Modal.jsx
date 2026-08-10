import { useEffect } from 'react'
import { createPortal } from 'react-dom'

// Rendered via a portal straight onto document.body rather than in
// place — a modal opened from *inside* another modal (e.g. the End-time
// picker inside the edit-task form, or the peek-task view) would
// otherwise sit nested deep in that outer modal's DOM. A transform on
// any ancestor (the mobile slide-up animation, for one) creates a new
// stacking context that traps position:fixed descendants regardless of
// z-index, so the inner modal can render behind sibling fields instead
// of on top of everything. A portal sidesteps that entirely: the DOM
// node lands as a sibling of the app root, never inside another
// modal's subtree.
export default function Modal({ onClose, children }) {
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>,
    document.body,
  )
}

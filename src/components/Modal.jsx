import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

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
//
// This is the one component behind every dialog in the app, so its
// keyboard/focus behavior reaches all of them at once: focus moves into
// the dialog on open, Tab is trapped within it (a native <dialog> would
// do this for free, but the app's CSS/animation/portal setup already
// assumes a plain div), and focus returns to whatever opened it on
// close — a screen reader also needs role="dialog"/aria-modal to
// announce this as a dialog at all, not just another chunk of page.
export default function Modal({ onClose, children }) {
  const contentRef = useRef(null)

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const focusable = contentRef.current?.querySelectorAll(FOCUSABLE_SELECTOR)
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  useEffect(() => {
    const previouslyFocused = document.activeElement
    const toFocus = contentRef.current?.querySelector(FOCUSABLE_SELECTOR) || contentRef.current
    toFocus?.focus()
    return () => previouslyFocused?.focus?.()
  }, [])

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={contentRef} role="dialog" aria-modal="true" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  )
}

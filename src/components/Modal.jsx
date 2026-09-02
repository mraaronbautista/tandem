import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

let pageScrollLocks = 0
let savedPageScroll = null

function lockPageScroll() {
  if (pageScrollLocks === 0) {
    const body = document.body
    const root = document.documentElement
    savedPageScroll = {
      y: window.scrollY,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
      bodyOverflow: body.style.overflow,
      rootOverflow: root.style.overflow,
    }
    body.style.position = 'fixed'
    body.style.top = `-${savedPageScroll.y}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    body.style.overflow = 'hidden'
    root.style.overflow = 'hidden'
  }
  pageScrollLocks += 1

  return () => {
    pageScrollLocks = Math.max(0, pageScrollLocks - 1)
    if (pageScrollLocks !== 0 || !savedPageScroll) return
    const body = document.body
    const root = document.documentElement
    const saved = savedPageScroll
    savedPageScroll = null
    body.style.position = saved.bodyPosition
    body.style.top = saved.bodyTop
    body.style.left = saved.bodyLeft
    body.style.right = saved.bodyRight
    body.style.width = saved.bodyWidth
    body.style.overflow = saved.bodyOverflow
    root.style.overflow = saved.rootOverflow
    window.scrollTo(0, saved.y)
  }
}

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
  const swipeStartRef = useRef(null)

  useEffect(() => lockPageScroll(), [])

  function mobileSheet() {
    if (!window.matchMedia('(max-width: 640px)').matches) return null
    const sheet = contentRef.current?.firstElementChild
    return sheet?.matches('.new-task-form, .peek-task, .submission-modal') ? sheet : null
  }

  function handleTouchStart(e) {
    const sheet = mobileSheet()
    if (!sheet || e.touches.length !== 1) return
    if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return

    // Some sheets contain their own scrolling list inside the card. Let a
    // downward gesture scroll that list toward its top first; dismissal
    // only takes over once every scrollable layer under the finger is at
    // the top, matching native bottom-sheet behavior.
    let node = e.target
    while (node && node !== contentRef.current) {
      if (node.scrollTop > 0) return
      node = node.parentElement
    }
    const touch = e.touches[0]
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY }
  }

  function handleTouchEnd(e) {
    const start = swipeStartRef.current
    swipeStartRef.current = null
    if (!start || !e.changedTouches.length) return
    const touch = e.changedTouches[0]
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (deltaY < 80 || deltaY < Math.abs(deltaX) * 1.25) return
    e.preventDefault()
    onClose()
  }

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
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={() => { swipeStartRef.current = null }}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

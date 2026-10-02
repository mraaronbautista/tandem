import { useState } from 'react'
import { CircleHelp } from 'lucide-react'

// A small "What's this?" link that opens a short plain-language note right
// where someone might get stuck — UI/UX overhaul Phase 1. The How-to guide
// already answers these questions (its FAQ tab is built from questions
// Ada really asked), but it sits behind Settings → guide → FAQ tab, and
// nobody who is confused in the moment goes looking for a manual. This
// puts the one-sentence answer next to the thing itself instead.
//
// Closed by default so it never adds clutter for someone who already
// understands the screen; the toggle label is always visible text (not an
// icon-only "?"), for the same reason the header icons gained labels —
// a bare icon only explains itself on hover, which a phone never has.
export default function HelpHint({ label = "What's this?", children, className = '' }) {
  const [open, setOpen] = useState(false)

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 py-1 text-xs font-semibold text-text-h underline decoration-accent decoration-2 underline-offset-2 [font-family:inherit]"
      >
        <CircleHelp size={13} className="text-accent-text" aria-hidden="true" />
        {open ? 'Hide' : label}
      </button>
      {open && (
        <p role="note" className="mt-1 rounded-md bg-pill-bg px-2.5 py-2 text-xs leading-snug text-text">
          {children}
        </p>
      )}
    </div>
  )
}

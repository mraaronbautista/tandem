import { useEffect, useRef, useState } from 'react'

// A <select> replacement for option lists too long to dump into a native
// popover reasonably — the native control's open-list rendering is the
// OS/browser's own popover and isn't stylable, so there's no CSS way to
// cap how many rows show at once. This renders its own fixed-height,
// scrollable panel instead.
export default function ScrollSelect({ value, onChange, options, visibleCount = 6 }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  const selectedRef = useRef(null)

  const selected = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (open) selectedRef.current?.scrollIntoView({ block: 'center' })
  }, [open])

  return (
    <div className="scroll-select" ref={containerRef}>
      <button type="button" className="scroll-select-trigger" onClick={() => setOpen((v) => !v)}>
        {selected?.label ?? '—'}
      </button>
      {open && (
        <div className="scroll-select-panel" style={{ maxHeight: `${visibleCount * 36}px` }}>
          {options.map((o) => (
            <button
              type="button"
              key={o.value}
              ref={o.value === value ? selectedRef : null}
              className={`scroll-select-option${o.value === value ? ' scroll-select-option-selected' : ''}`}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

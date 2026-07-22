import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'

// A <select> replacement for option lists too long for a native
// popover to handle reasonably. Opens through the app's existing Modal
// overlay rather than a custom absolutely-positioned panel — the latter
// broke down inside this form's cramped multi-column flex-wrap layout,
// overflowing into neighboring fields and tangling visually with sibling
// native <select>s. A modal always renders centered over everything,
// independent of which narrow grid cell triggered it.
export default function ScrollSelect({ value, onChange, options, visibleCount = 6 }) {
  const [open, setOpen] = useState(false)
  const selectedRef = useRef(null)

  const selected = options.find((o) => o.value === value)

  useEffect(() => {
    if (open) selectedRef.current?.scrollIntoView({ block: 'center' })
  }, [open])

  return (
    <>
      <button type="button" className="scroll-select-trigger" onClick={() => setOpen(true)}>
        {selected?.label ?? '—'}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <div className="scroll-select-modal">
            <div className="scroll-select-list" style={{ maxHeight: `${visibleCount * 44}px` }}>
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
          </div>
        </Modal>
      )}
    </>
  )
}

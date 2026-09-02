import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'

// A <select> replacement for option lists too long for a native
// popover to handle reasonably. Opens through the app's existing Modal
// overlay rather than a custom absolutely-positioned panel — the latter
// broke down inside this form's cramped multi-column flex-wrap layout,
// overflowing into neighboring fields and tangling visually with sibling
// native <select>s. A modal always renders centered over everything,
// independent of which narrow grid cell triggered it.
export default function ScrollSelect({ value, onChange, options, visibleCount = 6, triggerLabel }) {
  const [open, setOpen] = useState(false)
  const selectedRef = useRef(null)

  const selected = options.find((o) => o.value === value)

  useEffect(() => {
    if (open) selectedRef.current?.scrollIntoView({ block: 'center' })
  }, [open])

  return (
    <>
      <button type="button" className="w-full cursor-pointer rounded-[6px] border border-border bg-bg px-2 py-[7px] text-left text-text-h [font:inherit]" onClick={() => setOpen(true)}>
        {triggerLabel ?? selected?.label ?? '—'}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <div className="scroll-select-modal">
            <div className="flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: `${visibleCount * 44}px` }}>
              {options.map((o) => (
                <button
                  type="button"
                  key={o.value}
                  ref={o.value === value ? selectedRef : null}
                  className={`block w-full flex-none cursor-pointer border-0 px-3 py-2.5 text-left text-sm [font-family:inherit] [font-style:inherit] [font-variant:inherit] [font-weight:inherit] [line-height:inherit] hover:bg-bg ${o.value === value ? 'bg-accent text-white' : 'bg-transparent text-text-h'}`}
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

import { useState } from 'react'

// Blocked and done are mutually exclusive — something not accomplishable
// isn't "done," so marking it blocked clears done, and vice versa.
function toggleBlocked(item, onItemChange) {
  onItemChange(item.id, item.blocked ? { blocked: false, blockedReason: '' } : { blocked: true, done: false })
}

// Its own component so the reason field can keep local draft state —
// onItemChange writes straight to Supabase, so wiring the input directly
// to it meant every keystroke round-tripped over the network before the
// input reflected it, making fast typing feel laggy/dropped. Typing now
// updates local state instantly; the write only happens on blur, same
// fix already applied to the Submission note field.
function ChecklistItemRow({ item, onItemChange }) {
  const [reasonDraft, setReasonDraft] = useState(item.blockedReason || '')

  function handleReasonBlur() {
    if (reasonDraft !== (item.blockedReason || '')) onItemChange(item.id, { blockedReason: reasonDraft })
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex cursor-pointer items-center gap-2 [&_input[type=checkbox]]:h-[15px] [&_input[type=checkbox]]:w-[15px]">
        <input
          type="checkbox"
          checked={item.done}
          disabled={item.blocked}
          onChange={() => onItemChange(item.id, { done: !item.done })}
        />
        <span
          className={`flex-1 text-[13px] ${item.done ? 'line-through opacity-55' : ''} ${
            item.blocked ? 'line-through text-overdue opacity-80' : ''
          }`}
        >
          {item.text}
        </span>
        <button
          type="button"
          className={`h-[26px] w-[26px] flex-none cursor-pointer rounded-full border bg-pill-bg text-[13px] leading-none ${item.blocked ? 'border-overdue opacity-100' : 'border-border opacity-50'}`}
          onClick={(e) => {
            e.preventDefault()
            toggleBlocked(item, onItemChange)
          }}
          title={item.blocked ? 'Unblock' : "Mark as blocked / can't be done"}
        >
          🚫
        </button>
      </label>
      {item.blocked && (
        <input
          type="text"
          className="ml-6 rounded-[6px] border border-border bg-bg px-2 py-1.5 text-[13px] text-text-h [font-family:inherit] [font-style:inherit] [font-variant:inherit] [font-weight:inherit] [line-height:inherit]"
          placeholder="Why is this blocked? (optional)"
          value={reasonDraft}
          onChange={(e) => setReasonDraft(e.target.value)}
          onBlur={handleReasonBlur}
        />
      )}
    </div>
  )
}

export default function ChecklistView({ items, onItemChange }) {
  if (!items.length) return null

  return (
    <div className="mb-1.5 flex flex-col gap-1.5">
      {items.map((item) => (
        <ChecklistItemRow key={item.id} item={item} onItemChange={onItemChange} />
      ))}
    </div>
  )
}

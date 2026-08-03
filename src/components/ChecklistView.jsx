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
    <div className="checklist-view-item">
      <label className="checklist-view-row">
        <input
          type="checkbox"
          checked={item.done}
          disabled={item.blocked}
          onChange={() => onItemChange(item.id, { done: !item.done })}
        />
        <span
          className={`checklist-view-text${item.done ? ' checklist-view-done' : ''}${
            item.blocked ? ' checklist-view-blocked' : ''
          }`}
        >
          {item.text}
        </span>
        <button
          type="button"
          className={`checklist-blocked-toggle${item.blocked ? ' checklist-blocked-toggle-active' : ''}`}
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
          className="checklist-blocked-reason-input"
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
    <div className="checklist-view">
      {items.map((item) => (
        <ChecklistItemRow key={item.id} item={item} onItemChange={onItemChange} />
      ))}
    </div>
  )
}

// Blocked and done are mutually exclusive — something not accomplishable
// isn't "done," so marking it blocked clears done, and vice versa.
function toggleBlocked(item, onItemChange) {
  onItemChange(item.id, item.blocked ? { blocked: false, blockedReason: '' } : { blocked: true, done: false })
}

export default function ChecklistView({ items, onItemChange }) {
  if (!items.length) return null

  return (
    <div className="checklist-view">
      {items.map((item) => (
        <div key={item.id} className="checklist-view-item">
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
              value={item.blockedReason || ''}
              onChange={(e) => onItemChange(item.id, { blockedReason: e.target.value })}
            />
          )}
        </div>
      ))}
    </div>
  )
}

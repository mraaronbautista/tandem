function newItem() {
  return { id: crypto.randomUUID(), text: '', done: false, blocked: false, blockedReason: '' }
}

export default function ChecklistEditor({ items, onChange }) {
  function updateItem(id, patch) {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function removeItem(id) {
    onChange(items.filter((item) => item.id !== id))
  }

  // Blocked and done are mutually exclusive — something not accomplishable
  // isn't "done," so marking it blocked clears done, and vice versa.
  function toggleBlocked(item) {
    updateItem(item.id, item.blocked ? { blocked: false, blockedReason: '' } : { blocked: true, done: false })
  }

  return (
    <div className="checklist-editor">
      {items.length > 0 && (
        <div className="checklist-editor-items">
          {items.map((item) => (
            <div key={item.id} className="checklist-editor-item">
              <div className="checklist-editor-row">
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled={item.blocked}
                  onChange={(e) => updateItem(item.id, { done: e.target.checked })}
                />
                <input
                  type="text"
                  placeholder="Subtask…"
                  value={item.text}
                  onChange={(e) => updateItem(item.id, { text: e.target.value })}
                />
                <button
                  type="button"
                  className={`checklist-blocked-toggle${item.blocked ? ' checklist-blocked-toggle-active' : ''}`}
                  onClick={() => toggleBlocked(item)}
                  title={item.blocked ? 'Unblock' : "Mark as blocked / can't be done"}
                >
                  🚫
                </button>
                <button type="button" className="checklist-remove" onClick={() => removeItem(item.id)}>
                  ×
                </button>
              </div>
              {item.blocked && (
                <input
                  type="text"
                  className="checklist-blocked-reason-input"
                  placeholder="Why is this blocked? (optional)"
                  value={item.blockedReason || ''}
                  onChange={(e) => updateItem(item.id, { blockedReason: e.target.value })}
                />
              )}
            </div>
          ))}
        </div>
      )}
      <button type="button" className="checklist-add" onClick={() => onChange([...items, newItem()])}>
        + Add subtask
      </button>
    </div>
  )
}

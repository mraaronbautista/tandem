import { useState } from 'react'

function newItem(text = '') {
  return { id: crypto.randomUUID(), text, done: false, blocked: false, blockedReason: '' }
}

export default function ChecklistEditor({ items, onChange }) {
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')

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

  const bulkLines = bulkText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  function addBulk() {
    if (!bulkLines.length) return
    onChange([...items, ...bulkLines.map((text) => newItem(text))])
    setBulkText('')
    setBulkOpen(false)
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

      {/* One subtask per line, appended in one shot — typing/pasting a
          list of 5+ subtasks one "+ Add subtask" click at a time was the
          only option before this, each one re-focusing a fresh empty
          text input. */}
      {bulkOpen ? (
        <div className="checklist-bulk-add">
          <textarea
            rows={4}
            placeholder={'One subtask per line, e.g.\nBuy paint\nCall contractor\nSchedule inspection'}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            autoFocus
          />
          <div className="checklist-bulk-actions">
            <button
              type="button"
              onClick={() => {
                setBulkOpen(false)
                setBulkText('')
              }}
            >
              Cancel
            </button>
            <button type="button" className="submission-save" onClick={addBulk} disabled={!bulkLines.length}>
              Add {bulkLines.length || ''} subtask{bulkLines.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      ) : (
        <div className="checklist-add-row">
          <button type="button" className="checklist-add" onClick={() => onChange([...items, newItem()])}>
            + Add subtask
          </button>
          <button type="button" className="checklist-add" onClick={() => setBulkOpen(true)}>
            + Add multiple
          </button>
        </div>
      )}
    </div>
  )
}

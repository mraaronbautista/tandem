function newItem() {
  return { id: crypto.randomUUID(), text: '', done: false }
}

export default function ChecklistEditor({ items, onChange }) {
  function updateItem(id, patch) {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function removeItem(id) {
    onChange(items.filter((item) => item.id !== id))
  }

  return (
    <div className="checklist-editor">
      {items.length > 0 && (
        <div className="checklist-editor-items">
          {items.map((item) => (
            <div key={item.id} className="checklist-editor-row">
              <input
                type="checkbox"
                checked={item.done}
                onChange={(e) => updateItem(item.id, { done: e.target.checked })}
              />
              <input
                type="text"
                placeholder="Subtask…"
                value={item.text}
                onChange={(e) => updateItem(item.id, { text: e.target.value })}
              />
              <button type="button" className="checklist-remove" onClick={() => removeItem(item.id)}>
                ×
              </button>
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

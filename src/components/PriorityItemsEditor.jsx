import { WHO_LABEL, WHO_COLOR } from '../lib/whoLabels'

function newItem(who) {
  return { id: crypto.randomUUID(), text: '', who }
}

// Each item becomes its own task on save, so each needs its own "who" —
// unlike ChecklistEditor's items (subtasks of one task), these are
// independent, so there's no done/blocked here, just text + who.
export default function PriorityItemsEditor({ items, onChange, defaultWho }) {
  function updateItem(id, patch) {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function removeItem(id) {
    onChange(items.filter((item) => item.id !== id))
  }

  function toggleWho(item) {
    updateItem(item.id, { who: item.who === 'yours' ? 'assistant' : 'yours' })
  }

  return (
    <div className="priority-items-editor">
      {items.length > 0 && (
        <div className="checklist-editor-items">
          {items.map((item) => (
            <div key={item.id} className="checklist-editor-item">
              <div className="checklist-editor-row">
                <input
                  type="text"
                  placeholder="What's the priority?"
                  value={item.text}
                  onChange={(e) => updateItem(item.id, { text: e.target.value })}
                />
                <button
                  type="button"
                  className="task-who-badge priority-who-toggle"
                  style={{ background: WHO_COLOR[item.who] }}
                  onClick={() => toggleWho(item)}
                  title="Switch who this is for"
                >
                  {WHO_LABEL[item.who]}
                </button>
                <button type="button" className="checklist-remove" onClick={() => removeItem(item.id)}>
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="checklist-add" onClick={() => onChange([...items, newItem(defaultWho)])}>
        + Add priority
      </button>
    </div>
  )
}

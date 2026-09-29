import AssigneePicker from './AssigneePicker'

function newItem(assigneeIds) {
  return { id: crypto.randomUUID(), text: '', assigneeIds }
}

// Each item becomes its own task on save, so each needs its own
// assignees — unlike ChecklistEditor's items (subtasks of one task),
// these are independent, so there's no done/blocked here, just text +
// assignees.
export default function PriorityItemsEditor({ items, onChange, members, defaultAssigneeIds }) {
  function updateItem(id, patch) {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function removeItem(id) {
    onChange(items.filter((item) => item.id !== id))
  }

  return (
    <div>
      {items.length > 0 && (
        <div className="mb-2 flex flex-col gap-2">
          {items.map((item) => (
            <div key={item.id} className="flex flex-col gap-1.5 rounded-[8px] border border-border p-2">
              <div className="flex items-center gap-2 [&_input[type=text]]:flex-1 [&_input[type=text]]:rounded-[6px] [&_input[type=text]]:border [&_input[type=text]]:border-border [&_input[type=text]]:bg-bg [&_input[type=text]]:px-2 [&_input[type=text]]:py-[7px] [&_input[type=text]]:text-text-h [&_input[type=text]]:[font:inherit]">
                <input
                  type="text"
                  placeholder="What's the priority?"
                  value={item.text}
                  onChange={(e) => updateItem(item.id, { text: e.target.value })}
                />
                <button type="button" className="h-[26px] w-[26px] flex-none cursor-pointer rounded-full border border-border bg-pill-bg text-sm leading-none text-text" onClick={() => removeItem(item.id)}>
                  ×
                </button>
              </div>
              <AssigneePicker
                members={members}
                value={item.assigneeIds}
                onChange={(ids) => updateItem(item.id, { assigneeIds: ids })}
              />
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        className="cursor-pointer rounded-[6px] border border-dashed border-border bg-transparent px-2.5 py-1.5 text-[13px] text-text"
        onClick={() => onChange([...items, newItem(defaultAssigneeIds)])}
      >
        + Add priority
      </button>
    </div>
  )
}

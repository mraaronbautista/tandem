export default function ChecklistView({ items, onToggle }) {
  if (!items.length) return null

  return (
    <div className="checklist-view">
      {items.map((item) => (
        <label key={item.id} className="checklist-view-row">
          <input type="checkbox" checked={item.done} onChange={() => onToggle(item.id)} />
          <span className={item.done ? 'checklist-view-text checklist-view-done' : 'checklist-view-text'}>
            {item.text}
          </span>
        </label>
      ))}
    </div>
  )
}

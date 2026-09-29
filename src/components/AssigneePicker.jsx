import { memberColor } from '../lib/whoLabels'

// A multi-select over the live members list, replacing the old single-
// value who <select>/cycle-toggle everywhere a task's assignees are
// picked — tasks.assignee_ids is a real array now, so any subset of
// members can be selected, not just one fixed slot. Each member renders
// as a toggle pill (filled with their own color when selected, outlined
// when not) rather than a native multi-select, which handles touch
// selection poorly for a list this short.
export default function AssigneePicker({ members, value, onChange }) {
  function toggle(id) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {members.map((m) => {
        const selected = value.includes(m.id)
        const color = memberColor(members, m.id)
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => toggle(m.id)}
            className="cursor-pointer rounded-full border px-2.5 py-1 text-[13px] font-semibold transition-colors [font-family:inherit]"
            style={
              selected
                ? { background: color, borderColor: color, color: '#fff' }
                : { background: 'transparent', borderColor: 'var(--border)', color: 'var(--text-h)' }
            }
          >
            {m.display_name}
          </button>
        )
      })}
    </div>
  )
}

import { useState } from 'react'
import { TASK_ICON_OPTIONS } from '../lib/taskIcons'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

// Flat and searchable, not Structured's categorized browser — this app
// curates ~40 icons total (see taskIcons.js), not hundreds, so a
// category system would be overhead with nothing to organize. Opens
// through the same Modal every other picker in this app uses (see
// ScrollSelect.jsx for the closest sibling pattern: a value too long
// for a native popover, shown as a list/grid in a modal instead).
export default function TaskIconPicker({ value, onChange, onClose }) {
  const [query, setQuery] = useState('')

  const filtered = query.trim()
    ? TASK_ICON_OPTIONS.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()))
    : TASK_ICON_OPTIONS

  function pick(name) {
    onChange(name)
    onClose()
  }

  return (
    <Modal onClose={onClose}>
      <ModalCard>
        <h2>Choose an icon</h2>

        <input
          type="text"
          placeholder="Search icons…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          className="w-full rounded-[8px] border border-border bg-bg px-3 py-2.5 text-[15px] text-text-h [font-family:inherit]"
        />

        <div className="grid max-h-[320px] grid-cols-5 gap-2 overflow-y-auto py-1">
          {filtered.map(({ name, icon: Icon }) => (
            <button
              key={name}
              type="button"
              title={name}
              aria-label={name}
              onClick={() => pick(name)}
              className={`flex aspect-square cursor-pointer items-center justify-center rounded-[8px] border ${
                value === name ? 'border-accent bg-accent text-white' : 'border-border bg-pill-bg text-text-h'
              }`}
            >
              <Icon size={18} />
            </button>
          ))}
          {filtered.length === 0 && <p className="col-span-5 py-4 text-center text-sm opacity-60">No icons match "{query}".</p>}
        </div>

        <SubmissionActions>
          {value && (
            <SubmissionButton
              onClick={() => {
                onChange(null)
                onClose()
              }}
            >
              Reset to auto
            </SubmissionButton>
          )}
          <SubmissionButton onClick={onClose}>Cancel</SubmissionButton>
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

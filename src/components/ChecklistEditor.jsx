import { useState } from 'react'
import { Ban, X } from 'lucide-react'
import { SubmissionButton } from './SubmissionActions'

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
    <div>
      {items.length > 0 && (
        <div className="mb-2 flex flex-col gap-1.5">
          {items.map((item) => (
            <div key={item.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2 [&_input[type=checkbox]]:h-4 [&_input[type=checkbox]]:w-4 [&_input[type=checkbox]]:flex-none [&_input[type=text]]:flex-1 [&_input[type=text]]:rounded-[6px] [&_input[type=text]]:border [&_input[type=text]]:border-border [&_input[type=text]]:bg-bg [&_input[type=text]]:px-2 [&_input[type=text]]:py-[7px] [&_input[type=text]]:text-text-h [&_input[type=text]]:[font:inherit]">
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
                  className={`flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-full border bg-pill-bg leading-none ${item.blocked ? 'border-overdue opacity-100' : 'border-border opacity-50'}`}
                  onClick={() => toggleBlocked(item)}
                  title={item.blocked ? 'Unblock' : "Mark as blocked / can't be done"}
                >
                  <Ban size={13} />
                </button>
                <button
                  type="button"
                  className="flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-full border border-border bg-pill-bg text-text"
                  onClick={() => removeItem(item.id)}
                >
                  <X size={14} />
                </button>
              </div>
              {item.blocked && (
                <input
                  type="text"
                  className="ml-6 rounded-[6px] border border-border bg-bg px-2 py-1.5 text-[13px] text-text-h [font-family:inherit] [font-style:inherit] [font-variant:inherit] [font-weight:inherit] [line-height:inherit]"
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
        <div className="flex flex-col gap-1.5">
          <textarea
            className="resize-y rounded-[6px] border border-border bg-bg p-2 text-[13px] text-text-h [font-family:inherit] [font-style:inherit] [font-variant:inherit] [font-weight:inherit] [line-height:inherit]"
            rows={4}
            placeholder={'One subtask per line, e.g.\nBuy paint\nCall contractor\nSchedule inspection'}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setBulkOpen(false)
                setBulkText('')
              }}
            >
              Cancel
            </button>
            <SubmissionButton variant="primary" onClick={addBulk} disabled={!bulkLines.length}>
              Add {bulkLines.length || ''} subtask{bulkLines.length === 1 ? '' : 's'}
            </SubmissionButton>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" className="cursor-pointer rounded-[6px] border border-dashed border-border bg-transparent px-2.5 py-1.5 text-[13px] text-text" onClick={() => onChange([...items, newItem()])}>
            + Add subtask
          </button>
          <button type="button" className="cursor-pointer rounded-[6px] border border-dashed border-border bg-transparent px-2.5 py-1.5 text-[13px] text-text" onClick={() => setBulkOpen(true)}>
            + Add multiple
          </button>
        </div>
      )}
    </div>
  )
}

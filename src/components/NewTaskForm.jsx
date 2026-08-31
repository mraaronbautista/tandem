import { useState } from 'react'
import { Pin, Plus, X } from 'lucide-react'
import TaskForm from './TaskForm'
import Modal from './Modal'

function dateStr(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// The FAB doubles as a speed-dial for the less-frequent actions (report,
// priorities, nudge) — those used to live as separate header icons, which
// got cluttered fast as more got added. "New task" stays the default/most
// common action; extraActions are optional and only expand the FAB into a
// menu when there's something to show.
//
// variant="desktop" (default) renders exactly as before — an
// independently `position: fixed` .quick-actions box. variant="mobile" is
// meant to be placed inside MobileNav.jsx as a flex sibling of the nav
// capsule (so together they read as one centered group, a2-style) rather
// than floating above a full-width bar on its own — it drops the fixed
// positioning via a second class, .quick-actions-inline (App.css), and
// pops its speed-dial menu as an absolutely-positioned overlay instead so
// opening the menu can't shift the nav row's layout.
export default function NewTaskForm({ onCreate, defaultWho, selectedDate, extraActions = [], variant = 'desktop' }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)

  function handleFabClick() {
    if (extraActions.length === 0) {
      setFormOpen(true)
    } else {
      setMenuOpen((v) => !v)
    }
  }

  function handleNewTask() {
    setMenuOpen(false)
    setFormOpen(true)
  }

  function handleAction(action) {
    setMenuOpen(false)
    action.onSelect()
  }

  return (
    <>
      {!formOpen && (
        <div className={variant === 'mobile' ? 'quick-actions quick-actions-inline' : 'quick-actions'}>
          {menuOpen && (
            <div className="quick-actions-menu">
              {extraActions.map((a) => (
                <button key={a.key} type="button" className="quick-action-item" onClick={() => handleAction(a)}>
                  <span className="quick-action-icon">{a.icon}</span>
                  {a.label}
                </button>
              ))}
              <button type="button" className="quick-action-item" onClick={handleNewTask}>
                <span className="quick-action-icon">
                  <Pin size={16} />
                </span>
                New task
              </button>
            </div>
          )}
          <button className="fab-new-task" onClick={handleFabClick} aria-label={menuOpen ? 'Close menu' : 'Actions'}>
            {menuOpen ? <X size={28} strokeWidth={2.5} /> : <Plus size={28} strokeWidth={2.5} />}
          </button>
        </div>
      )}

      {formOpen && (
        <Modal onClose={() => setFormOpen(false)}>
          <TaskForm
            submitLabel="Save task"
            // Anchors a new task to whichever day is currently browsed
            // (Today tab's selectedDate) rather than always today — the
            // default *time* still rounds up from right now (see
            // defaultDueDateTime in TaskForm.jsx), just landing on the
            // selected day instead of today's. Conditionally spread in
            // (not `due_date: selectedDate && dateStr(selectedDate)`) —
            // TaskForm.jsx's hasDueDateKey treats an explicit `due_date:
            // undefined` key as still "present", which flips its All Day
            // checkbox on by mistake; omitting the key entirely when
            // there's no selectedDate avoids that.
            initialValues={{ who: defaultWho, ...(selectedDate ? { due_date: dateStr(selectedDate) } : null) }}
            onCancel={() => setFormOpen(false)}
            onSubmit={async (values) => {
              await onCreate(values)
              setFormOpen(false)
            }}
          />
        </Modal>
      )}
    </>
  )
}

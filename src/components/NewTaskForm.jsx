import { useState } from 'react'
import TaskForm from './TaskForm'
import Modal from './Modal'

// The FAB doubles as a speed-dial for the less-frequent actions (report,
// priorities, nudge) — those used to live as separate header icons, which
// got cluttered fast as more got added. "New task" stays the default/most
// common action; extraActions are optional and only expand the FAB into a
// menu when there's something to show.
export default function NewTaskForm({ onCreate, defaultWho, extraActions = [] }) {
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
        <div className="quick-actions">
          {menuOpen && (
            <div className="quick-actions-menu">
              {extraActions.map((a) => (
                <button key={a.key} type="button" className="quick-action-item" onClick={() => handleAction(a)}>
                  <span className="quick-action-icon">{a.icon}</span>
                  {a.label}
                </button>
              ))}
              <button type="button" className="quick-action-item" onClick={handleNewTask}>
                <span className="quick-action-icon">📌</span>
                New task
              </button>
            </div>
          )}
          <button className="fab-new-task" onClick={handleFabClick} aria-label={menuOpen ? 'Close menu' : 'Actions'}>
            {menuOpen ? '×' : '+'}
          </button>
        </div>
      )}

      {formOpen && (
        <Modal onClose={() => setFormOpen(false)}>
          <TaskForm
            submitLabel="Save task"
            initialValues={{ who: defaultWho }}
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

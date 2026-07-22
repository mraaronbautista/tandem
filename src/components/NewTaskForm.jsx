import { useState } from 'react'
import TaskForm from './TaskForm'
import Modal from './Modal'

export default function NewTaskForm({ onCreate, defaultWho }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {!open && (
        <button className="fab-new-task" onClick={() => setOpen(true)} aria-label="New task">
          +
        </button>
      )}

      {open && (
        <Modal onClose={() => setOpen(false)}>
          <TaskForm
            submitLabel="Save task"
            initialValues={{ who: defaultWho }}
            onCancel={() => setOpen(false)}
            onSubmit={async (values) => {
              await onCreate(values)
              setOpen(false)
            }}
          />
        </Modal>
      )}
    </>
  )
}

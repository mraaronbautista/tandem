import { useState } from 'react'
import { Plus } from 'lucide-react'
import TaskForm from './TaskForm'
import BulkAddTasksForm from './BulkAddTasksForm'
import PrioritiesForm from './PrioritiesForm'
import Modal from './Modal'
import { PeriodTabs, PeriodTab } from './PeriodTabs'

function dateStr(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function FloatingAddButton({ onClick, variant = 'desktop', label = 'Add' }) {
  return (
    <div className={variant === 'mobile' ? 'quick-actions quick-actions-inline' : 'quick-actions'}>
      <button className="fab-new-task" onClick={onClick} aria-label={label} title={label}>
        <Plus size={28} strokeWidth={2.5} />
      </button>
    </div>
  )
}

// Today-specific creation hub. Other destinations give the persistent +
// their own contextual action in TaskBoard.jsx; Today groups the three
// task-planning workflows into one tabbed modal instead of a speed dial.
export default function NewTaskForm({
  onCreate,
  defaultWho,
  selectedDate,
  me,
  members,
  tasks,
  onTasksChanged,
  memberName,
  variant = 'desktop',
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('task')

  function close() {
    setOpen(false)
    setMode('task')
  }

  function openTools() {
    setMode('task')
    setOpen(true)
  }

  const tabs = (
    <PeriodTabs>
      <PeriodTab active={mode === 'task'} onClick={() => setMode('task')}>New task</PeriodTab>
      <PeriodTab active={mode === 'bulk'} onClick={() => setMode('bulk')}>Bulk</PeriodTab>
      <PeriodTab active={mode === 'priorities'} onClick={() => setMode('priorities')}>Priorities</PeriodTab>
    </PeriodTabs>
  )

  return (
    <>
      {!open && <FloatingAddButton variant={variant} onClick={openTools} label="Open task tools" />}

      {open && (
        <Modal onClose={close}>
          {mode === 'task' && (
            <TaskForm
              header={tabs}
              submitLabel="Save task"
              initialValues={{ who: defaultWho, ...(selectedDate ? { due_date: dateStr(selectedDate) } : null) }}
              onCancel={close}
              onSubmit={async (values) => {
                await onCreate(values)
                close()
              }}
            />
          )}
          {mode === 'bulk' && (
            <BulkAddTasksForm
              embedded
              header={tabs}
              me={me}
              members={members}
              tasks={tasks}
              defaultWho={defaultWho}
              onClose={close}
              onCreated={() => {
                onTasksChanged()
                close()
              }}
            />
          )}
          {mode === 'priorities' && (
            <PrioritiesForm embedded header={tabs} me={me} memberName={memberName} onClose={close} />
          )}
        </Modal>
      )}
    </>
  )
}

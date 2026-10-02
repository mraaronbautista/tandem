import { useState } from 'react'
import AddMemberForm from './AddMemberForm'
import MemberAccessForm from './MemberAccessForm'
import MemberCredentialsForm from './MemberCredentialsForm'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

// Admin-only roster for editing another member's feature permissions
// and task_access grants — reached from SettingsMenu.jsx, gated on
// me.is_admin there. No Realtime subscription here (unlike
// StaffLogsView.jsx) — an occasional-use admin config screen doesn't
// need live-sync; `members` is already the same Realtime-synced array
// TaskBoard.jsx passes everywhere else, so a save here shows up
// elsewhere on its own.
export default function ManageMemberAccessView({ members, me, onClose, onMembersChanged }) {
  const others = members.filter((m) => m.id !== me?.id)
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)
  const [resettingLogin, setResettingLogin] = useState(null)

  // Chains straight from creation into editing that same member's task
  // visibility, rather than a combined "review and create" screen —
  // reuses MemberAccessForm.jsx as-is instead of duplicating its Task
  // visibility UI. Uses the row handed back by AddMemberForm directly
  // (not a refetch-and-find) so there's no race with the members-changes
  // Realtime round-trip still in flight.
  function handleCreated(newMember) {
    setAdding(false)
    onMembersChanged?.()
    setEditing(newMember)
  }

  return (
    <Modal onClose={onClose}>
      <ModalCard>
        <h2>Manage member access</h2>

        <div className="flex flex-col gap-2">
          {others.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-3 rounded-sm border border-border px-3 py-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="h-2.5 w-2.5 flex-none rounded-full"
                  style={{ backgroundColor: m.color || '#8a8a8a' }}
                  aria-hidden="true"
                />
                <span className="truncate">{m.display_name}</span>
                {m.is_admin && <span className="flex-none text-xs opacity-80">Admin</span>}
              </span>
              <span className="flex flex-none gap-2">
                <button
                  type="button"
                  className="cursor-pointer rounded-sm border border-border bg-pill-bg px-3 py-1.5 text-sm text-text-h"
                  onClick={() => setResettingLogin(m)}
                >
                  Login
                </button>
                <button
                  type="button"
                  className="cursor-pointer rounded-sm border border-border bg-pill-bg px-3 py-1.5 text-sm text-text-h"
                  onClick={() => setEditing(m)}
                >
                  Edit access
                </button>
              </span>
            </div>
          ))}
          {others.length === 0 && <p className="text-sm opacity-80">No other members yet.</p>}
        </div>

        <SubmissionActions>
          <SubmissionButton onClick={onClose}>Close</SubmissionButton>
          <SubmissionButton variant="primary" onClick={() => setAdding(true)}>
            + Add member
          </SubmissionButton>
        </SubmissionActions>
      </ModalCard>

      {adding && <AddMemberForm members={members} onClose={() => setAdding(false)} onCreated={handleCreated} />}

      {editing && (
        <MemberAccessForm
          target={editing}
          members={members}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}

      {resettingLogin && (
        <MemberCredentialsForm member={resettingLogin} onClose={() => setResettingLogin(null)} />
      )}
    </Modal>
  )
}

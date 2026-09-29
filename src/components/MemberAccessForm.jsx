import { useEffect, useRef, useState } from 'react'
import { PERMISSION_FEATURES, fetchTaskAccessFor, setMemberPermissions, upsertTaskAccess } from '../lib/memberAccess'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

const FEATURE_LABELS = {
  rentals: 'Rentals',
  vault: 'Vault',
  staff: 'Staff',
  // Gates *submitting* a report, not reading one — EodReportsList.jsx has
  // no permission gate, reports stay mutually visible to everyone.
  reports: 'Submit EOD/EOW/EOM reports',
}

const LEVEL_OPTIONS = [
  { value: '', label: 'Hidden' },
  { value: 'view', label: 'View only' },
  { value: 'update', label: 'View & update' },
]

const EMPTY_ACCESS = { level: '', canCreate: false, canDelete: false, canReassign: false }

function accessFromRow(row) {
  if (!row) return { ...EMPTY_ACCESS }
  return {
    level: row.level || '',
    canCreate: row.can_create,
    canDelete: row.can_delete,
    canReassign: row.can_reassign,
  }
}

function accessEqual(a, b) {
  return a.level === b.level && a.canCreate === b.canCreate && a.canDelete === b.canDelete && a.canReassign === b.canReassign
}

// One teammate's row inside the Task visibility list — what `target`
// (the member this whole form is editing) may see/do regarding
// `teammate`'s own tasks. Create/Delete/Reassign are disabled and
// force-cleared whenever level is Hidden, matching task_access's own
// check constraint (task_access_actions_require_access) rather than
// letting the form produce a combination the database would reject.
function TeammateAccessRow({ teammate, access, onChange }) {
  const hidden = access.level === ''

  function setLevel(level) {
    onChange(level === '' ? { level, canCreate: false, canDelete: false, canReassign: false } : { ...access, level })
  }

  function setFlag(key, value) {
    onChange({ ...access, [key]: value })
  }

  return (
    <div className="rounded-sm border border-border p-3">
      <p className="mb-2 text-sm font-semibold text-text-h">{teammate.display_name}</p>

      <div className="mb-2 flex flex-wrap gap-3 text-sm">
        {LEVEL_OPTIONS.map((opt) => (
          <label key={opt.value} className="flex items-center gap-1.5">
            <input
              type="radio"
              name={`level-${teammate.id}`}
              checked={access.level === opt.value}
              onChange={() => setLevel(opt.value)}
            />
            {opt.label}
          </label>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 text-xs opacity-90">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            disabled={hidden}
            checked={access.canCreate}
            onChange={(e) => setFlag('canCreate', e.target.checked)}
          />
          Create & assign tasks
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            disabled={hidden}
            checked={access.canDelete}
            onChange={(e) => setFlag('canDelete', e.target.checked)}
          />
          Delete tasks
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            disabled={hidden}
            checked={access.canReassign}
            onChange={(e) => setFlag('canReassign', e.target.checked)}
          />
          Reassign tasks
        </label>
      </div>
    </div>
  )
}

// Edits one member's (`target`) feature permissions and their
// task_access grant toward every other member. Both writes go through
// admin-only security-definer RPCs (set_member_permissions/
// upsert_task_access) — there's no direct table RLS write path for
// either, by design, so this form has no fallback if the caller isn't
// actually an admin; the RPC just raises 'Not authorized'.
export default function MemberAccessForm({ target, members, onClose, onSaved }) {
  const teammates = members.filter((m) => m.id !== target.id)

  const [permissionChecked, setPermissionChecked] = useState(() =>
    Object.fromEntries(PERMISSION_FEATURES.map((f) => [f, target.permissions?.[f] !== false])),
  )
  const [access, setAccess] = useState({})
  const initialAccessRef = useRef({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchTaskAccessFor(target.id)
      .then((rows) => {
        if (cancelled) return
        const byTeammate = new Map(rows.map((r) => [r.target_id, r]))
        const initial = Object.fromEntries(teammates.map((t) => [t.id, accessFromRow(byTeammate.get(t.id))]))
        initialAccessRef.current = initial
        setAccess(initial)
        setLoading(false)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id])

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const newPermissions = Object.fromEntries(
        PERMISSION_FEATURES.filter((f) => !permissionChecked[f]).map((f) => [f, false]),
      )
      const writes = [setMemberPermissions(target.id, newPermissions)]
      for (const teammate of teammates) {
        const current = access[teammate.id]
        const initial = initialAccessRef.current[teammate.id]
        if (!current || accessEqual(current, initial)) continue
        writes.push(
          upsertTaskAccess(target.id, teammate.id, {
            level: current.level || null,
            canCreate: current.canCreate,
            canDelete: current.canDelete,
            canReassign: current.canReassign,
          }),
        )
      }
      await Promise.all(writes)
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <ModalCard as="form" onSubmit={handleSubmit}>
        <h2>{target.display_name}'s access</h2>
        {error && <p className="error">{error}</p>}

        <div className="submission-field">
          <span className="submission-field-label">Feature access</span>
          <div className="flex flex-col gap-1.5 text-sm">
            {PERMISSION_FEATURES.map((f) => (
              <label key={f} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={permissionChecked[f]}
                  onChange={(e) => setPermissionChecked((prev) => ({ ...prev, [f]: e.target.checked }))}
                />
                {FEATURE_LABELS[f]}
              </label>
            ))}
          </div>
        </div>

        <div className="submission-field">
          <span className="submission-field-label">Task visibility</span>
          {loading ? (
            <p className="text-sm opacity-65">Loading…</p>
          ) : teammates.length === 0 ? (
            <p className="text-sm opacity-65">No other members yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {teammates.map((teammate) => (
                <TeammateAccessRow
                  key={teammate.id}
                  teammate={teammate}
                  access={access[teammate.id] || EMPTY_ACCESS}
                  onChange={(next) => setAccess((prev) => ({ ...prev, [teammate.id]: next }))}
                />
              ))}
            </div>
          )}
        </div>

        <SubmissionActions>
          <SubmissionButton onClick={onClose}>Cancel</SubmissionButton>
          <SubmissionButton type="submit" variant="primary" disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save changes'}
          </SubmissionButton>
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

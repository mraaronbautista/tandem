import { useEffect, useRef, useState } from 'react'
import {
  FEATURE_LABELS,
  PERMISSION_FEATURES,
  fetchPrioritiesAccessFor,
  fetchReportAccessFor,
  fetchTaskAccessFor,
  setMemberPermissions,
  setPrioritiesAccess,
  setReportAccess,
  upsertTaskAccess,
} from '../lib/memberAccess'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'
import { friendlyError } from '../lib/friendlyError'

const LEVEL_OPTIONS = [
  { value: '', label: "Can't see them" },
  { value: 'view', label: 'Can see them' },
  { value: 'update', label: 'Can see and edit them' },
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
      <p className="mb-2 text-sm font-semibold text-text-h">{teammate.display_name}'s tasks</p>

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
          Can add tasks for {teammate.display_name}
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            disabled={hidden}
            checked={access.canDelete}
            onChange={(e) => setFlag('canDelete', e.target.checked)}
          />
          Can delete them
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            disabled={hidden}
            checked={access.canReassign}
            onChange={(e) => setFlag('canReassign', e.target.checked)}
          />
          Can reassign them
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
  // Which other members' reports/priorities `target` can read — plain id
  // Sets, not a level like task access, since reading someone's reports
  // or priorities has no finer-grained action to configure than "can" or
  // "can't."
  const [reportAccess, setReportAccessState] = useState(() => new Set())
  const initialReportAccessRef = useRef(new Set())
  const [prioritiesAccess, setPrioritiesAccessState] = useState(() => new Set())
  const initialPrioritiesAccessRef = useRef(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchTaskAccessFor(target.id), fetchReportAccessFor(target.id), fetchPrioritiesAccessFor(target.id)])
      .then(([taskRows, reportRows, prioritiesRows]) => {
        if (cancelled) return
        const byTeammate = new Map(taskRows.map((r) => [r.target_id, r]))
        const initial = Object.fromEntries(teammates.map((t) => [t.id, accessFromRow(byTeammate.get(t.id))]))
        initialAccessRef.current = initial
        setAccess(initial)
        const reportIds = new Set(reportRows.map((r) => r.target_id))
        initialReportAccessRef.current = reportIds
        setReportAccessState(reportIds)
        const prioritiesIds = new Set(prioritiesRows.map((r) => r.target_id))
        initialPrioritiesAccessRef.current = prioritiesIds
        setPrioritiesAccessState(prioritiesIds)
        setLoading(false)
      })
      .catch((err) => !cancelled && setError(friendlyError(err)))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id])

  function toggleReportAccess(teammateId) {
    setReportAccessState((prev) => {
      const next = new Set(prev)
      if (next.has(teammateId)) next.delete(teammateId)
      else next.add(teammateId)
      return next
    })
  }

  function togglePrioritiesAccess(teammateId) {
    setPrioritiesAccessState((prev) => {
      const next = new Set(prev)
      if (next.has(teammateId)) next.delete(teammateId)
      else next.add(teammateId)
      return next
    })
  }

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
      for (const teammate of teammates) {
        const canView = reportAccess.has(teammate.id)
        const couldView = initialReportAccessRef.current.has(teammate.id)
        if (canView === couldView) continue
        writes.push(setReportAccess(target.id, teammate.id, canView))
      }
      for (const teammate of teammates) {
        const canView = prioritiesAccess.has(teammate.id)
        const couldView = initialPrioritiesAccessRef.current.has(teammate.id)
        if (canView === couldView) continue
        writes.push(setPrioritiesAccess(target.id, teammate.id, canView))
      }
      await Promise.all(writes)
      onSaved()
    } catch (err) {
      setError(friendlyError(err))
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
          <p className="mb-1.5 text-xs opacity-80">Untick anything {target.display_name} should not be able to use.</p>
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
          <p className="mb-1.5 text-xs opacity-80">
            What {target.display_name} can do with each teammate's tasks. The add, delete and reassign options only
            apply once they can see the tasks.
          </p>
          {loading ? (
            <p className="text-sm opacity-80">Loading…</p>
          ) : teammates.length === 0 ? (
            <p className="text-sm opacity-80">No other members yet.</p>
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

        <div className="submission-field">
          <span className="submission-field-label">Report visibility</span>
          <p className="mb-1.5 text-xs opacity-80">Whose submitted reports {target.display_name} can read.</p>
          {loading ? (
            <p className="text-sm opacity-80">Loading…</p>
          ) : teammates.length === 0 ? (
            <p className="text-sm opacity-80">No other members yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5 text-sm">
              {teammates.map((teammate) => (
                <label key={teammate.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={reportAccess.has(teammate.id)}
                    onChange={() => toggleReportAccess(teammate.id)}
                  />
                  Can read {teammate.display_name}'s reports
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="submission-field">
          <span className="submission-field-label">Priorities visibility</span>
          <p className="mb-1.5 text-xs opacity-80">Whose priorities {target.display_name} can read.</p>
          {loading ? (
            <p className="text-sm opacity-80">Loading…</p>
          ) : teammates.length === 0 ? (
            <p className="text-sm opacity-80">No other members yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5 text-sm">
              {teammates.map((teammate) => (
                <label key={teammate.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={prioritiesAccess.has(teammate.id)}
                    onChange={() => togglePrioritiesAccess(teammate.id)}
                  />
                  Can read {teammate.display_name}'s priorities
                </label>
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

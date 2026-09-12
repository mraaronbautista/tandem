import { useState } from 'react'
import { changeOwnPassword } from '../lib/staff'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

const FIELD_CLASS =
  'w-full rounded-[8px] border border-border bg-bg px-3 py-[10px] text-[15px] text-text-h [font-family:inherit] [line-height:inherit]'

// A staff account changing its own login password — the property-manager
// counterpart to Ada/Aaron's own account settings, which staff never
// reaches (StaffClockView.jsx is their entire UI; see "Member-only how-to"
// in schema.sql/CLAUDE.md). No current-password re-entry: GoTrue trusts
// the active session for auth.updateUser(), same as every other
// self-service password change on top of an existing session.
export default function StaffChangePasswordForm({ onClose }) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.")
      return
    }
    setSaving(true)
    setError('')
    try {
      await changeOwnPassword(newPassword)
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <ModalCard as="form" onSubmit={handleSubmit}>
        <h2>Change password</h2>
        {error && <p className="error">{error}</p>}

        {done ? (
          <p className="text-sm text-online">Password changed.</p>
        ) : (
          <>
            <label>
              New password
              <input
                required
                autoFocus
                type="password"
                minLength={8}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className={FIELD_CLASS}
              />
            </label>
            <label>
              Confirm new password
              <input
                required
                type="password"
                minLength={8}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className={FIELD_CLASS}
              />
              <span className="mt-1 block text-xs opacity-65">At least 8 characters.</span>
            </label>
          </>
        )}

        <SubmissionActions>
          <SubmissionButton onClick={onClose}>{done ? 'Close' : 'Cancel'}</SubmissionButton>
          {!done && (
            <SubmissionButton type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Change password'}
            </SubmissionButton>
          )}
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

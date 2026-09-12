import { useState } from 'react'
import { resetStaffPassword } from '../lib/staff'
import { generateStrongPassword } from '../lib/vault'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

const FIELD_CLASS =
  'w-full rounded-[8px] border border-border bg-bg px-3 py-[10px] text-[15px] text-text-h [font-family:inherit] [line-height:inherit]'

// A member (Ada/Aaron) overwriting a property manager's login password —
// separate from StaffProfileForm.jsx's own edit fields (name/rates/
// cadence/job description) since this is a distinct, more sensitive
// action: it immediately invalidates whatever password that person is
// currently using, so it gets its own explicit button rather than being
// bundled into "Save changes." Same "share this with them directly, no
// email to send it to" reasoning create-account's own password field
// already establishes — reuses that same Generate button.
export default function StaffResetPasswordForm({ staffMember, onClose }) {
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await resetStaffPassword({ staffId: staffMember.id, newPassword })
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
        <h2>Reset {staffMember.display_name}'s password</h2>
        {error && <p className="error">{error}</p>}

        {done ? (
          <>
            <p className="text-sm text-online">
              Password reset. They'll need to sign in again with this new password — their current session, if any,
              stays active until they do.
            </p>
            <p className="rounded-[8px] border border-border bg-bg px-3 py-[10px] text-[15px] text-text-h">
              {newPassword}
            </p>
            <p className="text-xs opacity-65">Share this with them directly — there's no email to send it to.</p>
          </>
        ) : (
          <label>
            New password
            <div className="flex gap-2">
              <input
                required
                autoFocus
                minLength={8}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className={FIELD_CLASS}
              />
              <button
                type="button"
                className="flex-none cursor-pointer rounded-sm border border-border bg-pill-bg px-3 py-2 text-sm text-text-h"
                onClick={() => setNewPassword(generateStrongPassword(12))}
              >
                Generate
              </button>
            </div>
            <span className="mt-1 block text-xs opacity-65">At least 8 characters.</span>
          </label>
        )}

        <SubmissionActions>
          <SubmissionButton onClick={onClose}>{done ? 'Close' : 'Cancel'}</SubmissionButton>
          {!done && (
            <SubmissionButton type="submit" variant="primary" disabled={saving}>
              {saving ? 'Resetting…' : 'Reset password'}
            </SubmissionButton>
          )}
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

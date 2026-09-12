import { useState } from 'react'
import { updateStaffCredentials } from '../lib/staff'
import { generateStrongPassword } from '../lib/vault'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

const FIELD_CLASS =
  'w-full rounded-[8px] border border-border bg-bg px-3 py-[10px] text-[15px] text-text-h [font-family:inherit] [line-height:inherit]'

// A member (Ada/Aaron) changing a property manager's login — username,
// password, or both. Separate from StaffProfileForm.jsx's own edit fields
// (name/rates/cadence/job description) since this is a distinct, more
// sensitive action: either field here immediately changes how that person
// signs in, so it gets its own explicit button rather than being bundled
// into "Save changes." Changing just the username (leaving password blank)
// is what makes account turnover easy — reassigning this same staff row
// (and its rates/job description/time_entries history) to a new employee
// without creating a fresh account and losing that continuity. There's no
// way to show the *current* username here (staff's own auth.users row
// isn't queryable through the anon client), so both fields are write-only,
// same as a password reset already was.
export default function StaffCredentialsForm({ staffMember, onClose }) {
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    const cleanUsername = newUsername.trim()
    if (!cleanUsername && !newPassword) {
      setError('Enter a new username, a new password, or both.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await updateStaffCredentials({
        staffId: staffMember.id,
        newUsername: cleanUsername || null,
        newPassword: newPassword || null,
      })
      setResult({ username: cleanUsername || null, password: newPassword || null })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <ModalCard as="form" onSubmit={handleSubmit}>
        <h2>Update {staffMember.display_name}'s login</h2>
        {error && <p className="error">{error}</p>}

        {result ? (
          <>
            <p className="text-sm text-online">
              Login updated. They'll need to sign in again with the new details — their current session, if any,
              stays active until they do.
            </p>
            {result.username && (
              <label>
                New username
                <p className="rounded-[8px] border border-border bg-bg px-3 py-[10px] text-[15px] text-text-h">
                  {result.username}
                </p>
              </label>
            )}
            {result.password && (
              <label>
                New password
                <p className="rounded-[8px] border border-border bg-bg px-3 py-[10px] text-[15px] text-text-h">
                  {result.password}
                </p>
              </label>
            )}
            <p className="text-xs opacity-65">Share this with them directly — there's no email to send it to.</p>
          </>
        ) : (
          <>
            <label>
              New username (optional)
              <input
                autoFocus
                placeholder="Leave blank to keep the current one"
                value={newUsername}
                onChange={(event) => setNewUsername(event.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                className={FIELD_CLASS}
              />
              <span className="mt-1 block text-xs opacity-65">
                Useful for handing this role off to a new employee — their rates, job description, and shift history
                stay attached to this account.
              </span>
            </label>
            <label>
              New password (optional)
              <div className="flex gap-2">
                <input
                  minLength={8}
                  placeholder="Leave blank to keep the current one"
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
          </>
        )}

        <SubmissionActions>
          <SubmissionButton onClick={onClose}>{result ? 'Close' : 'Cancel'}</SubmissionButton>
          {!result && (
            <SubmissionButton type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Update login'}
            </SubmissionButton>
          )}
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

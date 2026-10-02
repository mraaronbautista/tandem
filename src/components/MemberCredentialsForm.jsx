import { useState } from 'react'
import { updateMemberCredentials } from '../lib/memberAccess'
import { generateStrongPassword } from '../lib/vault'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'
import { friendlyError } from '../lib/friendlyError'

const FIELD_CLASS =
  'w-full rounded-[8px] border border-border bg-bg px-3 py-[10px] text-[15px] text-text-h [font-family:inherit] [line-height:inherit]'

// Admin-only: reset another member's username and/or password. Mirrors
// StaffCredentialsForm.jsx exactly, aimed at members.id instead of
// staff.id (see update-member-credentials/index.ts for why members never
// had this until now). Reached from ManageMemberAccessView.jsx, separate
// from MemberAccessForm.jsx's own Save — same "credential changes are a
// distinct, more sensitive action" reasoning the staff version already
// established, not folded into feature/task-access saving.
export default function MemberCredentialsForm({ member, onClose }) {
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
      await updateMemberCredentials({
        memberId: member.id,
        newUsername: cleanUsername || null,
        newPassword: newPassword || null,
      })
      setResult({ username: cleanUsername || null, password: newPassword || null })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <ModalCard as="form" onSubmit={handleSubmit}>
        <h2>Update {member.display_name}'s login</h2>
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
            <p className="text-xs opacity-80">Share this with them directly — there's no email to send it to.</p>
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
              <span className="mt-1 block text-xs opacity-80">At least 8 characters.</span>
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

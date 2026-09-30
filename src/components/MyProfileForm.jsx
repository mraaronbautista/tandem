import { useState } from 'react'
import { updateMemberProfile, changeOwnPassword } from '../lib/members'
import { MEMBER_COLOR_PALETTE } from '../lib/memberAccess'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

const FIELD_CLASS =
  'w-full rounded-[8px] border border-border bg-bg px-3 py-[10px] text-[15px] text-text-h [font-family:inherit] [line-height:inherit]'

// Self-service display name/color/password for any member — the one gap
// "Not yet built" in CLAUDE.md's Members section used to name explicitly.
// Reuses AddMemberForm.jsx's color-swatch picker and
// StaffChangePasswordForm.jsx's password fields verbatim rather than
// building either pattern a third way. Default timezone is deliberately
// NOT duplicated here — it already has its own row directly in
// SettingsMenu.jsx, and the plan doc's own "avoid duplicate timezone
// controls" note argues against a second control for the same value.
export default function MyProfileForm({ me, onClose, onSaved }) {
  const [displayName, setDisplayName] = useState(me.display_name || '')
  const [color, setColor] = useState(me.color || MEMBER_COLOR_PALETTE[0])
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    const cleanName = displayName.trim()
    if (!cleanName) {
      setError('Display name is required.')
      return
    }
    if ((newPassword || confirmPassword) && newPassword !== confirmPassword) {
      setError("Passwords don't match.")
      return
    }
    setSaving(true)
    setError('')
    try {
      await updateMemberProfile(me.id, { displayName: cleanName, color })
      if (newPassword) await changeOwnPassword(newPassword)
      setDone(true)
      onSaved?.({ display_name: cleanName, color })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <ModalCard as="form" onSubmit={handleSubmit}>
        <h2>My profile</h2>
        {error && <p className="error">{error}</p>}

        {done ? (
          <p className="text-sm text-online">Saved.</p>
        ) : (
          <>
            <label>
              Display name
              <input
                required
                autoFocus
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className={FIELD_CLASS}
              />
            </label>

            <div className="submission-field">
              <span className="submission-field-label">Badge color</span>
              <div className="flex gap-2">
                {MEMBER_COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Use color ${c}`}
                    onClick={() => setColor(c)}
                    className="h-7 w-7 cursor-pointer rounded-full transition-transform duration-[120ms] ease-tactile active:scale-90"
                    style={{
                      backgroundColor: c,
                      outline: color === c ? '2px solid var(--text-h)' : 'none',
                      outlineOffset: '2px',
                    }}
                  />
                ))}
              </div>
            </div>

            <label>
              New password (optional)
              <input
                type="password"
                minLength={8}
                placeholder="Leave blank to keep your current password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className={FIELD_CLASS}
              />
            </label>
            {newPassword && (
              <label>
                Confirm new password
                <input
                  type="password"
                  minLength={8}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className={FIELD_CLASS}
                />
                <span className="mt-1 block text-xs opacity-65">At least 8 characters.</span>
              </label>
            )}
          </>
        )}

        <SubmissionActions>
          <SubmissionButton onClick={onClose}>{done ? 'Close' : 'Cancel'}</SubmissionButton>
          {!done && (
            <SubmissionButton type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </SubmissionButton>
          )}
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

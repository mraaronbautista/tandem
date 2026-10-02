import { useState } from 'react'
import { FEATURE_LABELS, MEMBER_COLOR_PALETTE, PERMISSION_FEATURES, createMemberAccount } from '../lib/memberAccess'
import { generateStrongPassword } from '../lib/vault'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'
import { friendlyError } from '../lib/friendlyError'

const FIELD_CLASS =
  'w-full rounded-[8px] border border-border bg-bg px-3 py-[10px] text-[15px] text-text-h [font-family:inherit] [line-height:inherit]'

// Doc's proposed starting template: Rentals/Staff off, Reports and
// Working status left allowed (deny-list, so "on" just means absent —
// see PERMISSION_FEATURES' own comment). Editable before creation, same
// as everything else in this form. Vault access isn't set here at all
// any more — it's a separate per-vault vault_access grant (schema.sql),
// SQL-editor-only for now, not one of this app's own permissions.vault
// keys.
const DEFAULT_DENIED = new Set(['rentals', 'staff'])

// Creates a brand-new member account — the piece Add Member was missing:
// creating an auth.users row needs the service-role key, so this goes
// through create-member-account/index.ts rather than a plain insert (see
// its own header comment). Deliberately just account + feature
// permissions here, not task_access grants too — ManageMemberAccessView.jsx
// chains straight into the already-built MemberAccessForm.jsx for that
// right after creation succeeds, reusing it instead of duplicating a
// second copy of the same UI in a combined "review and create" screen.
export default function AddMemberForm({ members, onClose, onCreated }) {
  const usedColors = new Set(members.map((m) => m.color))
  const defaultColor = MEMBER_COLOR_PALETTE.find((c) => !usedColors.has(c)) || MEMBER_COLOR_PALETTE[0]

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [color, setColor] = useState(defaultColor)
  const [denied, setDenied] = useState(DEFAULT_DENIED)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggleFeature(feature, allowed) {
    setDenied((prev) => {
      const next = new Set(prev)
      if (allowed) next.delete(feature)
      else next.add(feature)
      return next
    })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const permissions = Object.fromEntries([...denied].map((f) => [f, false]))
      const created = await createMemberAccount({
        username: username.trim(),
        password,
        displayName: displayName.trim(),
        color,
        permissions,
      })
      onCreated({ id: created.id, display_name: displayName.trim(), color, permissions, is_admin: false })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <ModalCard as="form" onSubmit={handleSubmit}>
        <h2>Add a member</h2>
        {error && <p className="error">{error}</p>}

        <label>
          Username (how they sign in — no email needed)
          <input
            required
            autoFocus
            placeholder="e.g. maria"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
            className={FIELD_CLASS}
          />
        </label>

        <label>
          Password
          <div className="flex gap-2">
            <input
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={FIELD_CLASS}
            />
            <button
              type="button"
              className="flex-none cursor-pointer rounded-sm border border-border bg-pill-bg px-3 py-2 text-sm text-text-h"
              onClick={() => setPassword(generateStrongPassword(12))}
            >
              Generate
            </button>
          </div>
          <span className="mt-1 block text-xs opacity-80">
            Share this with them directly — there's no email to send it to. At least 8 characters.
          </span>
        </label>

        <label>
          Display name
          <input
            required
            placeholder="e.g. Maria"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
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

        <div className="submission-field">
          <span className="submission-field-label">Feature access</span>
          <div className="flex flex-col gap-1.5 text-sm">
            {PERMISSION_FEATURES.map((f) => (
              <label key={f} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!denied.has(f)}
                  onChange={(e) => toggleFeature(f, e.target.checked)}
                />
                {FEATURE_LABELS[f]}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs opacity-80">
            Task visibility toward each existing member is set next, right after the account is created.
          </p>
        </div>

        <SubmissionActions>
          <SubmissionButton onClick={onClose}>Cancel</SubmissionButton>
          <SubmissionButton type="submit" variant="primary" disabled={saving}>
            {saving ? 'Creating…' : 'Create account'}
          </SubmissionButton>
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

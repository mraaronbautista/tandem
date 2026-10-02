import { useState } from 'react'
import { encryptJSON, generateStrongPassword, createVaultEntry, updateVaultEntry } from '../lib/vault'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'
import { useConfirm } from '../lib/confirmContext'

export default function VaultEntryForm({
  vaultId,
  vaultKey,
  createdBy,
  entry,
  existingFolders = [],
  isPrivateVault = false,
  otherVaultMembers = [],
  onClose,
  onSaved,
}) {
  const confirm = useConfirm()
  const [label, setLabel] = useState(entry?.label || '')
  const [username, setUsername] = useState(entry?.username || '')
  const [loginMethod, setLoginMethod] = useState(entry?.loginMethod || '')
  const [password, setPassword] = useState(entry?.password || '')
  const [url, setUrl] = useState(entry?.url || '')
  const [notes, setNotes] = useState(entry?.notes || '')
  const [folder, setFolder] = useState(entry?.folder || '')
  // Only meaningful (and only rendered) when isPrivateVault — an entry in
  // a non-private vault stays visible to every vault member regardless of
  // this. Defaults to empty (private to the creator) for a new entry,
  // same default cork_notes.shared_with already established.
  const [sharedWith, setSharedWith] = useState(entry?.sharedWith || [])
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggleShared(memberId) {
    setSharedWith((prev) => (prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]))
  }

  // A freshly generated password (or any other edit) is gone for good if
  // this closes without saving — unlike the rest of the app, the vault
  // has no reset-and-recover path, just "Reset vault" wiping everything.
  // Guards every way this modal can close (backdrop click, Escape, and
  // the Cancel button all route through Modal's onClose) rather than
  // just the click-outside case, since a stray Escape or a misclicked
  // Cancel loses the draft exactly the same way.
  function hasUnsavedChanges() {
    const originalShared = entry?.sharedWith || []
    return (
      label !== (entry?.label || '') ||
      username !== (entry?.username || '') ||
      loginMethod !== (entry?.loginMethod || '') ||
      password !== (entry?.password || '') ||
      url !== (entry?.url || '') ||
      notes !== (entry?.notes || '') ||
      folder !== (entry?.folder || '') ||
      sharedWith.length !== originalShared.length ||
      sharedWith.some((id) => !originalShared.includes(id))
    )
  }

  async function handleClose() {
    if (hasUnsavedChanges()) {
      const ok = await confirm({
        title: 'Discard your changes?',
        message: 'Your unsaved changes to this entry will be lost.',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
      })
      if (!ok) return
    }
    onClose()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!label.trim()) return
    setSaving(true)
    setError('')
    try {
      const value = {
        label: label.trim(),
        username: username.trim(),
        loginMethod: loginMethod.trim(),
        password,
        url: url.trim(),
        notes: notes.trim(),
        folder,
      }
      const { ciphertext, iv } = await encryptJSON(vaultKey, value)
      const saved = entry
        ? await updateVaultEntry(entry.id, { ciphertext, iv, shared_with: isPrivateVault ? sharedWith : undefined })
        : await createVaultEntry({
            vault_id: vaultId,
            ciphertext,
            iv,
            shared_with: sharedWith,
            created_by: createdBy,
          })
      onSaved({ ...value, id: saved.id, sharedWith: saved.shared_with })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={handleClose}>
      <ModalCard as="form" onSubmit={handleSubmit}>
        <h2>{entry ? 'Edit entry' : 'New entry'}</h2>

        {error && <p className="error">{error}</p>}

        <label>
          Label
          <input
            required
            autoFocus
            placeholder="e.g. Chase Bank"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>

        <label>
          Folder (optional)
          {/* Free text, not a fixed list — typing any name here is how a
              folder gets created in the first place (folders are just a
              tag on entries, not their own stored row; see lib/vault.js).
              The datalist only suggests folders that already exist
              somewhere, so retyping an existing name (fixing a typo
              aside) merges into it rather than spawning a near-duplicate. */}
          <input
            list="vault-folder-options"
            placeholder="General"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          />
          <datalist id="vault-folder-options">
            {existingFolders.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>

        <label>
          Username / email
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>

        <label>
          Login method (optional)
          <input
            placeholder="e.g. Google — leave blank if this account has its own password"
            value={loginMethod}
            onChange={(e) => setLoginMethod(e.target.value)}
          />
        </label>

        <label>
          Password
          <div className="vault-password-input-row">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className="vault-copy" onClick={() => setShowPassword((v) => !v)}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
            <button type="button" className="vault-copy" onClick={() => setPassword(generateStrongPassword())}>
              Generate
            </button>
          </div>
        </label>

        <label>
          URL
          <input value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>

        <label>
          Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {/* Only this vault type has per-entry privacy at all — a
            household-vault entry stays visible to every vault member
            regardless, no picker needed (see schema.sql's
            vault_has_private_entries()). Empty by default, same as
            cork_notes' own pin-sharing checkboxes. */}
        {isPrivateVault && otherVaultMembers.length > 0 && (
          <div className="submission-field">
            <span className="submission-field-label">Share with</span>
            <div className="flex flex-col gap-1.5 text-sm">
              {otherVaultMembers.map((m) => (
                <label key={m.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={sharedWith.includes(m.id)} onChange={() => toggleShared(m.id)} />
                  {m.display_name}
                </label>
              ))}
            </div>
          </div>
        )}

        <SubmissionActions>
          <SubmissionButton onClick={handleClose}>Cancel</SubmissionButton>
          <SubmissionButton type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </SubmissionButton>
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

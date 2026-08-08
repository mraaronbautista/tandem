import { useState } from 'react'
import { encryptJSON, generateStrongPassword, createVaultEntry, updateVaultEntry } from '../lib/vault'
import Modal from './Modal'

export default function VaultEntryForm({ vaultKey, createdBy, entry, onClose, onSaved }) {
  const [label, setLabel] = useState(entry?.label || '')
  const [username, setUsername] = useState(entry?.username || '')
  const [loginMethod, setLoginMethod] = useState(entry?.loginMethod || '')
  const [password, setPassword] = useState(entry?.password || '')
  const [url, setUrl] = useState(entry?.url || '')
  const [notes, setNotes] = useState(entry?.notes || '')
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!label.trim()) return
    setSaving(true)
    try {
      const value = {
        label: label.trim(),
        username: username.trim(),
        loginMethod: loginMethod.trim(),
        password,
        url: url.trim(),
        notes: notes.trim(),
      }
      const { ciphertext, iv } = await encryptJSON(vaultKey, value)
      const saved = entry
        ? await updateVaultEntry(entry.id, { ciphertext, iv })
        : await createVaultEntry({ ciphertext, iv, created_by: createdBy })
      onSaved({ ...value, id: saved.id })
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <form className="submission-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>{entry ? 'Edit entry' : 'New entry'}</h2>

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

        <div className="submission-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="submission-save" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

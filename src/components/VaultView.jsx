import { useEffect, useState } from 'react'
import { fetchVaultMeta, setupVault, unlockVault, resetVault, fetchVaultEntries, decryptJSON } from '../lib/vault'
import Modal from './Modal'
import VaultEntryForm from './VaultEntryForm'
import VaultEntryDetail from './VaultEntryDetail'
import VaultExportForm from './VaultExportForm'

const RESET_CONFIRM_WORD = 'RESET'

// meta: undefined while loading, null once fetched if no vault exists yet,
// otherwise the row (salt + canary). vaultKey lives only in this
// component's state — never persisted to localStorage/sessionStorage —
// so it's re-derived from the master password every time the vault is
// reopened, even within the same browser session.
export default function VaultView({ me, onClose }) {
  const [meta, setMeta] = useState(undefined)
  const [vaultKey, setVaultKey] = useState(null)
  const [entries, setEntries] = useState([])
  const [error, setError] = useState('')

  const [masterPassword, setMasterPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  // A typo here is unrecoverable — there's no reset-and-recover path,
  // just "Reset vault" wiping everything — so unlike most password
  // fields, being able to double-check it visually actually matters.
  // One shared toggle since setup's and unlock's password fields never
  // render at the same time.
  const [showMasterPassword, setShowMasterPassword] = useState(false)

  const [showReset, setShowReset] = useState(false)
  const [resetConfirmText, setResetConfirmText] = useState('')
  const [resetting, setResetting] = useState(false)

  const [formOpen, setFormOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState(null)
  const [selectedEntry, setSelectedEntry] = useState(null)
  const [exportOpen, setExportOpen] = useState(false)

  useEffect(() => {
    fetchVaultMeta()
      .then(setMeta)
      .catch((err) => setError(err.message))
  }, [])

  async function loadEntries(key) {
    try {
      const rows = await fetchVaultEntries()
      const decrypted = await Promise.all(
        rows.map(async (row) => ({ ...(await decryptJSON(key, row.ciphertext, row.iv)), id: row.id })),
      )
      setEntries(decrypted)
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleSetup(e) {
    e.preventDefault()
    if (masterPassword.length < 8) {
      setError('Use at least 8 characters for the master password.')
      return
    }
    if (masterPassword !== confirmPassword) {
      setError("Passwords don't match.")
      return
    }
    setUnlocking(true)
    setError('')
    try {
      const { meta: savedMeta, key } = await setupVault(masterPassword)
      setMeta(savedMeta)
      setVaultKey(key)
      setMasterPassword('')
      setConfirmPassword('')
      await loadEntries(key)
    } catch (err) {
      setError(err.message)
    } finally {
      setUnlocking(false)
    }
  }

  async function handleUnlock(e) {
    e.preventDefault()
    setUnlocking(true)
    setError('')
    try {
      const key = await unlockVault(masterPassword, meta)
      setVaultKey(key)
      setMasterPassword('')
      await loadEntries(key)
    } catch (err) {
      setError(err.message)
    } finally {
      setUnlocking(false)
    }
  }

  async function handleReset() {
    setResetting(true)
    try {
      await resetVault()
      setMeta(null)
      setVaultKey(null)
      setEntries([])
      setShowReset(false)
      setResetConfirmText('')
    } catch (err) {
      setError(err.message)
    } finally {
      setResetting(false)
    }
  }

  function handleEntryChanged() {
    setFormOpen(false)
    setEditingEntry(null)
    setSelectedEntry(null)
    loadEntries(vaultKey)
  }

  return (
    <Modal onClose={onClose}>
      <div className="submission-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Vault</h2>

        {error && <p className="error">{error}</p>}

        {meta === undefined && <p className="loading">Loading…</p>}

        {meta === null && (
          <form onSubmit={handleSetup}>
            <p className="vault-warning">
              Set a master password to protect this vault. It's encrypted before it ever leaves your browser — if
              you forget this password, there is no way to recover what's stored here, for anyone, ever. Write it
              down somewhere safe.
            </p>
            <label>
              Master password
              <div className="vault-password-input-row">
                <input
                  type={showMasterPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={masterPassword}
                  onChange={(e) => setMasterPassword(e.target.value)}
                />
                <button type="button" className="vault-copy" onClick={() => setShowMasterPassword((v) => !v)}>
                  {showMasterPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>
            <label>
              Confirm master password
              <input
                type={showMasterPassword ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </label>
            <div className="submission-actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="submission-save" disabled={unlocking}>
                {unlocking ? 'Setting up…' : 'Set up vault'}
              </button>
            </div>
          </form>
        )}

        {meta && !vaultKey && !showReset && (
          <form onSubmit={handleUnlock}>
            <label>
              Master password
              <div className="vault-password-input-row">
                <input
                  type={showMasterPassword ? 'text' : 'password'}
                  required
                  autoFocus
                  value={masterPassword}
                  onChange={(e) => setMasterPassword(e.target.value)}
                />
                <button type="button" className="vault-copy" onClick={() => setShowMasterPassword((v) => !v)}>
                  {showMasterPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>
            <div className="submission-actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="submission-save" disabled={unlocking}>
                {unlocking ? 'Unlocking…' : 'Unlock'}
              </button>
            </div>
            <button type="button" className="vault-forgot-link" onClick={() => setShowReset(true)}>
              Forgot master password?
            </button>
          </form>
        )}

        {meta && !vaultKey && showReset && (
          <div>
            <p className="vault-warning">
              Resetting permanently deletes every entry in this vault — there is no way to recover them, forgotten
              master password or not. Only do this if you're truly starting over.
            </p>
            <label className="submission-field">
              Type <strong>{RESET_CONFIRM_WORD}</strong> to confirm
              <input
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value)}
                placeholder={RESET_CONFIRM_WORD}
              />
            </label>
            <div className="submission-actions">
              <button type="button" onClick={() => setShowReset(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="rental-delete-booking"
                disabled={resetConfirmText !== RESET_CONFIRM_WORD || resetting}
                onClick={handleReset}
              >
                {resetting ? 'Resetting…' : 'Reset vault'}
              </button>
            </div>
          </div>
        )}

        {vaultKey && (
          <>
            <div className="vault-toolbar">
              <button
                type="button"
                className="rental-add-booking"
                onClick={() => {
                  setEditingEntry(null)
                  setFormOpen(true)
                }}
              >
                + Add entry
              </button>
              {entries.length > 0 && (
                <button type="button" className="rental-add-booking" onClick={() => setExportOpen(true)}>
                  Export
                </button>
              )}
            </div>

            {entries.length === 0 && <p className="task-notes-empty">No entries yet.</p>}

            <div className="vault-entry-list">
              {entries.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  className="vault-entry-row"
                  onClick={() => setSelectedEntry(entry)}
                >
                  <span className="vault-entry-label">{entry.label}</span>
                  {entry.username && <span className="vault-entry-username">{entry.username}</span>}
                </button>
              ))}
            </div>

            <div className="submission-actions">
              <button type="button" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}

        {formOpen && (
          <VaultEntryForm
            vaultKey={vaultKey}
            createdBy={me.id}
            entry={editingEntry}
            onClose={() => {
              setFormOpen(false)
              setEditingEntry(null)
            }}
            onSaved={handleEntryChanged}
          />
        )}

        {selectedEntry && !formOpen && (
          <VaultEntryDetail
            entry={selectedEntry}
            onClose={() => setSelectedEntry(null)}
            onEdit={() => {
              setEditingEntry(selectedEntry)
              setSelectedEntry(null)
              setFormOpen(true)
            }}
            onDeleted={handleEntryChanged}
          />
        )}

        {exportOpen && <VaultExportForm entries={entries} onClose={() => setExportOpen(false)} />}
      </div>
    </Modal>
  )
}

import { useEffect, useState } from 'react'
import { Pencil, X } from 'lucide-react'
import {
  fetchVaultMeta,
  setupVault,
  unlockVault,
  resetVault,
  fetchVaultEntries,
  decryptJSON,
  encryptJSON,
  updateVaultEntry,
  VAULT_FOLDERS,
} from '../lib/vault'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'
import VaultEntryForm from './VaultEntryForm'
import VaultEntryDetail from './VaultEntryDetail'
import VaultExportForm from './VaultExportForm'

const RESET_CONFIRM_WORD = 'RESET'

const vaultEntryRowClasses =
  'flex cursor-pointer items-center justify-between rounded-md border border-border bg-card-bg px-3 py-2.5 text-left text-text-h shadow-resting [font:inherit] transition-all duration-[180ms] ease-tactile hover:-translate-y-px hover:shadow-raised active:translate-y-0 active:shadow-press'
const vaultFolderActionClasses =
  'flex-none cursor-pointer border-0 bg-transparent px-1.5 py-1 text-sm text-text opacity-60 transition-opacity duration-[180ms] ease-tactile hover:opacity-100 disabled:cursor-default disabled:opacity-35'
const vaultFolderRenameActionClasses = `${vaultFolderActionClasses} rounded-sm border border-border px-2.5 py-1.5 opacity-100`

// Folders aren't their own stored entity — there's no folder table/row,
// just a `folder` string on each entry (see lib/vault.js). So the full
// set of folders in play is always *derived* from what's actually on
// entries right now, seeded with VAULT_FOLDERS' defaults so the create
// form's suggestions aren't empty on a brand-new vault. This also means
// "creating" a folder is just typing a new name onto an entry — there's
// no separate empty-folder-with-no-entries state to persist.
function distinctFolders(entries) {
  const set = new Set(VAULT_FOLDERS)
  for (const e of entries) if (e.folder) set.add(e.folder)
  return [...set].sort((a, b) => a.localeCompare(b))
}

// Alphabetical, "General" (no folder set) always last — folders are the
// deliberate organization someone opted into, so they sit above the
// catch-all bucket. Only entries that exist land in the result; an
// unused folder doesn't get an empty placeholder group.
function groupByFolder(entries, folderNames) {
  const groups = folderNames.map((name) => ({ name, items: entries.filter((e) => e.folder === name) }))
  groups.push({ name: 'General', items: entries.filter((e) => !e.folder) })
  return groups.filter((g) => g.items.length > 0)
}

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
  // Every folder starts collapsed, and loadEntries below never resets this
  // — the vault is a modal (.submission-modal), which sizes itself to
  // content (same reasoning as the How-to guide's own fixed-size override,
  // see App.css), so a folder springing open on every entry save/rename/
  // move made the whole card visibly grow and shrink underneath whatever
  // you were doing. Collapsed by default, and left exactly as the user
  // leaves it across reloads, rather than fighting their own toggles.
  const [expandedFolders, setExpandedFolders] = useState(() => new Set())

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

  // Which folder's header is mid-rename (the folder's *current* name, used
  // as the key/identity while renameDraft holds the in-progress new name)
  // — null when no header is being edited. Same inline-swap-to-input
  // pattern CorkBoardView.jsx uses for editing a pin in place.
  const [renamingFolder, setRenamingFolder] = useState(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [folderBusy, setFolderBusy] = useState(false)

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

  function toggleFolder(name) {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
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

  // Re-encrypts one entry with a new folder value, keeping every other
  // field as-is — the one primitive handleMoveFolder, handleRenameFolder,
  // and handleDeleteFolder below all build on.
  async function saveEntryFolder(entry, folder) {
    const value = {
      label: entry.label,
      username: entry.username,
      loginMethod: entry.loginMethod,
      password: entry.password,
      url: entry.url,
      notes: entry.notes,
      folder,
    }
    const { ciphertext, iv } = await encryptJSON(vaultKey, value)
    await updateVaultEntry(entry.id, { ciphertext, iv })
    return value
  }

  // A quick reassignment from the entry's own detail view (see
  // VaultEntryDetail.jsx's Folder select) rather than requiring the full
  // Edit form just to move an existing entry into a folder — useful for
  // sorting a batch of entries that predate this feature one at a time
  // without re-entering every other field each time.
  async function handleMoveFolder(entry, folder) {
    try {
      const value = await saveEntryFolder(entry, folder)
      setSelectedEntry({ ...value, id: entry.id })
      loadEntries(vaultKey)
    } catch (err) {
      setError(err.message)
    }
  }

  // Folders aren't a stored entity (see distinctFolders above) — renaming
  // one means bulk-rewriting every entry currently tagged with the old
  // name. Renaming to a name that already matches another existing folder
  // just merges the two, which falls out naturally: grouping is always
  // derived fresh from whatever's on entries afterward, nothing extra to
  // reconcile.
  async function handleRenameFolder(oldName, newName) {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === oldName) {
      setRenamingFolder(null)
      return
    }
    setFolderBusy(true)
    try {
      const affected = entries.filter((e) => e.folder === oldName)
      await Promise.all(affected.map((entry) => saveEntryFolder(entry, trimmed)))
      setRenamingFolder(null)
      await loadEntries(vaultKey)
    } catch (err) {
      setError(err.message)
    } finally {
      setFolderBusy(false)
    }
  }

  // "Deleting" a folder doesn't touch the entries themselves, only their
  // folder tag — they fall back into General, same as any entry that
  // never had a folder set.
  async function handleDeleteFolder(name) {
    const affected = entries.filter((e) => e.folder === name)
    if (!window.confirm(`Remove the "${name}" folder? Its ${affected.length} ${affected.length === 1 ? 'entry moves' : 'entries move'} back to General — nothing gets deleted.`)) {
      return
    }
    setFolderBusy(true)
    try {
      await Promise.all(affected.map((entry) => saveEntryFolder(entry, '')))
      await loadEntries(vaultKey)
    } catch (err) {
      setError(err.message)
    } finally {
      setFolderBusy(false)
    }
  }

  const folderNames = distinctFolders(entries)
  const folderGroups = groupByFolder(entries, folderNames)

  return (
    <Modal onClose={onClose}>
      <ModalCard modifier="vault-modal">
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
            <SubmissionActions>
              <SubmissionButton onClick={onClose}>Cancel</SubmissionButton>
              <SubmissionButton type="submit" variant="primary" disabled={unlocking}>
                {unlocking ? 'Setting up…' : 'Set up vault'}
              </SubmissionButton>
            </SubmissionActions>
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
            <SubmissionActions>
              <SubmissionButton onClick={onClose}>Cancel</SubmissionButton>
              <SubmissionButton type="submit" variant="primary" disabled={unlocking}>
                {unlocking ? 'Unlocking…' : 'Unlock'}
              </SubmissionButton>
            </SubmissionActions>
            <button
              type="button"
              className="mt-2 self-center cursor-pointer border-0 bg-transparent text-[13px] text-accent underline"
              onClick={() => setShowReset(true)}
            >
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
            <SubmissionActions>
              <SubmissionButton onClick={() => setShowReset(false)}>Cancel</SubmissionButton>
              <SubmissionButton
                variant="destructive"
                disabled={resetConfirmText !== RESET_CONFIRM_WORD || resetting}
                onClick={handleReset}
              >
                {resetting ? 'Resetting…' : 'Reset vault'}
              </SubmissionButton>
            </SubmissionActions>
          </div>
        )}

        {vaultKey && (
          <>
            <div className="flex gap-2">
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

            {/* Nobody's used folders yet (or everything happens to land in
                General) — the plain flat list from before, no group header
                for its own sake when there's nothing to separate it from. */}
            {folderGroups.length <= 1 && (
              <div className="flex flex-col gap-1.5">
                {entries.map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    className={vaultEntryRowClasses}
                    onClick={() => setSelectedEntry(entry)}
                  >
                    <span className="font-semibold">{entry.label}</span>
                    {entry.username && <span className="text-[13px] opacity-70">{entry.username}</span>}
                  </button>
                ))}
              </div>
            )}

            {folderGroups.length > 1 && (
              <div className="flex flex-col gap-2">
                {folderGroups.map((group) => (
                  <div key={group.name}>
                    {renamingFolder === group.name ? (
                      // Swapped in place of the header row while renaming
                      // — same "editing" idea CorkBoardView.jsx uses for a
                      // pin, just for a folder name instead of a note body.
                      <div className="flex items-center gap-1.5">
                        <input
                          className="min-w-0 flex-1 rounded-sm border border-border bg-card-bg px-2.5 py-[7px] text-text-h [font:inherit]"
                          autoFocus
                          value={renameDraft}
                          disabled={folderBusy}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameFolder(group.name, renameDraft)
                            if (e.key === 'Escape') setRenamingFolder(null)
                          }}
                        />
                        <button
                          type="button"
                          className={vaultFolderRenameActionClasses}
                          disabled={folderBusy}
                          onClick={() => handleRenameFolder(group.name, renameDraft)}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className={vaultFolderRenameActionClasses}
                          onClick={() => setRenamingFolder(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 cursor-pointer items-center justify-between rounded-sm border border-border bg-pill-bg px-2.5 py-2 font-semibold text-text-h [font-family:inherit] [font-size:inherit] [font-style:inherit] [font-variant:inherit] [line-height:inherit] transition-transform duration-[120ms] ease-tactile active:scale-[0.98]"
                          onClick={() => toggleFolder(group.name)}
                        >
                          <span>{group.name}</span>
                          <span className="text-[13px] font-normal opacity-60">
                            {group.items.length} {expandedFolders.has(group.name) ? '▾' : '▸'}
                          </span>
                        </button>
                        {/* General is the catch-all, not something anyone
                            created — nothing to rename or remove there. */}
                        {group.name !== 'General' && (
                          <>
                            <button
                              type="button"
                              className={vaultFolderActionClasses}
                              title="Rename folder"
                              aria-label={`Rename ${group.name}`}
                              disabled={folderBusy}
                              onClick={() => {
                                setRenamingFolder(group.name)
                                setRenameDraft(group.name)
                              }}
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              type="button"
                              className={vaultFolderActionClasses}
                              title="Remove folder"
                              aria-label={`Remove ${group.name}`}
                              disabled={folderBusy}
                              onClick={() => handleDeleteFolder(group.name)}
                            >
                              <X size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {expandedFolders.has(group.name) && (
                      <div className="flex flex-col gap-1.5 pt-2">
                        {group.items.map((entry) => (
                          <button
                            type="button"
                            key={entry.id}
                            className={vaultEntryRowClasses}
                            onClick={() => setSelectedEntry(entry)}
                          >
                            <span className="font-semibold">{entry.label}</span>
                            {entry.username && <span className="text-[13px] opacity-70">{entry.username}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <SubmissionActions>
              <SubmissionButton onClick={onClose}>Close</SubmissionButton>
            </SubmissionActions>
          </>
        )}

        {formOpen && (
          <VaultEntryForm
            vaultKey={vaultKey}
            createdBy={me.id}
            entry={editingEntry}
            existingFolders={folderNames}
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
            existingFolders={folderNames}
            onClose={() => setSelectedEntry(null)}
            onEdit={() => {
              setEditingEntry(selectedEntry)
              setSelectedEntry(null)
              setFormOpen(true)
            }}
            onDeleted={handleEntryChanged}
            onMoveFolder={(folder) => handleMoveFolder(selectedEntry, folder)}
          />
        )}

        {exportOpen && <VaultExportForm entries={entries} onClose={() => setExportOpen(false)} />}
      </ModalCard>
    </Modal>
  )
}

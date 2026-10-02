import { useState } from 'react'
import { deleteVaultEntry, updateVaultEntrySharing } from '../lib/vault'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'
import AssigneePicker from './AssigneePicker'
import { useConfirm } from '../lib/confirmContext'

// View-then-act, same as RentalBookingDetail.jsx — tapping an entry in
// the list shows details first, deletion is an explicit button here, not
// something a stray tap on the list can trigger.
export default function VaultEntryDetail({
  entry,
  existingFolders = [],
  isPrivateVault = false,
  otherVaultMembers = [],
  meId,
  memberName,
  onClose,
  onEdit,
  onDeleted,
  onShareChanged,
  onMoveFolder,
}) {
  const confirm = useConfirm()
  // Matches schema.sql's own update/delete RLS exactly: a household-vault
  // entry stays editable/deletable by any vault member; a healthcare-
  // vault entry only by whoever created it — sharing grants visibility,
  // not co-ownership (same "the other member can see it, not manage it"
  // rule cork_notes already established). Hiding the buttons here is UX
  // only — the real enforcement is server-side either way.
  const canManage = !isPrivateVault || entry.createdBy === meId
  const [revealed, setRevealed] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  // Which field's Copy button most recently succeeded, so it can flash
  // "Copied" briefly — a successful copy otherwise gave no feedback at
  // all, making it easy to double-tap unsure whether the first click
  // registered.
  const [copiedField, setCopiedField] = useState('')
  const [moving, setMoving] = useState(false)
  // Quick "who can see this" edit right here, same reasoning the Folder
  // <select> above already established — adjusting sharing shouldn't
  // require opening the full Edit form (which also means reviewing/
  // re-saving the label, username, password, everything else) just to
  // add or remove one person.
  const [editingShare, setEditingShare] = useState(false)
  const [shareDraft, setShareDraft] = useState(() => entry.sharedWith || [])
  const [sharing, setSharing] = useState(false)

  function startEditShare() {
    setShareDraft(entry.sharedWith || [])
    setEditingShare(true)
  }

  async function handleSaveShare() {
    setSharing(true)
    setError('')
    try {
      await updateVaultEntrySharing(entry.id, shareDraft)
      onShareChanged(shareDraft)
      setEditingShare(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSharing(false)
    }
  }

  async function handleFolderChange(e) {
    setMoving(true)
    setError('')
    try {
      await onMoveFolder(e.target.value)
    } catch (err) {
      setError(err.message)
    } finally {
      setMoving(false)
    }
  }

  async function handleCopy(field, text) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField((f) => (f === field ? '' : f)), 1500)
    } catch {
      setError('Could not copy — your browser may be blocking clipboard access.')
    }
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${entry.label}"?`,
      message: "This can't be undone.",
      confirmLabel: 'Delete entry',
    })
    if (!ok) return
    setDeleting(true)
    setError('')
    try {
      await deleteVaultEntry(entry.id)
      onDeleted()
    } catch (err) {
      setError(err.message)
      setDeleting(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <ModalCard>
        <h2>{entry.label}</h2>

        {error && <p className="error">{error}</p>}

        {isPrivateVault && editingShare ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] opacity-80">Shared with</span>
            <AssigneePicker members={otherVaultMembers} value={shareDraft} onChange={setShareDraft} />
            <div className="flex gap-2">
              <button
                type="button"
                className="vault-copy"
                onClick={() => setEditingShare(false)}
                disabled={sharing}
              >
                Cancel
              </button>
              <button type="button" className="vault-copy" onClick={handleSaveShare} disabled={sharing}>
                {sharing ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          isPrivateVault && (
            <div className="flex items-center gap-2 text-sm">
              <span className="w-[70px] flex-none text-[13px] opacity-80">Shared</span>
              <span className="flex-1 text-text-h">
                {entry.sharedWith?.length ? entry.sharedWith.map((id) => memberName(id)).join(', ') : 'Only you'}
              </span>
              {canManage && otherVaultMembers.length > 0 && (
                <button type="button" className="vault-copy" onClick={startEditShare}>
                  Edit
                </button>
              )}
            </div>
          )
        )}

        {onMoveFolder && canManage && (
          <div className="flex items-center gap-2 text-sm">
            <span className="w-[70px] flex-none text-[13px] opacity-80">Folder</span>
            <select value={entry.folder || ''} onChange={handleFolderChange} disabled={moving}>
              <option value="">General</option>
              {existingFolders.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        )}

        {entry.username && (
          <div className="flex items-center gap-2 text-sm">
            <span className="w-[70px] flex-none text-[13px] opacity-80">Username</span>
            <span className="flex-1 break-all text-text-h">{entry.username}</span>
            <button type="button" className="vault-copy" onClick={() => handleCopy('username', entry.username)}>
              {copiedField === 'username' ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}

        {entry.loginMethod ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="w-[70px] flex-none text-[13px] opacity-80">Sign in</span>
            <span className="flex-1 break-all text-text-h">via {entry.loginMethod}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span className="w-[70px] flex-none text-[13px] opacity-80">Password</span>
            <span className="flex-1 break-all font-mono text-text-h">{revealed ? entry.password : '••••••••••'}</span>
            <button type="button" className="vault-copy" onClick={() => setRevealed((v) => !v)}>
              {revealed ? 'Hide' : 'Reveal'}
            </button>
            <button type="button" className="vault-copy" onClick={() => handleCopy('password', entry.password)}>
              {copiedField === 'password' ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}

        {entry.url && (
          <div className="flex items-center gap-2 text-sm">
            <span className="w-[70px] flex-none text-[13px] opacity-80">URL</span>
            <a href={entry.url} target="_blank" rel="noreferrer" className="flex-1 break-all text-text-h">
              {entry.url}
            </a>
          </div>
        )}

        {entry.notes && <p className="task-submission-note-text">{entry.notes}</p>}

        <SubmissionActions>
          <SubmissionButton onClick={onClose}>Close</SubmissionButton>
          {canManage && (
            <SubmissionButton variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </SubmissionButton>
          )}
          {canManage && (
            <SubmissionButton variant="primary" onClick={onEdit}>
              Edit
            </SubmissionButton>
          )}
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

import { useState } from 'react'
import { deleteVaultEntry } from '../lib/vault'
import Modal from './Modal'

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    alert('Could not copy — your browser may be blocking clipboard access.')
  }
}

// View-then-act, same as RentalBookingDetail.jsx — tapping an entry in
// the list shows details first, deletion is an explicit button here, not
// something a stray tap on the list can trigger.
export default function VaultEntryDetail({ entry, onClose, onEdit, onDeleted }) {
  const [revealed, setRevealed] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!window.confirm(`Delete "${entry.label}"? This can't be undone.`)) return
    setDeleting(true)
    try {
      await deleteVaultEntry(entry.id)
      onDeleted()
    } catch (err) {
      alert(err.message)
      setDeleting(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="submission-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{entry.label}</h2>

        {entry.username && (
          <div className="vault-field-row">
            <span className="vault-field-label">Username</span>
            <span className="vault-field-value">{entry.username}</span>
            <button type="button" className="vault-copy" onClick={() => copyToClipboard(entry.username)}>
              Copy
            </button>
          </div>
        )}

        {entry.loginMethod ? (
          <div className="vault-field-row">
            <span className="vault-field-label">Sign in</span>
            <span className="vault-field-value">via {entry.loginMethod}</span>
          </div>
        ) : (
          <div className="vault-field-row">
            <span className="vault-field-label">Password</span>
            <span className="vault-field-value vault-password-value">{revealed ? entry.password : '••••••••••'}</span>
            <button type="button" className="vault-copy" onClick={() => setRevealed((v) => !v)}>
              {revealed ? 'Hide' : 'Reveal'}
            </button>
            <button type="button" className="vault-copy" onClick={() => copyToClipboard(entry.password)}>
              Copy
            </button>
          </div>
        )}

        {entry.url && (
          <div className="vault-field-row">
            <span className="vault-field-label">URL</span>
            <a href={entry.url} target="_blank" rel="noreferrer" className="vault-field-value">
              {entry.url}
            </a>
          </div>
        )}

        {entry.notes && <p className="task-submission-note-text">{entry.notes}</p>}

        <div className="submission-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="rental-delete-booking" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
          <button type="button" className="submission-save" onClick={onEdit}>
            Edit
          </button>
        </div>
      </div>
    </Modal>
  )
}

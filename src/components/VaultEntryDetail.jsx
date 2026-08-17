import { useState } from 'react'
import { deleteVaultEntry } from '../lib/vault'
import Modal from './Modal'

// View-then-act, same as RentalBookingDetail.jsx — tapping an entry in
// the list shows details first, deletion is an explicit button here, not
// something a stray tap on the list can trigger.
export default function VaultEntryDetail({ entry, onClose, onEdit, onDeleted }) {
  const [revealed, setRevealed] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  // Which field's Copy button most recently succeeded, so it can flash
  // "Copied" briefly — a successful copy otherwise gave no feedback at
  // all, making it easy to double-tap unsure whether the first click
  // registered.
  const [copiedField, setCopiedField] = useState('')

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
    if (!window.confirm(`Delete "${entry.label}"? This can't be undone.`)) return
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
      <div className="submission-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{entry.label}</h2>

        {error && <p className="error">{error}</p>}

        {entry.username && (
          <div className="vault-field-row">
            <span className="vault-field-label">Username</span>
            <span className="vault-field-value">{entry.username}</span>
            <button type="button" className="vault-copy" onClick={() => handleCopy('username', entry.username)}>
              {copiedField === 'username' ? 'Copied' : 'Copy'}
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
            <button type="button" className="vault-copy" onClick={() => handleCopy('password', entry.password)}>
              {copiedField === 'password' ? 'Copied' : 'Copy'}
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

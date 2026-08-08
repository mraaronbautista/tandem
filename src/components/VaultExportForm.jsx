import { useState } from 'react'
import Modal from './Modal'

const CONFIRM_WORD = 'EXPORT'

function csvEscape(value) {
  const s = String(value ?? '')
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function buildCsv(entries) {
  const header = ['Label', 'Username', 'Login Method', 'Password', 'URL', 'Notes']
  const rows = entries.map((e) =>
    [e.label, e.username, e.loginMethod, e.password, e.url, e.notes].map(csvEscape).join(','),
  )
  return [header.join(','), ...rows].join('\n')
}

// First typed-confirmation pattern in this codebase — justified because
// this is the one action that meaningfully undoes the vault's security
// guarantee (see vault.js), unlike an ordinary window.confirm delete.
export default function VaultExportForm({ entries, onClose }) {
  const [confirmText, setConfirmText] = useState('')

  function handleExport() {
    const csv = buildCsv(entries)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tandem-vault-export-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    onClose()
  }

  return (
    <Modal onClose={onClose}>
      <div className="submission-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Export vault</h2>

        <p className="vault-warning">
          This downloads a file with every password in this vault written in <strong>plain, unencrypted text</strong>{' '}
          — anyone who opens it can read everything. Store it somewhere very safe (not synced to cloud storage or
          email) and delete it once you no longer need it.
        </p>

        <label className="submission-field">
          Type <strong>{CONFIRM_WORD}</strong> to confirm
          <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={CONFIRM_WORD} />
        </label>

        <div className="submission-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="rental-delete-booking"
            disabled={confirmText !== CONFIRM_WORD}
            onClick={handleExport}
          >
            Download unencrypted CSV
          </button>
        </div>
      </div>
    </Modal>
  )
}

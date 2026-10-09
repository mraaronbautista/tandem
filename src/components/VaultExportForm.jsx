import { useState } from 'react'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'
import { totpToUri } from '../lib/totp'
import { formulaSafeText } from '../lib/csvSafe'

const CONFIRM_WORD = 'EXPORT'

// Formula protection lives in lib/csvSafe.js. Credentials (username, login
// method, password, authenticator link) are written exactly as stored: this
// file exists so they can be moved to another password manager, and an
// apostrophe added to a password that starts with = + - or @ would silently
// break it there. Labels, URLs and notes still get the protection.
function csvEscape(value, { exact = false } = {}) {
  const s = formulaSafeText(value, { exact })
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function buildCsv(entries) {
  const header = ['Label', 'Username', 'Login Method', 'Password', 'URL', 'Notes', 'Authenticator Link']
  const rows = entries.map((e) =>
    // A standard otpauth:// link: any authenticator app can import it, so
    // exporting never strands a one-time-code key inside Tandem.
    [
      csvEscape(e.label),
      csvEscape(e.username, { exact: true }),
      csvEscape(e.loginMethod, { exact: true }),
      csvEscape(e.password, { exact: true }),
      csvEscape(e.url),
      csvEscape(e.notes),
      csvEscape(e.totp ? totpToUri(e.totp, { label: e.label, issuer: e.label }) : '', { exact: true }),
    ].join(','),
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
      <ModalCard>
        <h2>Export vault</h2>

        <p className="vault-warning">
          This downloads a file with every password, and every authenticator key, in this vault written in <strong>plain, unencrypted text</strong>{' '}
          — anyone who opens it can read everything. Store it somewhere very safe (not synced to cloud storage or
          email) and delete it once you no longer need it.
        </p>

        <label className="submission-field">
          Type <strong>{CONFIRM_WORD}</strong> to confirm
          <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={CONFIRM_WORD} />
        </label>

        <SubmissionActions>
          <SubmissionButton onClick={onClose}>Cancel</SubmissionButton>
          <SubmissionButton variant="destructive" disabled={confirmText !== CONFIRM_WORD} onClick={handleExport}>
            Download unencrypted CSV
          </SubmissionButton>
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

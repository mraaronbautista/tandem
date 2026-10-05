import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'
import { EXPORT_GROUPS, allowedGroups, collectExport, collectVault, workbookBlob, csvText, downloadBlob } from '../lib/dataExport'
import { fetchAccessibleVaults } from '../lib/vault'
import { friendlyError } from '../lib/friendlyError'

export default function DataExport({ me, onClose }) {
  const groups = allowedGroups(me)
  const [tab, setTab] = useState('All records')
  const [archived, setArchived] = useState(false)
  const [includeVault, setIncludeVault] = useState(false)
  const [vaults, setVaults] = useState([])
  const [vaultLoading, setVaultLoading] = useState(false)
  const [passwords, setPasswords] = useState({})
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const pending = useRef(false)
  const vaultAllowed = me?.permissions?.vault !== false
  const needsVault = tab === 'Vault' || (tab === 'All records' && includeVault)
  useEffect(() => {
    let cancelled = false
    setPasswords({}); setConfirm(''); setVaults([])
    setVaultLoading(needsVault)
    if (needsVault) fetchAccessibleVaults().then(rows => { if (!cancelled) setVaults(rows) }).catch(err => { if (!cancelled) setError(friendlyError(err)) }).finally(() => { if (!cancelled) setVaultLoading(false) })
    return () => { cancelled = true }
  }, [needsVault])
  function close() { if (!pending.current) { setPasswords({}); onClose() } }
  async function exportFile(format, recordName) {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(''); setStatus('Preparing your export…')
    try {
      if (needsVault && (!vaultAllowed || confirm !== 'EXPORT' || !vaults.length)) throw new Error('Unlock and confirm the Vault export first.')
      let sheets = tab === 'Vault' ? [] : await collectExport(tab === 'All records' ? groups : [tab], me, archived)
      if (recordName) sheets = sheets.filter(s => s.name === recordName)
      if (needsVault) sheets.push(await collectVault(passwords))
      const date = new Date().toISOString().slice(0, 10)
      const blob = format === 'xlsx' ? await workbookBlob(sheets) : new Blob([csvText(sheets[0])], { type: 'text/csv;charset=utf-8' })
      downloadBlob(blob, `tandem-${(recordName || tab).toLowerCase().replaceAll(' ', '-')}-${date}.${format}`)
      setStatus(`Download prepared: ${sheets.length} sheet${sheets.length === 1 ? '' : 's'}, ${sheets.reduce((n,s) => n+s.rows.length,0)} records.`)
    } catch (err) { setError(friendlyError(err)); setStatus('No file was downloaded.') }
    finally { setPasswords({}); setConfirm(''); pending.current = false; setBusy(false) }
  }
  const vaultReady = !needsVault || (confirm === 'EXPORT' && vaults.length > 0 && vaults.every(v => passwords[v.id]))
  return <Modal onClose={close}><ModalCard className="!max-w-[900px]">
    <h2>Export records</h2>
    <p>Download only records you can access. Tasks, task comments and task submissions are excluded.</p>
    <div role="tablist" aria-label="Export sections" className="flex flex-wrap gap-2 my-4">
      {['All records', ...groups, ...(vaultAllowed ? ['Vault'] : [])].map(name => <button key={name} role="tab" aria-selected={tab === name} disabled={busy} className={`min-h-11 rounded border border-border px-3 py-2 ${tab === name ? 'bg-accent text-on-accent' : 'bg-pill-bg text-text'}`} onClick={() => { setTab(name); setError(''); setStatus('') }}>{name}</button>)}
    </div>
    <div role="tabpanel" aria-label={tab}>
      <h3>{tab === 'All records' ? 'One Excel file, separate sheets' : tab}</h3>
      <p>{tab === 'All records' ? 'Both rental companies and every available section are included. Vault is optional.' : tab === 'Vault' ? 'Unlock your accessible Vaults to download their entries in one Excel file.' : 'Download this section as an Excel workbook, or each record type as a CSV.'}</p>
      {tab !== 'Vault' && <label className="!flex !flex-row !items-center !justify-start gap-2 my-3"><input type="checkbox" checked={archived} disabled={busy} onChange={e => setArchived(e.target.checked)} /> Include archived records</label>}
      {tab === 'All records' && vaultAllowed && <label className="!flex !flex-row !items-center !justify-start gap-2 my-3"><input type="checkbox" checked={includeVault} disabled={busy} onChange={e => setIncludeVault(e.target.checked)} /> Include Vault entries</label>}
      {needsVault && <div className="border border-border rounded p-3 my-3">
        <p>The downloaded file contains readable passwords and authenticator secrets. Only accessible Vault entries are included.</p>
        {vaultLoading ? <p role="status">Loading accessible Vaults…</p> : !vaults.length && <p>No accessible Vault loaded. Try selecting another tab and returning to Vault.</p>}
        {vaults.map(v => <label key={v.id} className="submission-field">{v.name} master password<input type="password" autoComplete="off" value={passwords[v.id] || ''} disabled={busy} onChange={e => setPasswords(p => ({ ...p, [v.id]: e.target.value }))} /></label>)}
        <label className="submission-field">Type EXPORT to confirm<input value={confirm} disabled={busy} autoComplete="off" onChange={e => setConfirm(e.target.value)} /></label>
      </div>}
      {tab !== 'Vault' && <ul className="my-3 pl-5 list-disc">{(tab === 'All records' ? groups.flatMap(g => EXPORT_GROUPS[g]) : EXPORT_GROUPS[tab] || []).map(([name]) => <li key={name} className="mb-2">{name}{tab !== 'All records' && <button disabled={busy} className="ml-3 underline" onClick={() => exportFile('csv', name)}>Download CSV</button>}</li>)}</ul>}
      {error && <p className="error" role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      <SubmissionActions><SubmissionButton disabled={busy} onClick={close}>Close</SubmissionButton><SubmissionButton variant="primary" disabled={busy || !vaultReady} onClick={() => exportFile('xlsx')}>{busy ? 'Preparing…' : tab === 'All records' ? 'Download all records (.xlsx)' : 'Download Excel (.xlsx)'}</SubmissionButton></SubmissionActions>
    </div>
  </ModalCard></Modal>
}

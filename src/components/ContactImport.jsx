import { useRef, useState } from 'react'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'
import { CONTACT_KINDS, fetchRentalContacts, saveRentalContact } from '../lib/rentalContacts'
import { parseGoogleContacts, matchingContacts, contactImportError, contactImportPayload } from '../lib/googleContactImport'
import { friendlyError } from '../lib/friendlyError'

const INPUT = 'w-full min-h-11 rounded-md border border-border bg-bg px-3 py-2 text-sm text-text-h'
export default function ContactImport({ contacts, properties, locations, onClose, onImported }) {
  const [rows, setRows] = useState([])
  const [filename, setFilename] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const pending = useRef(false)
  function patch(key, changes) { setRows((old) => old.map((row) => row.key === key ? { ...row, ...changes } : row)) }
  async function readFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setError(''); setNotice('')
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Choose a CSV smaller than 2 MB.')
      const parsed = parseGoogleContacts(await file.text())
      const seen = [...contacts]
      setRows(parsed.map((row) => {
        const matches = matchingContacts(row, seen)
        seen.push(row)
        return { ...row, selected: row.selected && !matches.length, warning: matches.length ? `Possible duplicate: ${matches.map((item) => item.name).join(', ')}` : '' }
      }))
      setFilename(file.name)
    } catch (err) { setError(err.message); setRows([]); setFilename('') }
    finally { event.target.value = '' }
  }
  async function importSelected() {
    if (pending.current) return
    const selected = rows.filter((row) => row.selected && !row.status)
    if (!selected.length) return
    pending.current = true; setSaving(true); setError(''); setNotice('')
    let imported = 0, skipped = 0
    try {
      // Refresh before writing so a second import/session cannot blindly use a stale list.
      const known = await fetchRentalContacts()
      for (const row of selected) {
        const invalid = contactImportError(row)
        if (invalid) { patch(row.key, { error: invalid }); continue }
        const matches = matchingContacts(row, known)
        if (matches.length) { patch(row.key, { selected: false, status: 'Skipped — matching contact exists', warning: matches.map((item) => item.name).join(', '), error: '' }); skipped++; continue }
        try {
          const { details, links, locationLinks } = contactImportPayload(row)
          const id = await saveRentalContact(null, details, links, locationLinks)
          known.push({ ...details, id })
          patch(row.key, { selected: false, status: 'Imported', error: '' }); imported++
        } catch (err) {
          // A response can fail after the server commits. Stop, then re-read on retry.
          patch(row.key, { error: `${friendlyError(err)} Retry checks for an existing contact first.` })
          setError('Import stopped at one contact. Saved contacts stay marked; review this row before retrying.')
          break
        }
      }
      setNotice(`${imported} imported · ${skipped} skipped this attempt.`)
    } catch (err) { setError(friendlyError(err)) }
    finally { onImported(); pending.current = false; setSaving(false) }
  }
  const count = rows.filter((row) => row.selected && !row.status).length
  return <Modal onClose={() => { if (!pending.current) onClose() }}><ModalCard>
    <h2>Import contacts</h2>
    <p>Choose a Google Contacts CSV, then review who to add. Nothing is saved until you choose Import.</p>
    <fieldset disabled={saving} className="m-0 min-w-0 border-0 p-0">
      <label className="block">Google CSV file<input className={INPUT} type="file" accept=".csv,text/csv" onChange={readFile} /></label>
      {filename && <p className="break-words text-sm">{filename} · {rows.length} contacts</p>}
      {rows.length > 0 && <>
        <p className="text-sm">Matching names, phone numbers or emails start unchecked and are skipped on import. Existing contacts stay unchanged, including archived contacts. Extra phones/emails are kept in Notes. Photos, birthdays and Google labels aren’t imported. Keep passwords and door codes in the Vault.</p>
        <button type="button" className={INPUT} onClick={() => setRows((old) => old.map((row) => ({ ...row, selected: !row.status && !row.warning && Boolean(row.name.trim()) })))}>Select contacts without duplicate warnings</button>
        {rows.map((row) => <section key={row.key} className="my-3 min-w-0 rounded-lg border border-border p-3">
          <label className="min-h-11" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={row.selected} disabled={Boolean(row.status)} onChange={(event) => patch(row.key, { selected: event.target.checked })} /><strong className="break-words">{row.name || 'Unnamed contact'}</strong></label>
          {row.warning && <p className="break-words text-sm">{row.warning}</p>}
          {row.status ? <p role="status" className="text-sm">{row.status}</p> : <>
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              <label>Name<input className={INPUT} value={row.name} maxLength={200} onChange={(event) => patch(row.key, { name: event.target.value })} /></label>
              <label>Type<select className={INPUT} value={row.kind} onChange={(event) => patch(row.key, { kind: event.target.value, link: row.link.startsWith('site:') && event.target.value === 'tenant' ? '' : row.link })}>{Object.entries(CONTACT_KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Phone<input className={INPUT} type="tel" value={row.phone} onChange={(event) => patch(row.key, { phone: event.target.value })} /></label>
              <label>Link to<select className={INPUT} value={row.link} onChange={(event) => patch(row.key, { link: event.target.value })}><option value="">Assign later</option>{row.kind !== 'tenant' && locations.map((site) => <option key={site.id} value={`site:${site.id}`}>{site.name} — all units</option>)}{properties.filter((unit) => unit.active).map((unit) => <option key={unit.id} value={`unit:${unit.id}`}>{unit.unit_name} · {unit.company}</option>)}</select></label>
            </div>
            <details className="mt-3"><summary className="min-h-11 cursor-pointer">More details</summary><div className="flex flex-col gap-3">{[['phone_alt','Other phone'],['email','Email'],['organization','Company / organization'],['trade','Role / trade']].map(([key,label]) => <label key={key}>{label}<input className={INPUT} value={row[key]} onChange={(event) => patch(row.key,{[key]:event.target.value})} /></label>)}<label>Notes<textarea className={INPUT} rows={3} value={row.notes} onChange={(event) => patch(row.key, { notes: event.target.value })} /></label></div></details>
            {row.error && <p role="alert" className="error">{row.error}</p>}
          </>}
        </section>)}
      </>}
    </fieldset>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <SubmissionActions><SubmissionButton disabled={saving} onClick={onClose}>{rows.some((row) => row.status === 'Imported') ? 'Done' : 'Cancel'}</SubmissionButton><SubmissionButton variant="primary" disabled={saving || !count} onClick={importSelected}>{saving ? 'Importing…' : `Import selected contacts (${count})`}</SubmissionButton></SubmissionActions>
  </ModalCard></Modal>
}

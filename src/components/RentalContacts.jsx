import { useState } from 'react'
import { CONTACT_KINDS, filterRentalContacts, saveRentalContact, setRentalContactActive } from '../lib/rentalContacts'
import { friendlyError } from '../lib/friendlyError'
import { useConfirm } from '../lib/confirmContext'
import Modal from './Modal'
import ModalCard from './ModalCard'
import RentalButton from './RentalButton'
import LoadingText from './LoadingText'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

const INPUT = 'w-full min-h-[44px] rounded-[8px] border border-border bg-bg px-3 py-2 text-[15px] text-text-h'
const BUTTON = 'min-h-[44px]'

export default function RentalContacts({ store, property = null, directoryOnly = false }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('all')
  const [archived, setArchived] = useState(false)
  const [allUnits, setAllUnits] = useState(false)
  const [notice, setNotice] = useState('')
  const confirm = useConfirm()
  const { contacts, properties, error, reload } = store
  const list = filterRentalContacts(contacts || [], { propertyId: property?.id })
  const visible = filterRentalContacts(contacts || [], { search, kind, includeArchived: archived, propertyId: allUnits ? null : property?.id })
  function close() { setOpen(false); setEditing(null); setNotice('') }
  async function copyPhone(phone) {
    try { await navigator.clipboard.writeText(phone); setNotice('Number copied.') }
    catch { setNotice(`Could not copy. Select and copy this number: ${phone}`) }
  }
  async function archive(contact) {
    if (contact.active && !await confirm({ title: `Archive ${contact.name}?`, message: 'Their details and unit links are kept. Find them with Include archived.', confirmLabel: 'Archive contact', tone: 'neutral' })) return
    try { await setRentalContactActive(contact.id, !contact.active); reload(); setNotice(contact.active ? 'Contact archived.' : 'Contact restored.') }
    catch (err) { setNotice(friendlyError(err)) }
  }
  function card(contact, full = false) {
    return <div key={contact.id} className="min-w-0 border-b border-border py-3">
      <strong className="block break-words text-text-h">{contact.name}{!contact.active && ' (Archived)'}</strong>
      <p className="my-1 break-words text-sm text-text">{[CONTACT_KINDS[contact.kind], contact.trade, contact.organization].filter(Boolean).join(' · ')}</p>
      {contact.phone && <p className="my-1 break-words text-sm text-text-h">{contact.phone}</p>}
      {full && <>
        {contact.phone_alt && <p className="my-1 break-words text-sm">Other phone: {contact.phone_alt}</p>}
        {contact.email && <p className="my-1 break-words text-sm">{contact.email}</p>}
        <p className="my-1 break-words text-sm">{contact.rental_contact_links.map((link) => {
          const unit = properties.find((item) => item.id === link.property_id)
          return `${unit?.unit_name || 'Unit unavailable'}${unit && !unit.active ? ' (Archived unit)' : ''}${link.role ? ` — ${link.role}` : ''}`
        }).join('; ') || 'No linked units'}</p>
        {contact.notes && <p className="my-2 whitespace-pre-wrap break-words text-sm">{contact.notes}</p>}
      </>}
      <div className="flex flex-wrap gap-2">
        <RentalButton className={BUTTON} onClick={() => { setEditing(contact); setOpen(true) }}>{full ? 'Edit contact' : 'View / edit contact'}</RentalButton>
        {contact.phone && <RentalButton className={BUTTON} onClick={() => copyPhone(contact.phone)}>Copy number</RentalButton>}
        {full && <RentalButton className={BUTTON} onClick={() => archive(contact)}>{contact.active ? 'Archive' : 'Restore'}</RentalButton>}
      </div>
    </div>
  }
  return <section className={directoryOnly ? '' : 'mt-3 min-w-0 rounded-[10px] border border-border bg-card-bg p-4'}>
    {directoryOnly ? <RentalButton className={BUTTON} onClick={() => { setAllUnits(true); setOpen(true) }}>All contacts</RentalButton> : <>
      <h3 className="m-0 text-base font-semibold text-text-h">Contacts{property ? ` · ${property.unit_name}` : ''}</h3>
      {error ? <p role="alert" className="text-sm text-text">{error} <RentalButton className={BUTTON} onClick={reload}>Try again</RentalButton></p> : !contacts ? <LoadingText /> : <>
        {list.length ? list.map((contact) => card(contact)) : <p className="text-sm text-text">No contacts linked yet. Add a tenant, vendor or other contact for this unit.</p>}
        <RentalButton className={BUTTON} onClick={() => { setAllUnits(false); setOpen(true) }}>+ Add or link contact</RentalButton>
      </>}
    </>}
    {notice && !open && <p role="status" className="break-words text-sm">{notice}</p>}
    {open && (editing ? <ContactForm contact={editing.id ? editing : null} properties={properties} initialProperty={property} contacts={contacts || []}
      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); setNotice('Contact saved.') }} /> : <Modal onClose={close}><ModalCard>
      <h2>{property && !allUnits ? `${property.unit_name} contacts` : 'All rental contacts'}</h2>
      {error ? <p role="alert">{error} <RentalButton className={BUTTON} onClick={reload}>Try again</RentalButton></p> : !contacts ? <LoadingText /> : <>
        <label>Search name, company or phone<input className={INPUT} value={search} onChange={(event) => setSearch(event.target.value)} type="search" /></label>
        <label>Type<select className={INPUT} value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">All</option>{Object.entries(CONTACT_KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />Include archived</label>
        {property && <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}><input type="checkbox" checked={allUnits} onChange={(event) => setAllUnits(event.target.checked)} />Show contacts from all units to link an existing person</label>}
        <RentalButton className={BUTTON} onClick={() => setEditing({})}>+ Add contact</RentalButton>
        {visible.length ? visible.map((contact) => card(contact, true)) : <p>No matching contacts. Add a contact or change your search.</p>}
      </>}
      {notice && <p role="status" className="break-words">{notice}</p>}
      <SubmissionActions><SubmissionButton className={BUTTON} onClick={close}>Close</SubmissionButton></SubmissionActions>
    </ModalCard></Modal>)}
  </section>
}

function ContactForm({ contact, properties, initialProperty, contacts, onClose, onSaved }) {
  const [details, setDetails] = useState(() => Object.fromEntries(['name', 'kind', 'organization', 'trade', 'phone', 'phone_alt', 'email', 'notes'].map((key) => [key, contact?.[key] || (key === 'kind' ? 'tenant' : '')])))
  const [links, setLinks] = useState(() => {
    const saved = contact?.rental_contact_links || []
    return initialProperty && !saved.some((link) => link.property_id === initialProperty.id)
      ? [...saved, { property_id: initialProperty.id, role: '' }] : saved
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const phoneDigits = details.phone.replace(/\D/g, '')
  const duplicates = phoneDigits.length >= 7 ? contacts.filter((person) => person.id !== contact?.id && [person.phone, person.phone_alt].some((phone) => phone.replace(/\D/g, '') === phoneDigits)) : []
  // The directory's existing contacts are linked by editing rather than duplicated.
  async function submit(event) {
    event.preventDefault()
    if (saving || !details.name.trim()) return
    setSaving(true); setError('')
    try { await saveRentalContact(contact?.id, Object.fromEntries(Object.entries(details).map(([key, value]) => [key, value.trim()])), links); onSaved() }
    catch (err) { setError(friendlyError(err)); setSaving(false) }
  }
  function field(key, label, type = 'text') {
    return <label>{label}<input className={INPUT} type={type} value={details[key]} required={key === 'name'} maxLength={key === 'name' ? 200 : 500} onChange={(event) => setDetails({ ...details, [key]: event.target.value })} /></label>
  }
  return <Modal onClose={() => { if (!saving) onClose() }}><ModalCard as="form" onSubmit={submit}>
    <h2>{contact ? 'Edit contact' : 'New contact'}</h2>
    {error && <p role="alert" className="error">{error}</p>}
    <fieldset disabled={saving} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      {field('name', 'Name')}
      <label>Type<select className={INPUT} value={details.kind} onChange={(event) => setDetails({ ...details, kind: event.target.value })}>{Object.entries(CONTACT_KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {field('organization', 'Company / organization (optional)')}
      {field('trade', 'Role / trade (optional)')}
      {field('phone', 'Phone (optional)', 'tel')}{field('phone_alt', 'Other phone (optional)', 'tel')}{field('email', 'Email (optional)', 'email')}
      {phoneDigits.length > 0 && phoneDigits.length < 7 && <p className="text-sm">Check the phone number — it looks short.</p>}
      {!!duplicates.length && <p role="status" className="text-sm">This number is already used by {duplicates.map((person) => person.name).join(', ')}. Check whether you should link that existing contact instead.</p>}
      <h3 className="m-0 text-base">Linked units</h3>
      <p className="m-0 text-sm">Select every unit this person serves. Use the same contact for multiple units.</p>
      {properties.filter((unit) => unit.active || links.some((link) => link.property_id === unit.id)).map((unit) => {
        const link = links.find((item) => item.property_id === unit.id)
        return <div key={unit.id}>
          <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}><input type="checkbox" checked={!!link} onChange={(event) => setLinks(event.target.checked ? [...links, { property_id: unit.id, role: '' }] : links.filter((item) => item.property_id !== unit.id))} />{unit.unit_name} ({unit.company}){!unit.active && ' — Archived unit'}</label>
          {link && <label>Role at {unit.unit_name}<input className={INPUT} placeholder="Tenant, plumber, HOA…" value={link.role} maxLength={200} onChange={(event) => setLinks(links.map((item) => item.property_id === unit.id ? { ...item, role: event.target.value } : item))} /></label>}
        </div>
      })}
      {!properties.length && <p>No units yet. You can save this contact and link a unit later.</p>}
      <label>Notes (optional)<textarea className={INPUT} rows={3} maxLength={10000} value={details.notes} onChange={(event) => setDetails({ ...details, notes: event.target.value })} /></label>
      <p className="m-0 text-sm">Keep passwords and door codes in the Vault. Everyone with Rentals access can view and edit these contacts.</p>
    </fieldset>
    <SubmissionActions><SubmissionButton className={BUTTON} disabled={saving} onClick={onClose}>Cancel</SubmissionButton><SubmissionButton className={BUTTON} type="submit" variant="primary" disabled={saving}>{saving ? 'Saving…' : 'Save contact'}</SubmissionButton></SubmissionActions>
  </ModalCard></Modal>
}

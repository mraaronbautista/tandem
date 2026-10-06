import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { addLeaseNote, fetchLeaseNotes, updateLeaseNote } from '../lib/leaseNotes'
import { bookingGuestLabel } from '../lib/rentals'
import { friendlyError } from '../lib/friendlyError'
import Modal from './Modal'
import ModalCard from './ModalCard'
import RentalButton from './RentalButton'
import LoadingText from './LoadingText'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

const INPUT = 'w-full min-h-[44px] rounded-[8px] border border-border bg-bg px-3 py-2 text-[15px] text-text-h'
function stamp(value) { return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }

export default function LeaseNotes({ unit, lease, me }) {
  const [notes, setNotes] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [leaseId, setLeaseId] = useState(lease?.id || '')
  const [archived, setArchived] = useState(false)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const pending = useRef(false)
  const draftRef = useRef(null)
  const reload = () => setReloadKey((key) => key + 1)
  useEffect(() => {
    let cancelled = false
    let generation = 0
    async function load() {
      const version = ++generation
      try {
        const rows = await fetchLeaseNotes(unit.id)
        if (!cancelled && version === generation) { setNotes(rows); setError('') }
      } catch (err) {
        if (!cancelled && version === generation) setError(['42P01', 'PGRST205'].includes(err.code)
          ? 'Lease notes are not set up yet. Ask Aaron to run the lease notes SQL, then try again.' : friendlyError(err))
      }
    }
    function refreshWhenVisible() {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)
    window.addEventListener('online', refreshWhenVisible)
    load()
    const channel = supabase.channel(`lease-notes-${unit.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_lease_notes', filter: `property_id=eq.${unit.id}` }, load)
      .subscribe((status) => {
        if (!cancelled && status === 'SUBSCRIBED') load()
      })
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
      window.removeEventListener('online', refreshWhenVisible)
      supabase.removeChannel(channel)
    }
  }, [unit.id, reloadKey])
  const active = (notes || []).filter((note) => note.booking_id === lease?.id && !note.archived)
  const history = new Map()
  if (lease) history.set(lease.id, { tenant_label: bookingGuestLabel(lease), lease_start: lease.check_in, lease_end: lease.check_out })
  for (const note of notes || []) if (!history.has(note.booking_id)) history.set(note.booking_id, note)
  const visible = (notes || []).filter((note) => note.booking_id === leaseId && (archived || !note.archived))
  function launch(add = false) {
    setLeaseId(lease?.id || history.keys().next().value || '')
    setDraft(''); setEditing(null); setNotice(''); setOpen(true)
    if (add) requestAnimationFrame(() => draftRef.current?.focus())
  }
  function close() { if (!pending.current) { setOpen(false); setDraft(''); setEditing(null); setNotice('') } }
  async function save(event) {
    event.preventDefault()
    if (pending.current || !draft.trim() || (!editing && leaseId !== lease?.id)) return
    pending.current = true; setBusy(true); setNotice('')
    try {
      const row = editing ? await updateLeaseNote(editing.id, { body: draft.trim() }) : await addLeaseNote(unit.id, lease.id, draft.trim())
      setNotes((rows) => [row, ...(rows || []).filter((note) => note.id !== row.id)].sort((a,b) => b.created_at.localeCompare(a.created_at)))
      setDraft(''); setEditing(null); setNotice('Note saved.'); reload()
    } catch (err) { setNotice(friendlyError(err)) }
    finally { pending.current = false; setBusy(false) }
  }
  async function archive(note) {
    if (pending.current) return
    pending.current = true; setBusy(true); setNotice('')
    try {
      const row = await updateLeaseNote(note.id, { archived: !note.archived })
      setNotes((rows) => rows.map((item) => item.id === row.id ? row : item))
      setNotice(row.archived ? 'Note archived. Use Include archived to restore it.' : 'Note restored.'); reload()
    } catch (err) { setNotice(friendlyError(err)) }
    finally { pending.current = false; setBusy(false) }
  }
  return <section className="mt-4 min-w-0 border-t border-border pt-3">
    <h3 className="m-0 text-base font-semibold text-text-h">Latest lease note</h3>
    {error ? <p role="alert" className="text-sm">{error} <RentalButton className="min-h-[44px]" onClick={reload}>Try again</RentalButton></p> : !notes ? <LoadingText /> : <>
      {active[0] ? <div className="my-3 border-l-2 border-accent-h pl-3"><p className="m-0 text-xs text-text">{stamp(active[0].created_at)} · {active[0].author_name}</p><p className="my-2 whitespace-pre-wrap break-words text-sm text-text-h">{active[0].body.length > 240 ? `${active[0].body.slice(0,240)}…` : active[0].body}</p></div> : <p className="text-sm text-text">{lease ? 'No notes yet. Record a conversation or update for this lease.' : 'Add a lease to keep dated notes for its tenants.'}</p>}
      <div className="flex flex-wrap gap-2">{lease && <RentalButton className="min-h-[44px]" onClick={() => launch(true)}>+ Add note</RentalButton>}<RentalButton className="min-h-[44px]" onClick={() => launch()}>{lease ? 'View notes' : 'View past notes'} ({lease ? active.length : (notes || []).filter((note) => !note.archived).length})</RentalButton></div>
    </>}
    {open && <Modal onClose={close}><ModalCard>
      <h2>Lease notes · {unit.unit_name}</h2>
      <label>Lease<select className={INPUT} aria-label="Lease" value={leaseId} disabled={busy || !!draft || !!editing} onChange={(event) => { setLeaseId(event.target.value); setNotice('') }}>{[...history.entries()].map(([id, info]) => <option key={id} value={id}>{info.tenant_label} · {info.lease_start} – {info.lease_end}{id !== lease?.id ? ' (Past lease)' : ''}</option>)}</select></label>
      {(leaseId === lease?.id || editing) && <form onSubmit={save}>
        <label>{editing ? 'Edit your note' : 'New note'}<textarea ref={draftRef} className={INPUT} rows={4} maxLength={10000} required value={draft} disabled={busy} onChange={(event) => setDraft(event.target.value)} placeholder="What happened or what should we remember?" /></label>
        <p className="text-sm text-text">Everyone with Rentals access can read these notes. Keep passwords and door codes in the Vault.</p>
        <SubmissionActions>{editing && <SubmissionButton className="min-h-[44px]" disabled={busy} onClick={() => { setEditing(null); setDraft('') }}>Cancel edit</SubmissionButton>}<SubmissionButton className="min-h-[44px]" variant="primary" type="submit" disabled={busy || !draft.trim()}>{busy ? 'Saving…' : 'Save note'}</SubmissionButton></SubmissionActions>
      </form>}
      {notice && <p role="status" className="break-words text-sm">{notice}</p>}
      <label style={{ display:'flex', flexDirection:'row', alignItems:'center', gap:8, minHeight:44 }}><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />Include archived</label>
      <h3 className="text-base">History · newest first</h3>
      {visible.length ? visible.map((note) => <article key={note.id} className="my-3 border-l-2 border-border pl-3">
        <p className="m-0 text-xs text-text">{stamp(note.created_at)} · {note.author_name}{note.archived && ' · Archived'}</p>
        {note.edited_at && <p className="my-1 text-xs text-text">Edited {stamp(note.edited_at)}</p>}
        <p className="my-2 whitespace-pre-wrap break-words text-sm text-text-h">{note.body}</p>
        {note.created_by === me?.id && <div className="flex flex-wrap gap-2"><RentalButton className="min-h-[44px]" disabled={busy || !!editing || !!draft.trim()} onClick={() => { setEditing(note); setDraft(note.body); requestAnimationFrame(() => draftRef.current?.focus()) }}>Edit my note</RentalButton><RentalButton className="min-h-[44px]" disabled={busy || !!editing} onClick={() => archive(note)}>{note.archived ? 'Restore my note' : 'Archive my note'}</RentalButton></div>}
      </article>) : <p className="text-sm">No notes for this lease yet.</p>}
      <SubmissionActions><SubmissionButton className="min-h-[44px]" disabled={busy} onClick={close}>Close</SubmissionButton></SubmissionActions>
    </ModalCard></Modal>}
  </section>
}

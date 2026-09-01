import { useEffect, useState } from 'react'
import { Check, Target } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { fetchCorkNotes, createCorkNote, updateCorkNote, deleteCorkNote, addCorkNoteComment } from '../lib/corkNotes'
import { createTask } from '../lib/tasks'
import { whoKeyForName } from '../lib/whoLabels'
import { detectDefaultTimezone, zonedTimeToUtcIso } from '../lib/timezone'

const composeClasses = 'flex flex-col gap-2 [&_textarea]:min-h-[70px] [&_textarea]:resize-y [&_textarea]:rounded-[8px] [&_textarea]:border [&_textarea]:border-border [&_textarea]:bg-card-bg [&_textarea]:px-3 [&_textarea]:py-2.5 [&_textarea]:text-[15px] [&_textarea]:text-text-h [&_textarea]:[font-family:inherit] [&_textarea]:[font-style:inherit] [&_textarea]:[font-variant:inherit] [&_textarea]:[font-weight:inherit] [&_textarea]:[line-height:inherit]'
const itemActionClasses = 'cursor-pointer rounded-[6px] border border-border bg-pill-bg px-2.5 py-1 text-xs text-text-h'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// 'YYYY-MM-DD' for today in the browser's own local timezone — matches
// what zonedTimeToUtcIso expects as its date argument (same helper as
// PrioritiesForm.jsx's day-period logic, which this mirrors).
function todayDateString() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Persistent tab content, not a modal — see RentalsView.jsx for why.
// Quick pins with no due date and no timeline, the opposite of a task,
// which is deliberately scheduled. `shared` is the one place in the app
// where visibility isn't automatically mutual (see the RLS comment on
// cork_notes in schema.sql) — a pin defaults to private, and putting it
// on the other person's board is an explicit opt-in toggle, not the
// default a shared task board would otherwise suggest.
export default function CorkBoardView({ me, memberName }) {
  const [notes, setNotes] = useState(null)
  const [error, setError] = useState('')
  const [body, setBody] = useState('')
  const [shared, setShared] = useState(false)
  const [posting, setPosting] = useState(false)
  const [promotingId, setPromotingId] = useState(null)
  const [promoted, setPromoted] = useState(() => new Set())
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState('')
  const [saving, setSaving] = useState(false)
  // Keyed by note id, not a single shared string — commenting on two
  // different pins shouldn't clobber each other's in-progress draft.
  const [commentDrafts, setCommentDrafts] = useState({})
  const [postingCommentId, setPostingCommentId] = useState(null)

  function reload() {
    fetchCorkNotes()
      .then(setNotes)
      .catch((err) => setError(err.message))
  }

  useEffect(() => {
    reload()

    const channel = supabase
      .channel('cork-notes-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cork_notes' }, () => reload())
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  async function handlePost(e) {
    e.preventDefault()
    const trimmed = body.trim()
    if (!trimmed || !me) return
    setPosting(true)
    try {
      await createCorkNote({ body: trimmed, shared, author_id: me.id })
      setBody('')
      setShared(false)
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setPosting(false)
    }
  }

  async function handleToggleShare(note) {
    try {
      await updateCorkNote(note.id, { shared: !note.shared })
      reload()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete(note) {
    if (!window.confirm('Unpin this note?')) return
    try {
      await deleteCorkNote(note.id)
      reload()
    } catch (err) {
      setError(err.message)
    }
  }

  function startEdit(note) {
    setEditingId(note.id)
    setEditDraft(note.body)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditDraft('')
  }

  async function handleSaveEdit(note) {
    const trimmed = editDraft.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await updateCorkNote(note.id, { body: trimmed })
      setEditingId(null)
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Silent by design, same reasoning as posting/sharing a pin — Cork
  // Board is a scratchpad, not an assignment, so no manual-notify call
  // here unlike task clarifications' ask/answer.
  async function handleAddComment(note) {
    const text = (commentDrafts[note.id] || '').trim()
    if (!text) return
    setPostingCommentId(note.id)
    try {
      await addCorkNoteComment(note.id, text)
      setCommentDrafts((prev) => ({ ...prev, [note.id]: '' }))
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setPostingCommentId(null)
    }
  }

  // Turns a pin into a real task due today, for "we're focusing on this
  // now" — mirrors PrioritiesForm's day-period logic (due at 23:59 local
  // so it can go overdue like any other task) rather than an All Day
  // task, since "today" is the whole point of promoting it. Assigned to
  // whoever does the promoting, not the pin's original author — claiming
  // it is the point, and for a shared pin that's often the other person.
  // The pin itself is left as-is; promoting doesn't unpin it.
  //
  // Any comments already on the pin carry over as checklist items — the
  // whole point of commenting on a pin is adding a thought/follow-up to
  // it, and those would otherwise be stranded on the pin once it turns
  // into a task nobody's looking at the pin for any more. Same shape
  // ChecklistEditor.jsx builds by hand (id/text/done/blocked/
  // blockedReason), so they're editable normally right after creation.
  // Each is prefixed with its author's name via the same memberName()
  // prop already used to render comments on the pin itself, since a
  // shared pin can carry thoughts from both people and the checklist
  // loses that attribution otherwise.
  async function handleFocusToday(note) {
    if (!me) return
    setPromotingId(note.id)
    try {
      // Zoned to whoever's actually promoting this, not always Eastern —
      // that mismatch used to push "today 23:59" into tomorrow morning
      // for Aaron (Philippines, ~12-13h ahead of Eastern).
      const zone = detectDefaultTimezone()
      const checklist = (note.comments || []).map((c) => ({
        id: crypto.randomUUID(),
        text: `${memberName(c.authorId)}: ${c.body}`,
        done: false,
        blocked: false,
        blockedReason: '',
      }))
      await createTask({
        title: note.body,
        who: whoKeyForName(me.display_name) || 'yours',
        due_date: zonedTimeToUtcIso(todayDateString(), '23:59', zone),
        due_timezone: zone,
        created_by: me.id,
        checklist,
      })
      setPromoted((prev) => new Set(prev).add(note.id))
    } catch (err) {
      setError(err.message)
    } finally {
      setPromotingId(null)
    }
  }

  return (
    <div className="tab-panel">
      <p className="text-[13px] opacity-65">Pin something with no deadline, so it doesn't get lost.</p>

      <form className={composeClasses} onSubmit={handlePost}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Pin a task or note…"
          maxLength={2000}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-[13px] opacity-85">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            Share to both boards
          </label>
          <button type="submit" className="cursor-pointer rounded-[8px] border-0 bg-accent px-4 py-2 font-semibold text-white disabled:cursor-default disabled:opacity-60" disabled={posting || !body.trim() || !me}>
            {posting ? 'Pinning…' : 'Pin it'}
          </button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}
      {!error && !notes && <p className="loading">Loading…</p>}
      {notes && !notes.length && <p className="task-notes-empty">Nothing pinned yet.</p>}

      {notes && notes.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {notes.map((note) => {
            const isOwn = note.author_id === me?.id
            const isEditing = editingId === note.id
            return (
              <li key={note.id} className="rounded-md border border-border bg-card-bg px-3.5 py-3 shadow-resting">
                {isEditing ? (
                  <div className={`${composeClasses} mb-2`}>
                    <textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      maxLength={2000}
                      autoFocus
                    />
                  </div>
                ) : (
                  <p className="mb-2 break-words whitespace-pre-wrap">{note.body}</p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs opacity-65">
                  <span>
                    {memberName(note.author_id)} · {formatDate(note.created_at)}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 whitespace-nowrap ${note.shared ? 'border-accent text-accent' : 'border-border'}`}>
                    {note.shared ? 'Shared' : 'Only you'}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        className={`${itemActionClasses} border-accent font-semibold text-accent disabled:cursor-default disabled:opacity-60`}
                        onClick={() => handleSaveEdit(note)}
                        disabled={saving || !editDraft.trim()}
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" className={itemActionClasses} onClick={cancelEdit} disabled={saving}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={`${itemActionClasses} border-accent font-semibold text-accent disabled:cursor-default disabled:opacity-60`}
                        onClick={() => handleFocusToday(note)}
                        disabled={promotingId === note.id || promoted.has(note.id)}
                      >
                        {promoted.has(note.id) ? (
                          <>
                            <Check size={14} className="inline align-[-2px]" /> Added to Today
                          </>
                        ) : promotingId === note.id ? (
                          'Adding…'
                        ) : (
                          <>
                            <Target size={14} className="inline align-[-2px]" /> Focus today
                          </>
                        )}
                      </button>
                      {isOwn && (
                        <>
                          <button type="button" className={itemActionClasses} onClick={() => startEdit(note)}>
                            Edit
                          </button>
                          <button type="button" className={itemActionClasses} onClick={() => handleToggleShare(note)}>
                            {note.shared ? 'Make private' : 'Share'}
                          </button>
                          <button type="button" className={itemActionClasses} onClick={() => handleDelete(note)}>
                            Unpin
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
                {!isEditing && (
                  <div className="mt-2.5 flex flex-col gap-2 border-t border-border pt-2.5">
                    {note.comments?.length > 0 && (
                      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                        {note.comments.map((c) => (
                          <li key={c.id} className="flex items-baseline gap-1.5 text-[13px]">
                            <span className="flex-none font-semibold opacity-75">{memberName(c.authorId)}</span>
                            <span className="break-words whitespace-pre-wrap">{c.body}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault()
                        handleAddComment(note)
                      }}
                    >
                      <input
                        className="min-w-0 flex-1 rounded-[8px] border border-border bg-card-bg px-2.5 py-[7px] text-[13px] text-text-h [font-family:inherit] [font-style:inherit] [font-variant:inherit] [font-weight:inherit] [line-height:inherit]"
                        type="text"
                        value={commentDrafts[note.id] || ''}
                        onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [note.id]: e.target.value }))}
                        placeholder="Add a thought…"
                        maxLength={2000}
                      />
                      <button
                        type="submit"
                        className="flex-none cursor-pointer rounded-[8px] border border-border bg-pill-bg px-3 py-[7px] text-[13px] text-text-h disabled:cursor-default disabled:opacity-60"
                        disabled={postingCommentId === note.id || !(commentDrafts[note.id] || '').trim()}
                      >
                        {postingCommentId === note.id ? '…' : 'Add'}
                      </button>
                    </form>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

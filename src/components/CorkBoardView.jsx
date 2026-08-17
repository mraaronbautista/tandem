import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchCorkNotes, createCorkNote, updateCorkNote, deleteCorkNote, addCorkNoteComment } from '../lib/corkNotes'
import { createTask } from '../lib/tasks'
import { whoKeyForName } from '../lib/whoLabels'
import { detectDefaultTimezone, zonedTimeToUtcIso } from '../lib/timezone'

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
      alert(err.message)
    } finally {
      setPosting(false)
    }
  }

  async function handleToggleShare(note) {
    try {
      await updateCorkNote(note.id, { shared: !note.shared })
      reload()
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleDelete(note) {
    if (!window.confirm('Unpin this note?')) return
    try {
      await deleteCorkNote(note.id)
      reload()
    } catch (err) {
      alert(err.message)
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
      alert(err.message)
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
      alert(err.message)
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
  async function handleFocusToday(note) {
    if (!me) return
    setPromotingId(note.id)
    try {
      // Zoned to whoever's actually promoting this, not always Eastern —
      // that mismatch used to push "today 23:59" into tomorrow morning
      // for Aaron (Philippines, ~12-13h ahead of Eastern).
      const zone = detectDefaultTimezone()
      await createTask({
        title: note.body,
        who: whoKeyForName(me.display_name) || 'yours',
        due_date: zonedTimeToUtcIso(todayDateString(), '23:59', zone),
        due_timezone: zone,
        created_by: me.id,
      })
      setPromoted((prev) => new Set(prev).add(note.id))
    } catch (err) {
      alert(err.message)
    } finally {
      setPromotingId(null)
    }
  }

  return (
    <div className="tab-panel">
      <p className="cork-board-subtitle">Pin something with no deadline, so it doesn't get lost.</p>

      <form className="cork-board-compose" onSubmit={handlePost}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Pin a task or note…"
          maxLength={2000}
        />
        <div className="cork-board-compose-actions">
          <label className="cork-board-share-toggle">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            Share to both boards
          </label>
          <button type="submit" disabled={posting || !body.trim() || !me}>
            {posting ? 'Pinning…' : 'Pin it'}
          </button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}
      {!error && !notes && <p className="loading">Loading…</p>}
      {notes && !notes.length && <p className="task-notes-empty">Nothing pinned yet.</p>}

      {notes && notes.length > 0 && (
        <ul className="cork-board-list">
          {notes.map((note) => {
            const isOwn = note.author_id === me?.id
            const isEditing = editingId === note.id
            return (
              <li key={note.id} className="cork-board-item">
                {isEditing ? (
                  <div className="cork-board-compose">
                    <textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      maxLength={2000}
                      autoFocus
                    />
                  </div>
                ) : (
                  <p className="cork-board-item-body">{note.body}</p>
                )}
                <div className="cork-board-item-meta">
                  <span>
                    {memberName(note.author_id)} · {formatDate(note.created_at)}
                  </span>
                  <span className={`cork-board-badge${note.shared ? ' cork-board-badge-shared' : ''}`}>
                    {note.shared ? 'Shared' : 'Only you'}
                  </span>
                </div>
                <div className="cork-board-item-actions">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        className="cork-board-save-edit"
                        onClick={() => handleSaveEdit(note)}
                        disabled={saving || !editDraft.trim()}
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" onClick={cancelEdit} disabled={saving}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="cork-board-focus-today"
                        onClick={() => handleFocusToday(note)}
                        disabled={promotingId === note.id || promoted.has(note.id)}
                      >
                        {promoted.has(note.id)
                          ? '✓ Added to Today'
                          : promotingId === note.id
                            ? 'Adding…'
                            : '🎯 Focus today'}
                      </button>
                      {isOwn && (
                        <>
                          <button type="button" onClick={() => startEdit(note)}>
                            Edit
                          </button>
                          <button type="button" onClick={() => handleToggleShare(note)}>
                            {note.shared ? 'Make private' : 'Share'}
                          </button>
                          <button type="button" onClick={() => handleDelete(note)}>
                            Unpin
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
                {!isEditing && (
                  <div className="cork-board-comments">
                    {note.comments?.length > 0 && (
                      <ul className="cork-board-comment-list">
                        {note.comments.map((c) => (
                          <li key={c.id} className="cork-board-comment">
                            <span className="cork-board-comment-author">{memberName(c.authorId)}</span>
                            <span className="cork-board-comment-body">{c.body}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <form
                      className="cork-board-comment-form"
                      onSubmit={(e) => {
                        e.preventDefault()
                        handleAddComment(note)
                      }}
                    >
                      <input
                        type="text"
                        value={commentDrafts[note.id] || ''}
                        onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [note.id]: e.target.value }))}
                        placeholder="Add a thought…"
                        maxLength={2000}
                      />
                      <button
                        type="submit"
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

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchCorkNotes, createCorkNote, updateCorkNote, deleteCorkNote } from '../lib/corkNotes'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
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

  return (
    <div className="tab-panel">
      <h2>Cork Board</h2>
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
            return (
              <li key={note.id} className="cork-board-item">
                <p className="cork-board-item-body">{note.body}</p>
                <div className="cork-board-item-meta">
                  <span>
                    {memberName(note.author_id)} · {formatDate(note.created_at)}
                  </span>
                  <span className={`cork-board-badge${note.shared ? ' cork-board-badge-shared' : ''}`}>
                    {note.shared ? 'Shared' : 'Only you'}
                  </span>
                </div>
                {isOwn && (
                  <div className="cork-board-item-actions">
                    <button type="button" onClick={() => handleToggleShare(note)}>
                      {note.shared ? 'Make private' : 'Share'}
                    </button>
                    <button type="button" onClick={() => handleDelete(note)}>
                      Unpin
                    </button>
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

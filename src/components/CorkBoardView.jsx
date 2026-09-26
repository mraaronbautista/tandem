import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Target, Undo2, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { fetchCorkNotes, createCorkNote, updateCorkNote, deleteCorkNote, addCorkNoteComment, restoreArchivedTask } from '../lib/corkNotes'
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

// A `## ` line sets which milestone every following step belongs to, until
// the next `## ` line — same context-carrying idea parseBulkTasks (Bulk
// Add's two-line paste format) already uses for its own date headers. A
// step typed before any `##` line gets milestone: null, so a plain
// no-milestone roadmap (the common case) parses exactly as it did before
// this existed.
function parseRoadmapDraft(draft) {
  let milestone = null
  const items = []
  for (const raw of draft.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('##')) {
      milestone = line.replace(/^##\s*/, '').trim() || null
      continue
    }
    items.push({ id: crypto.randomUUID(), text: line, taskId: null, milestone })
  }
  return items
}

// Runs of consecutive same-milestone items become one group — matches how
// parseRoadmapDraft above actually produces the array (every step between
// two `##` lines lands contiguously), so this never needs to regroup by
// value across the whole list, just notice when the milestone changes from
// one item to the next. A group with milestone: null renders with no
// header at all (see the render side in the component below).
function groupRoadmapItems(items) {
  const groups = []
  for (const item of items) {
    const last = groups[groups.length - 1]
    if (last && last.milestone === item.milestone) last.items.push(item)
    else groups.push({ milestone: item.milestone, items: [item] })
  }
  return groups
}

// The inverse of parseRoadmapDraft — reconstructs editable "## Heading" /
// step-per-line text from the stored items, so opening Edit on a project
// shows the same syntax that created it rather than a blank textarea. A
// blank line between groups is purely readability (the parser doesn't need
// it — it only cares about `##` lines vs. everything else), matching how
// the compose form's own placeholder is written.
function serializeRoadmapItems(items) {
  return groupRoadmapItems(items)
    .map((group) => {
      const lines = group.milestone ? [`## ${group.milestone}`, ...group.items.map((i) => i.text)] : group.items.map((i) => i.text)
      return lines.join('\n')
    })
    .join('\n\n')
}

// Saving an edited roadmap draft re-parses it from scratch (parseRoadmapDraft
// gives every line a fresh id and taskId: null, same as a brand-new pin) —
// this reconciles that fresh parse against what was actually stored before,
// so a step whose wording didn't change keeps its real id and, critically,
// its taskId. Without this, editing a project's steps at all would silently
// unlink every already-added step from its real task (taskById would stop
// finding it under the old id, and a hard-deleted-task-shaped "Added" label
// would show for something that's actually still tracked fine — see the
// taskId-not-in-taskById fallback below). Matches purely on exact trimmed
// text, not milestone or position, since moving a step to a different
// milestone or reordering it shouldn't be treated as replacing it; each old
// item can only match once (removed from the pool as it's consumed) so two
// identical-text lines pair up one-to-one rather than both claiming the
// same link.
function reconcileRoadmapItems(oldItems, newItems) {
  const pool = [...oldItems]
  return newItems.map((item) => {
    const matchIndex = pool.findIndex((old) => old.text === item.text)
    if (matchIndex === -1) return item
    const [matched] = pool.splice(matchIndex, 1)
    return { ...item, id: matched.id, taskId: matched.taskId }
  })
}

// Persistent tab content, not a modal — see RentalsView.jsx for why.
// Quick pins with no due date and no timeline, the opposite of a task,
// which is deliberately scheduled. `shared` is the one place in the app
// where visibility isn't automatically mutual (see the RLS comment on
// cork_notes in schema.sql) — a pin defaults to private, and putting it
// on the other person's board is an explicit opt-in toggle, not the
// default a shared task board would otherwise suggest.
//
// `mode` ('pins' | 'projects') is BoardView.jsx's own Pins/Projects/Inbox
// split, not a second component — a roadmap pin (any pin with a non-empty
// roadmap_items) renders only under 'projects', an ordinary pin only under
// 'pins', so the two sections never show overlapping content and nothing
// needs a separate "is this a project" boolean beyond that same
// roadmap_items check CorkBoardView already used before this split existed.
// `tasks` (the same live array TaskBoard.jsx already keeps current via its
// own Realtime channel, threaded down through BoardView.jsx exactly like
// InboxView already receives it) is what makes a milestone step's "done"
// state real rather than just "was it added" — see taskById below.
export default function CorkBoardView({ me, memberName, focusPinRequest = 0, mode = 'pins', tasks = [] }) {
  const [notes, setNotes] = useState(null)
  const [error, setError] = useState('')
  const [body, setBody] = useState('')
  const [shared, setShared] = useState(false)
  const [posting, setPosting] = useState(false)
  const [promotingId, setPromotingId] = useState(null)
  const [promoted, setPromoted] = useState(() => new Set())
  // A roadmap pin is just a plain pin whose roadmap_items isn't empty — no
  // separate boolean to keep in sync, only ever populated by the compose
  // form's own roadmap-steps textarea, shown when mode === 'projects' (see
  // the render below). One step per line, same parsing simplicity as
  // everywhere else in this app that turns pasted lines into structured
  // items.
  const [roadmapDraft, setRoadmapDraft] = useState('')
  // Keyed "noteId:itemId", not a single id — two different pins' items
  // can't clobber each other's in-flight "Adding…" state.
  const [addingItemKey, setAddingItemKey] = useState(null)
  // Which item's "Add to timeline" has its date picker open right now —
  // a single key, not a Set, since only one row is ever mid-add at a time
  // in practice and this mirrors editingId's own single-value shape.
  const [openAddKey, setOpenAddKey] = useState(null)
  // Keyed the same "noteId:itemId" way as addingItemKey — a modifiable
  // deadline per step, requested directly once milestones needed their own
  // timeline instead of every step landing on today's date by default.
  const [addDateDrafts, setAddDateDrafts] = useState({})
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState('')
  // Only populated/rendered for a project pin (see startEdit below) —
  // editing an ordinary pin never touches this. Reconciled against the
  // stored items on save (reconcileRoadmapItems), not re-parsed cold, so
  // editing steps doesn't unlink any already-added task.
  const [editRoadmapDraft, setEditRoadmapDraft] = useState('')
  const [saving, setSaving] = useState(false)
  // Collapsed by default — an archived pin is meant to be tucked away,
  // not sitting open and competing with the active board for attention;
  // same "collapsed until you go looking" reasoning VaultView.jsx's own
  // folders use.
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [archivingId, setArchivingId] = useState(null)
  const [restoringId, setRestoringId] = useState(null)
  // Keyed by note id, not a single shared string — commenting on two
  // different pins shouldn't clobber each other's in-progress draft.
  const [commentDrafts, setCommentDrafts] = useState({})
  const [postingCommentId, setPostingCommentId] = useState(null)
  const composerRef = useRef(null)

  useEffect(() => {
    if (!focusPinRequest) return
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    composerRef.current?.focus()
  }, [focusPinRequest])

  function reload() {
    fetchCorkNotes()
      .then(setNotes)
      .catch((err) => setError(err.message))
  }

  // A roadmap step's "done" state reads straight off the real task's own
  // status instead of just "does taskId exist" — the whole point of the
  // sync requested for this feature. Built once per tasks change rather
  // than a .find() per item per render, since a pin can carry many steps
  // across several milestones.
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])

  function isRoadmapPin(note) {
    return note.roadmap_items?.length > 0
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
      await createCorkNote({ body: trimmed, shared, author_id: me.id, roadmap_items: parseRoadmapDraft(roadmapDraft) })
      setBody('')
      setShared(false)
      setRoadmapDraft('')
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

  // Reversible, so no confirm — unlike delete below, archiving doesn't
  // lose anything; the pin (and its comments) just move into the
  // collapsed Archived section instead of sitting on the active board.
  async function handleArchive(note, archived) {
    setArchivingId(note.id)
    try {
      await updateCorkNote(note.id, { archived })
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setArchivingId(null)
    }
  }

  // A pin created by TaskRow.jsx's "Send to board" action (archived_task_id
  // set) — un-archives that exact task and archives this pin in the same
  // motion, see restoreArchivedTask() in corkNotes.js. Not author-gated,
  // same reasoning handleFocusToday() below already isn't — anyone who can
  // see the pin (own, or shared to them) can bring the task back.
  async function handleRestoreToToday(note) {
    setRestoringId(note.id)
    try {
      await restoreArchivedTask(note)
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setRestoringId(null)
    }
  }

  async function handleDelete(note) {
    if (!window.confirm('Delete this pin permanently? This can\'t be undone.')) return
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
    setEditRoadmapDraft(note.roadmap_items?.length ? serializeRoadmapItems(note.roadmap_items) : '')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditDraft('')
    setEditRoadmapDraft('')
  }

  async function handleSaveEdit(note) {
    const trimmed = editDraft.trim()
    if (!trimmed) return
    if (isRoadmapPin(note) && !editRoadmapDraft.trim()) return
    setSaving(true)
    try {
      const patch = { body: trimmed }
      if (isRoadmapPin(note)) {
        patch.roadmap_items = reconcileRoadmapItems(note.roadmap_items, parseRoadmapDraft(editRoadmapDraft))
      }
      await updateCorkNote(note.id, patch)
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

  // The roadmap-pin counterpart to handleFocusToday() above — a real task
  // due at 23:59 local on whatever date was chosen (see openAddRow below;
  // defaults to today, but is genuinely modifiable now, not hardcoded),
  // assigned to whoever's adding it. No checklist carryover the way
  // handleFocusToday's own comments do — a roadmap step is already the
  // smallest unit here, not a note with its own follow-up thread. Marks
  // taskId on that item (a plain read-modify-write on roadmap_items, same
  // low-ceremony pattern tasks.checklist/rental_bookings.paid_charges
  // already use for their own jsonb array fields) so the button can't be
  // double-clicked into creating two tasks for the same step — from that
  // point on, this item's "done" state is read off the real task via
  // taskById, not tracked here at all.
  async function handleAddRoadmapItem(note, item, dateStr) {
    if (!me) return
    const key = `${note.id}:${item.id}`
    setAddingItemKey(key)
    try {
      const zone = detectDefaultTimezone()
      const task = await createTask({
        title: item.text,
        who: whoKeyForName(me.display_name) || 'yours',
        due_date: zonedTimeToUtcIso(dateStr || todayDateString(), '23:59', zone),
        due_timezone: zone,
        created_by: me.id,
      })
      const nextItems = note.roadmap_items.map((i) => (i.id === item.id ? { ...i, taskId: task.id } : i))
      await updateCorkNote(note.id, { roadmap_items: nextItems })
      setOpenAddKey(null)
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setAddingItemKey(null)
    }
  }

  // Opens the inline date picker for one step, seeding its draft to today
  // only the first time (so re-opening after cancelling doesn't clobber a
  // date already picked) — same "only default once" reasoning the Rentals
  // form's own defaultTerm prop already follows.
  function openAddRow(note, item) {
    const key = `${note.id}:${item.id}`
    setOpenAddKey(key)
    setAddDateDrafts((prev) => (prev[key] ? prev : { ...prev, [key]: todayDateString() }))
  }

  const isProjects = mode === 'projects'
  const modeNotes = notes?.filter((n) => isRoadmapPin(n) === isProjects) ?? []
  const activeNotes = modeNotes.filter((n) => !n.archived)
  const archivedNotes = modeNotes.filter((n) => n.archived)

  return (
    <div className="tab-panel">
      <p className="text-[13px] opacity-65">
        {isProjects
          ? 'Break a project into milestones, then pull steps onto the real timeline when you\'re ready for them.'
          : 'Pin something with no deadline, so it doesn\'t get lost.'}
      </p>

      <form className={composeClasses} onSubmit={handlePost}>
        <textarea
          ref={composerRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={isProjects ? 'Project name or goal…' : 'Pin a task or note…'}
          maxLength={2000}
        />

        {isProjects ? (
          <label className="flex flex-col gap-1 text-[13px] opacity-85">
            Roadmap steps — one per line. Start a line with <code>##</code> to group the steps under it into a
            milestone.
            <textarea
              value={roadmapDraft}
              onChange={(e) => setRoadmapDraft(e.target.value)}
              placeholder={'## Setup\nRegister the business\nSet up the store\n\n## Sourcing\nSource a manufacturer\nDesign packaging'}
              maxLength={4000}
            />
          </label>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-[13px] opacity-85">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            Share to both boards
          </label>
          <button
            type="submit"
            className="cursor-pointer rounded-[8px] border-0 bg-accent px-4 py-2 font-semibold text-white disabled:cursor-default disabled:opacity-60"
            disabled={posting || !body.trim() || (isProjects && !roadmapDraft.trim()) || !me}
          >
            {posting ? (isProjects ? 'Creating…' : 'Pinning…') : isProjects ? 'Create project' : 'Pin it'}
          </button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}
      {!error && !notes && <p className="loading">Loading…</p>}
      {notes && !modeNotes.length && (
        <p className="task-notes-empty">{isProjects ? 'No active projects yet.' : 'Nothing pinned yet.'}</p>
      )}

      {modeNotes.length > 0 && !activeNotes.length && archivedNotes.length > 0 && (
        <p className="task-notes-empty">
          {isProjects ? 'No active projects — see Archived below.' : 'Nothing pinned yet — see Archived below.'}
        </p>
      )}

      {activeNotes.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {activeNotes.map((note) => {
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
                    {isRoadmapPin(note) && (
                      <label className="flex flex-col gap-1 text-[13px] opacity-85">
                        Roadmap steps — one per line. Start a line with <code>##</code> to group the steps under it
                        into a milestone. A step already on the timeline stays linked as long as its wording here
                        doesn't change.
                        <textarea value={editRoadmapDraft} onChange={(e) => setEditRoadmapDraft(e.target.value)} maxLength={4000} />
                      </label>
                    )}
                  </div>
                ) : (
                  <p className="mb-2 break-words whitespace-pre-wrap">{note.body}</p>
                )}

                {/* Grouped by milestone (groupRoadmapItems — runs of
                    consecutive same-milestone items, matching how
                    parseRoadmapDraft actually produces the array). A
                    group with milestone: null (no ## header used) renders
                    its items with no header/progress bar, same as a plain
                    ungrouped roadmap looked before milestones existed.
                    "Done" is read straight off the linked real task's own
                    status via taskById — not just whether taskId is set —
                    so checking a step off on the real timeline is what
                    marks it done here too, with nothing to keep in sync
                    by hand. */}
                {!isEditing && note.roadmap_items?.length > 0 && (
                  <div className="mb-2 flex flex-col gap-3">
                    {groupRoadmapItems(note.roadmap_items).map((group, groupIndex) => {
                      const doneCount = group.items.filter((item) => taskById.get(item.taskId)?.status === 'done').length
                      const total = group.items.length
                      const pct = total ? Math.round((doneCount / total) * 100) : 0
                      return (
                        <div key={group.milestone ?? `_${groupIndex}`}>
                          {group.milestone && (
                            <>
                              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                                <span className="text-[13px] font-bold text-text-h">{group.milestone}</span>
                                <span className="flex-none text-[11.5px] font-semibold opacity-70">
                                  {doneCount} of {total} done
                                </span>
                              </div>
                              <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-pill-bg">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-accent to-accent-h transition-[width]"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </>
                          )}
                          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                            {group.items.map((item) => {
                              const key = `${note.id}:${item.id}`
                              const linkedTask = item.taskId ? taskById.get(item.taskId) : null
                              const done = linkedTask?.status === 'done'
                              return (
                                <li
                                  key={item.id}
                                  className="flex items-center justify-between gap-2 rounded-[6px] border border-border bg-bg px-2.5 py-1.5 text-[13px]"
                                >
                                  <span className={`break-words whitespace-pre-wrap ${done ? 'text-text line-through opacity-55' : ''}`}>
                                    {item.text}
                                  </span>
                                  {done ? (
                                    <span className="flex-none text-xs text-accent">
                                      <Check size={13} className="inline align-[-2px]" /> Done
                                    </span>
                                  ) : item.taskId ? (
                                    // A taskId that no longer resolves means the
                                    // linked task was hard-deleted (not just
                                    // archived — an archived task still shows up
                                    // in taskById, see TaskBoard.jsx's own
                                    // unfiltered `tasks` state) — falls back to a
                                    // bare "Added" rather than a due date that
                                    // doesn't exist any more.
                                    <span className="flex-none text-xs opacity-70">
                                      {linkedTask ? `Due ${formatDate(linkedTask.due_date)}` : 'Added'}
                                    </span>
                                  ) : openAddKey === key ? (
                                    <span className="flex flex-none items-center gap-1.5">
                                      <input
                                        type="date"
                                        value={addDateDrafts[key] || todayDateString()}
                                        onChange={(e) => setAddDateDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                                        className="rounded-[6px] border border-border bg-card-bg px-1.5 py-1 text-xs text-text-h"
                                      />
                                      <button
                                        type="button"
                                        className="cursor-pointer rounded-[6px] border-0 bg-accent px-2 py-1 text-xs font-semibold text-white disabled:cursor-default disabled:opacity-60"
                                        onClick={() => handleAddRoadmapItem(note, item, addDateDrafts[key])}
                                        disabled={addingItemKey === key}
                                      >
                                        {addingItemKey === key ? '…' : 'Add'}
                                      </button>
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      className="flex-none cursor-pointer rounded-[6px] border border-accent bg-transparent px-2 py-1 text-xs font-semibold text-accent"
                                      onClick={() => openAddRow(note, item)}
                                    >
                                      Add to timeline
                                    </button>
                                  )}
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs opacity-65">
                  <span>
                    {memberName(note.author_id)} · {formatDate(note.created_at)}
                    {note.archived_task_id && ' · Archived task'}
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
                        disabled={saving || !editDraft.trim() || (isRoadmapPin(note) && !editRoadmapDraft.trim())}
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" className={itemActionClasses} onClick={cancelEdit} disabled={saving}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {/* A task-linked pin gets Restore instead of Focus
                          today — that button would otherwise create a
                          second, detail-stripped duplicate of a task that
                          already exists (just archived), rather than
                          actually bringing the original back. A roadmap pin
                          gets neither — its own items above already carry
                          per-step "Add to timeline" buttons, so promoting the
                          whole pin body as one more task on top of that
                          would be redundant. Every other action (Edit/
                          Share/Archive) applies the same way to every kind
                          of pin, so only this one button branches. */}
                      {note.archived_task_id ? (
                        <button
                          type="button"
                          className={`${itemActionClasses} border-accent font-semibold text-accent disabled:cursor-default disabled:opacity-60`}
                          onClick={() => handleRestoreToToday(note)}
                          disabled={restoringId === note.id}
                        >
                          {restoringId === note.id ? (
                            'Restoring…'
                          ) : (
                            <>
                              <Undo2 size={14} className="inline align-[-2px]" /> Restore to Today
                            </>
                          )}
                        </button>
                      ) : note.roadmap_items?.length > 0 ? null : (
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
                      )}
                      {isOwn && (
                        <>
                          <button type="button" className={itemActionClasses} onClick={() => startEdit(note)}>
                            Edit
                          </button>
                          <button type="button" className={itemActionClasses} onClick={() => handleToggleShare(note)}>
                            {note.shared ? 'Make private' : 'Share'}
                          </button>
                          <button
                            type="button"
                            className={itemActionClasses}
                            onClick={() => handleArchive(note, true)}
                            disabled={archivingId === note.id}
                          >
                            {archivingId === note.id ? '…' : 'Archive'}
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

      {archivedNotes.length > 0 && (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setArchivedOpen((v) => !v)}
            className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-transparent px-3.5 py-2 text-[13px] text-text-h opacity-75"
          >
            <span>Archived ({archivedNotes.length})</span>
            {archivedOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {archivedOpen && (
            <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
              {archivedNotes.map((note) => {
                const isOwn = note.author_id === me?.id
                return (
                  <li key={note.id} className="rounded-md border border-border bg-card-bg px-3.5 py-2.5 opacity-70">
                    <p className="mb-1.5 break-words whitespace-pre-wrap">{note.body}</p>
                    <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs opacity-65">
                      <span>
                        {memberName(note.author_id)} · {formatDate(note.created_at)}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 whitespace-nowrap ${note.shared ? 'border-accent text-accent' : 'border-border'}`}>
                        {note.shared ? 'Shared' : 'Only you'}
                      </span>
                    </div>
                    {isOwn && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={itemActionClasses}
                          onClick={() => handleArchive(note, false)}
                          disabled={archivingId === note.id}
                        >
                          {archivingId === note.id ? '…' : 'Unarchive'}
                        </button>
                        <button type="button" className={itemActionClasses} onClick={() => handleDelete(note)}>
                          Delete
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Target, Undo2, ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import HelpHint from './HelpHint'
import { fetchCorkNotes, createCorkNote, updateCorkNote, deleteCorkNote, addCorkNoteComment, restoreArchivedTask } from '../lib/corkNotes'
import { createTask } from '../lib/tasks'
import { detectDefaultTimezone, zonedTimeToUtcIso } from '../lib/timezone'
import { useConfirm } from '../lib/confirmContext'

const composeClasses = 'flex flex-col gap-2 [&_textarea]:min-h-[70px] [&_textarea]:resize-y [&_textarea]:rounded-[8px] [&_textarea]:border [&_textarea]:border-border [&_textarea]:bg-card-bg [&_textarea]:px-3 [&_textarea]:py-2.5 [&_textarea]:text-[15px] [&_textarea]:text-text-h [&_textarea]:[font-family:inherit] [&_textarea]:[font-style:inherit] [&_textarea]:[font-variant:inherit] [&_textarea]:[font-weight:inherit] [&_textarea]:[line-height:inherit]'
const itemActionClasses = 'cursor-pointer rounded-[6px] border border-border bg-pill-bg px-2.5 py-1 text-xs text-text-h'

// How long a removed roadmap step stays undoable. The removal is already
// persisted by the time this window starts — Undo just re-inserts and
// re-saves, same as any other edit, so there's no hidden "pending" state
// a reload would lose. Navigating away or waiting this out simply
// forfeits the undo, which is honest about what this actually is (a
// quick re-insert, not a true transactional rollback the plan doc itself
// warned not to overpromise).
const REMOVE_UNDO_MS = 8000

function formatDate(iso) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// "Only you" / "Shared with Ada" / "Shared with Ada, Aaron" — always
// names every target, same as assigneeBadge() (whoLabels.js) does for a
// task's own assignee_ids rather than collapsing to a bare count once
// there's more than one.
function sharedLabel(sharedWith, memberName) {
  if (!sharedWith?.length) return 'Only you'
  return `Shared with ${sharedWith.map((id) => memberName(id)).join(', ')}`
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

// One roadmap step — extracted out of the milestone-group loop since it's
// now rendered from two different lists (open items, and the collapsed
// Completed section below them) instead of one straight .map(). isOwn
// gates the remove button the same way Edit/Share/Archive are already
// gated elsewhere on the pin — not just UX consistency, the underlying
// cork_notes UPDATE policy is author-only, so a non-author's write here
// would fail RLS regardless of what the UI shows.
function RoadmapItemRow({
  note,
  item,
  done,
  linkedTask,
  isOwn,
  openAddKey,
  addDateDrafts,
  setAddDateDrafts,
  addingItemKey,
  onOpenAddRow,
  onAddRoadmapItem,
  onRemoveItem,
}) {
  const key = `${note.id}:${item.id}`
  return (
    <li className="flex items-center justify-between gap-2 rounded-[6px] border border-border bg-bg px-2.5 py-1.5 text-[13px]">
      <span className={`break-words whitespace-pre-wrap ${done ? 'text-text line-through opacity-75' : ''}`}>{item.text}</span>
      <span className="flex flex-none items-center gap-1.5">
        {done ? (
          <span className="text-xs text-accent-text">
            <Check size={13} className="inline align-[-2px]" /> Done
          </span>
        ) : item.taskId ? (
          // A taskId that no longer resolves means the linked task was
          // hard-deleted (not just archived — an archived task still
          // shows up in taskById, see TaskBoard.jsx's own unfiltered
          // `tasks` state) — falls back to a bare "Added" rather than a
          // due date that doesn't exist any more.
          <span className="text-xs opacity-80">{linkedTask ? `Due ${formatDate(linkedTask.due_date)}` : 'Added'}</span>
        ) : openAddKey === key ? (
          <span className="flex items-center gap-1.5">
            <input
              type="date"
              value={addDateDrafts[key] || todayDateString()}
              onChange={(e) => setAddDateDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
              className="rounded-[6px] border border-border bg-card-bg px-1.5 py-1 text-xs text-text-h"
            />
            <button
              type="button"
              className="cursor-pointer rounded-[6px] border-0 bg-accent px-2 py-1 text-xs font-semibold text-on-accent disabled:cursor-default disabled:opacity-60"
              onClick={() => onAddRoadmapItem(note, item, addDateDrafts[key])}
              disabled={addingItemKey === key}
            >
              {addingItemKey === key ? '…' : 'Add'}
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="cursor-pointer rounded-[6px] border border-accent bg-transparent px-2 py-1 text-xs font-semibold text-accent-text"
            onClick={() => onOpenAddRow(note, item)}
          >
            Add to timeline
          </button>
        )}
        {/* Only removable before it's been scheduled — once a step has a
            real linked task (taskId set), removing it here would just
            delete the roadmap entry and silently orphan the task itself
            rather than the two staying in sync; deleting the task (from
            Timeline) is the real removal path at that point. */}
        {isOwn && !item.taskId && (
          <button
            type="button"
            aria-label={`Remove "${item.text}"`}
            className="cursor-pointer rounded-[6px] border border-border bg-transparent p-1 text-text opacity-80 hover:opacity-100"
            onClick={() => onRemoveItem(note, item)}
          >
            <X size={13} />
          </button>
        )}
      </span>
    </li>
  )
}

// Persistent tab content, not a modal — see RentalsView.jsx for why.
// Quick pins with no due date and no timeline, the opposite of a task,
// which is deliberately scheduled. `shared_with` is the one place in the
// app where visibility isn't automatically mutual (see the RLS comment on
// cork_notes in schema.sql) — a pin defaults to private, and sharing it
// means picking specific members, not the default a shared task board
// would otherwise suggest. Used to be a plain boolean ("share with
// literally everyone") back when this was a 2-person app; an array now,
// same reasoning task_access exists for tasks — with more than two
// members, "shared" isn't a single yes/no any more.
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
// `members` (also threaded down the same way) is what the sharing picker
// below offers as targets.
export default function CorkBoardView({ me, memberName, members = [], focusPinRequest = 0, mode = 'pins', tasks = [] }) {
  const confirm = useConfirm()
  const [notes, setNotes] = useState(null)
  const [error, setError] = useState('')
  const [body, setBody] = useState('')
  const [sharedWith, setSharedWith] = useState([])
  // Which note's sharing picker is open right now (a single id, not a
  // Set — only one is ever open at a time, same shape openAddKey below
  // already uses for its own per-note popover) plus a draft selection for
  // it, so toggling checkboxes doesn't write on every click the way
  // handleArchive's own immediate toggle does — sharing is a Save-then-
  // close action, not a one-tap flip, since it's now a real multi-select.
  const [sharingId, setSharingId] = useState(null)
  const [sharingDraft, setSharingDraft] = useState([])
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
  // Which pin's "+ Add subtask" input is open right now — a single id,
  // not a Set, same single-value shape openAddKey already uses above.
  // The text draft doesn't need to be keyed by note id for the same
  // reason: only one can ever be open at a time.
  const [addSubtaskId, setAddSubtaskId] = useState(null)
  const [addSubtaskDraft, setAddSubtaskDraft] = useState('')
  // Which milestone groups have their "Completed · N" section expanded —
  // keyed "noteId:milestone" (or "noteId:_" when there's no milestone), a
  // Set since several can be open across different projects/groups at
  // once, unlike the single-value pickers above. Collapsed by default,
  // same "collapsed until you go looking" reasoning the Archived section
  // below and VaultView.jsx's own folders already use.
  const [openCompletedGroups, setOpenCompletedGroups] = useState(() => new Set())
  // A single most-recent removal, not a stack — undoing anything but the
  // very last removal would be confusing ("undo" should mean "put back
  // what I just took out"). See REMOVE_UNDO_MS above for what this
  // actually promises.
  const [removedItem, setRemovedItem] = useState(null)
  const removeUndoTimer = useRef(null)
  useEffect(() => () => clearTimeout(removeUndoTimer.current), [])
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
      await createCorkNote({ body: trimmed, shared_with: sharedWith, author_id: me.id, roadmap_items: parseRoadmapDraft(roadmapDraft) })
      setBody('')
      setSharedWith([])
      setRoadmapDraft('')
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setPosting(false)
    }
  }

  function toggleComposeShare(memberId) {
    setSharedWith((prev) => (prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]))
  }

  function openSharing(note) {
    setSharingId(note.id)
    setSharingDraft(note.shared_with || [])
  }

  function toggleSharingDraft(memberId) {
    setSharingDraft((prev) => (prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]))
  }

  async function saveSharing(note) {
    try {
      await updateCorkNote(note.id, { shared_with: sharingDraft })
      setSharingId(null)
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
    const ok = await confirm({
      title: 'Delete this pin?',
      message: "It will be permanently removed, along with its comments. This can't be undone.",
      confirmLabel: 'Delete pin',
    })
    if (!ok) return
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
        assignee_ids: [me.id],
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
        assignee_ids: [me.id],
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

  function toggleCompletedGroup(key) {
    setOpenCompletedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // New steps join whatever milestone the last existing step belongs to
  // (or no milestone, for a plain ungrouped roadmap) — "add another step
  // to what I'm currently doing" is the common case; a step meant for a
  // different or new milestone still needs the full Edit textarea.
  // Doesn't close the input on success — "Enter saves and readies
  // another input for quick additions" per the plan doc, so adding
  // several in a row doesn't mean reopening it each time.
  async function handleAddSubtask(note) {
    const trimmed = addSubtaskDraft.trim()
    if (!trimmed) return
    const existing = note.roadmap_items || []
    const lastMilestone = existing.length ? existing[existing.length - 1].milestone : null
    const nextItems = [...existing, { id: crypto.randomUUID(), text: trimmed, taskId: null, milestone: lastMilestone }]
    try {
      await updateCorkNote(note.id, { roadmap_items: nextItems })
      setAddSubtaskDraft('')
      reload()
    } catch (err) {
      setError(err.message)
    }
  }

  // Removal is persisted immediately, same as every other edit here —
  // Undo (below) re-inserts and re-saves rather than holding anything
  // back client-side, so there's no unsaved state a reload could lose.
  async function handleRemoveItem(note, item) {
    clearTimeout(removeUndoTimer.current)
    const nextItems = (note.roadmap_items || []).filter((i) => i.id !== item.id)
    try {
      await updateCorkNote(note.id, { roadmap_items: nextItems })
      setRemovedItem({ noteId: note.id, item })
      removeUndoTimer.current = setTimeout(() => setRemovedItem(null), REMOVE_UNDO_MS)
      reload()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleUndoRemove() {
    const pending = removedItem
    if (!pending) return
    clearTimeout(removeUndoTimer.current)
    setRemovedItem(null)
    const note = notes?.find((n) => n.id === pending.noteId)
    if (!note) return
    try {
      await updateCorkNote(note.id, { roadmap_items: [...(note.roadmap_items || []), pending.item] })
      reload()
    } catch (err) {
      setError(err.message)
    }
  }

  const isProjects = mode === 'projects'
  const modeNotes = notes?.filter((n) => isRoadmapPin(n) === isProjects) ?? []
  const activeNotes = modeNotes.filter((n) => !n.archived)
  const archivedNotes = modeNotes.filter((n) => n.archived)

  return (
    <div className="tab-panel">
      <p className="text-[13px] opacity-80">
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

        {members.length > 1 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] opacity-85">
            <span className="opacity-80">Share with:</span>
            {members
              .filter((m) => m.id !== me?.id)
              .map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={sharedWith.includes(m.id)}
                    onChange={() => toggleComposeShare(m.id)}
                  />
                  {m.display_name}
                </label>
              ))}
          </div>
        )}
        {members.length > 1 && (
          <HelpHint label="Who can see this?">
            {isProjects ? 'A project' : 'A pin'} is private to you until you tick someone above. Only you can edit it;
            the people you share it with can read it and add comments.
          </HelpHint>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="submit"
            className="cursor-pointer rounded-[8px] border-0 bg-accent px-4 py-2 font-semibold text-on-accent disabled:cursor-default disabled:opacity-60"
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
                    by hand. Each group's done items collapse under their
                    own "Completed · N" toggle so a long-running project
                    stays scannable instead of growing a wall of
                    struck-through text. */}
                {!isEditing && note.roadmap_items?.length > 0 && (
                  <div className="mb-2 flex flex-col gap-3">
                    {groupRoadmapItems(note.roadmap_items).map((group, groupIndex) => {
                      const doneItems = group.items.filter((item) => taskById.get(item.taskId)?.status === 'done')
                      const openItems = group.items.filter((item) => taskById.get(item.taskId)?.status !== 'done')
                      const total = group.items.length
                      const pct = total ? Math.round((doneItems.length / total) * 100) : 0
                      const completedKey = `${note.id}:${group.milestone ?? '_'}`
                      const completedOpen = openCompletedGroups.has(completedKey)
                      const rowProps = {
                        note,
                        isOwn,
                        openAddKey,
                        addDateDrafts,
                        setAddDateDrafts,
                        addingItemKey,
                        onOpenAddRow: openAddRow,
                        onAddRoadmapItem: handleAddRoadmapItem,
                        onRemoveItem: handleRemoveItem,
                      }
                      return (
                        <div key={group.milestone ?? `_${groupIndex}`}>
                          {group.milestone && (
                            <>
                              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                                <span className="text-[13px] font-bold text-text-h">{group.milestone}</span>
                                <span className="flex-none text-[11.5px] font-semibold opacity-80">
                                  {doneItems.length} of {total} done
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
                            {openItems.map((item) => (
                              <RoadmapItemRow key={item.id} item={item} done={false} linkedTask={null} {...rowProps} />
                            ))}
                          </ul>
                          {doneItems.length > 0 && (
                            <div className="mt-1.5">
                              <button
                                type="button"
                                onClick={() => toggleCompletedGroup(completedKey)}
                                className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-text opacity-80"
                              >
                                Completed · {doneItems.length}
                                {completedOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                              </button>
                              {completedOpen && (
                                <ul className="m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0">
                                  {doneItems.map((item) => (
                                    <RoadmapItemRow
                                      key={item.id}
                                      item={item}
                                      done
                                      linkedTask={taskById.get(item.taskId)}
                                      {...rowProps}
                                    />
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {!isEditing && isOwn && (
                  <div className="mb-2">
                    {addSubtaskId === note.id ? (
                      <form
                        className="flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleAddSubtask(note)
                        }}
                      >
                        <input
                          autoFocus
                          type="text"
                          value={addSubtaskDraft}
                          onChange={(e) => setAddSubtaskDraft(e.target.value)}
                          placeholder="New step…"
                          maxLength={500}
                          className="min-w-0 flex-1 rounded-[8px] border border-border bg-card-bg px-2.5 py-[7px] text-[13px] text-text-h [font-family:inherit] [font-style:inherit] [font-variant:inherit] [font-weight:inherit] [line-height:inherit]"
                        />
                        <button
                          type="submit"
                          className="flex-none cursor-pointer rounded-[8px] border border-border bg-pill-bg px-3 py-[7px] text-[13px] text-text-h disabled:cursor-default disabled:opacity-60"
                          disabled={!addSubtaskDraft.trim()}
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          className="flex-none cursor-pointer rounded-[8px] border border-border bg-transparent px-3 py-[7px] text-[13px] text-text-h"
                          onClick={() => {
                            setAddSubtaskId(null)
                            setAddSubtaskDraft('')
                          }}
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="flex cursor-pointer items-center gap-1 text-[13px] font-semibold text-accent-text"
                        onClick={() => setAddSubtaskId(note.id)}
                      >
                        <Plus size={14} className="inline align-[-2px]" /> Add subtask
                      </button>
                    )}
                  </div>
                )}

                {removedItem?.noteId === note.id && (
                  <div className="mb-2 flex items-center justify-between gap-2 rounded-[6px] border border-border bg-pill-bg px-2.5 py-1.5 text-xs text-text-h">
                    <span>Removed "{removedItem.item.text}"</span>
                    <button
                      type="button"
                      className="cursor-pointer font-semibold text-accent-text"
                      onClick={handleUndoRemove}
                    >
                      Undo
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs opacity-80">
                  <span>
                    {memberName(note.author_id)} · {formatDate(note.created_at)}
                    {note.archived_task_id && ' · Archived task'}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 whitespace-nowrap ${note.shared_with?.length ? 'border-accent text-accent-text' : 'border-border'}`}>
                    {sharedLabel(note.shared_with, memberName)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        className={`${itemActionClasses} border-accent font-semibold text-accent-text disabled:cursor-default disabled:opacity-60`}
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
                          className={`${itemActionClasses} border-accent font-semibold text-accent-text disabled:cursor-default disabled:opacity-60`}
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
                          className={`${itemActionClasses} border-accent font-semibold text-accent-text disabled:cursor-default disabled:opacity-60`}
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
                          {members.length > 1 && (
                            <div className="relative">
                              <button type="button" className={itemActionClasses} onClick={() => openSharing(note)}>
                                Share
                              </button>
                              {sharingId === note.id && (
                                <>
                                  <div className="fixed inset-0 z-10" onClick={() => setSharingId(null)} />
                                  <div className="absolute left-0 top-full z-20 mt-1 flex flex-col gap-1.5 rounded-md border border-border bg-card-bg p-2.5 shadow-raised">
                                    {members
                                      .filter((m) => m.id !== me?.id)
                                      .map((m) => (
                                        <label
                                          key={m.id}
                                          className="flex cursor-pointer items-center gap-1.5 text-[13px] whitespace-nowrap text-text-h"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={sharingDraft.includes(m.id)}
                                            onChange={() => toggleSharingDraft(m.id)}
                                          />
                                          {m.display_name}
                                        </label>
                                      ))}
                                    <button
                                      type="button"
                                      className={`${itemActionClasses} mt-1 border-accent font-semibold text-accent-text`}
                                      onClick={() => saveSharing(note)}
                                    >
                                      Save
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
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
                  <li key={note.id} className="rounded-md border border-border bg-card-bg px-3.5 py-2.5 opacity-80">
                    <p className="mb-1.5 break-words whitespace-pre-wrap">{note.body}</p>
                    <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs opacity-80">
                      <span>
                        {memberName(note.author_id)} · {formatDate(note.created_at)}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 whitespace-nowrap ${note.shared_with?.length ? 'border-accent text-accent-text' : 'border-border'}`}>
                        {sharedLabel(note.shared_with, memberName)}
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

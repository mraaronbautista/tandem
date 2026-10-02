import { useState } from 'react'
import { Paperclip, Check, ListChecks } from 'lucide-react'
import { sendClarificationAsked, sendClarificationAnswered } from '../lib/manualNotify'
import { uploadCompletionAttachment } from '../lib/attachments'
import AttachmentList from './AttachmentList'
import AssigneePicker from './AssigneePicker'
import { extractSteps } from '../lib/steps'

// Its own component so the answer textarea can keep local draft state
// while typing, same reasoning as ChecklistView's blocked-reason input —
// only the final "Answer" click writes to Supabase, not every keystroke.
// Defaults to notifying whoever the question was originally tagged for
// (item.notifyIds), plus the asker explicitly, minus whoever's replying.
// The explicit askedBy union matters: item.notifyIds is the *asker's own*
// chosen audience, which by construction never includes the asker
// themselves — so when the person replying is the only one who was
// tagged, a plain `item.notifyIds.filter(id => id !== meId)` silently
// drops to empty (or, if more than one person was tagged, ends up
// notifying whoever else was tagged instead of the actual asker) rather
// than falling back to the one person who's actually waiting on a
// reply. Caught via real use, not review — RC's replies to Aaron and
// Aaron's replies to RC were both landing on the wrong recipient (or no
// one) because of this.
function AnswerRow({ item, onChange, taskTitle, taskId, meId, otherMembers }) {
  const [answerDraft, setAnswerDraft] = useState('')
  const [answerAttachments, setAnswerAttachments] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [sending, setSending] = useState(false)
  const [notifyIds, setNotifyIds] = useState(() => {
    const base = new Set([...(item.notifyIds || []), item.askedBy])
    base.delete(meId)
    return [...base]
  })

  async function handleAttachmentUpload(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true)
    setUploadError('')
    try {
      const uploaded = await Promise.all(
        files.map(async (file) => ({ url: await uploadCompletionAttachment(taskId, file), name: file.name })),
      )
      setAnswerAttachments((prev) => [...prev, ...uploaded])
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function handleAnswer() {
    if (!answerDraft.trim() && answerAttachments.length === 0) return
    setSending(true)
    const answer = answerDraft.trim()
    await onChange({ ...item, answer, answerAttachments, answeredAt: new Date().toISOString() })
    try {
      // The Edge Function rejects an empty body — an attachment-only reply
      // still needs some text to notify with, even though the stored
      // `answer` itself is allowed to be blank.
      await sendClarificationAnswered(taskTitle, answer || '📎 Sent an attachment', notifyIds)
    } catch {
      // Best-effort — the answer is already saved regardless of whether
      // the push notification succeeds (e.g. manual-notify not yet
      // redeployed with this notification kind).
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        className="w-full resize-y rounded-[6px] border border-border bg-bg px-2 py-[7px] text-[13px] text-text-h [font-family:inherit] [font-style:inherit] [font-variant:inherit] [font-weight:inherit] [line-height:inherit]"
        rows={2}
        placeholder="Type your reply…"
        value={answerDraft}
        onChange={(e) => setAnswerDraft(e.target.value)}
      />
      <AttachmentList
        attachments={answerAttachments}
        onRemove={(i) => setAnswerAttachments((prev) => prev.filter((_, idx) => idx !== i))}
      />
      {uploadError && <p className="error">{uploadError}</p>}
      {(answerDraft.trim() || answerAttachments.length > 0) && otherMembers.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide opacity-60">Notify</span>
          <AssigneePicker members={otherMembers} value={notifyIds} onChange={setNotifyIds} />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="task-submission-upload mt-0 px-2.5 py-1.5 text-xs" title="Attach files">
          {uploading ? 'Uploading…' : <Paperclip width={15} height={15} />}
          <input type="file" multiple onChange={handleAttachmentUpload} hidden aria-label="Attach files" />
        </label>
        {(answerDraft.trim() || answerAttachments.length > 0) && (
          <button
            type="button"
            className="flex-none cursor-pointer rounded-[6px] border border-accent bg-accent px-3 py-[7px] text-[13px] font-semibold text-white disabled:cursor-default disabled:opacity-60"
            onClick={handleAnswer}
            disabled={sending || uploading}
          >
            {sending ? 'Sending…' : 'Reply'}
          </button>
        )}
      </div>
    </div>
  )
}

// Lightweight thread for clarifying a vague assignment — a question, a
// comment, a suggestion, whatever. Any member can send one on any task
// regardless of who created or is assigned it — but with more than two
// members, "the other person" isn't a single fixed target any more, so
// who gets pinged is now an explicit choice (the "Notify" picker below)
// rather than every other member getting pushed regardless of whether
// the comment actually concerns them. Writes straight to Supabase via
// onChange (the full updated array), same pattern as ChecklistEditor/
// ChecklistView. The push notification is best-effort and never blocks
// saving the message itself.
export default function TaskClarifications({
  clarifications,
  onChange,
  meId,
  memberName,
  members = [],
  assigneeIds = [],
  taskTitle,
  taskId,
  extraActions,
  onAddChecklistItems,
}) {
  const otherMembers = members.filter((m) => m.id !== meId)
  // Defaults to the task's own other assignees — the people it already
  // concerns — falling back to every other member only when there's
  // nobody else assigned to default to (e.g. a solo task), so the
  // picker never defaults to an empty, dead-end selection. Still fully
  // adjustable before sending, same as Cork Board's own share picker.
  const defaultNotifyIds = () => {
    const otherAssignees = assigneeIds.filter((id) => id !== meId)
    return otherAssignees.length > 0 ? otherAssignees : otherMembers.map((m) => m.id)
  }
  const [questionDraft, setQuestionDraft] = useState('')
  const [questionAttachments, setQuestionAttachments] = useState([])
  const [notifyIds, setNotifyIds] = useState(defaultNotifyIds)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [asking, setAsking] = useState(false)

  async function handleAttachmentUpload(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true)
    setUploadError('')
    try {
      const uploaded = await Promise.all(
        files.map(async (file) => ({ url: await uploadCompletionAttachment(taskId, file), name: file.name })),
      )
      setQuestionAttachments((prev) => [...prev, ...uploaded])
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function handleAsk() {
    if (!questionDraft.trim() && questionAttachments.length === 0) return
    setAsking(true)
    const question = questionDraft.trim()
    const entry = {
      id: crypto.randomUUID(),
      askedBy: meId,
      question,
      questionAttachments,
      // Persisted on the entry itself so a later reply (AnswerRow above)
      // can default to notifying the same people this question was
      // originally tagged for, without needing its own separate picker
      // state passed down — see AnswerRow's own notifyIds default.
      notifyIds,
      answer: null,
      answerAttachments: [],
      askedAt: new Date().toISOString(),
      answeredBy: null,
      answeredAt: null,
      resolved: false,
      resolvedBy: null,
      resolvedAt: null,
    }
    await onChange([...clarifications, entry])
    setQuestionDraft('')
    setQuestionAttachments([])
    try {
      await sendClarificationAsked(taskTitle, question || '📎 Sent an attachment', notifyIds)
    } catch {
      // Best-effort, see AnswerRow above.
    } finally {
      setAsking(false)
      setNotifyIds(defaultNotifyIds())
    }
  }

  // Offered only while the draft reads like sequential steps (see
  // lib/steps.js). Moving them onto the task's checklist clears the draft
  // so they are not also sent as a comment; an attachment already queued
  // stays and can still be sent on its own.
  const draftSteps = onAddChecklistItems ? extractSteps(questionDraft) : null

  function handleTurnIntoChecklist() {
    if (!draftSteps) return
    onAddChecklistItems(draftSteps)
    setQuestionDraft('')
  }

  async function handleEntryAnswered(updatedEntry) {
    await onChange(
      clarifications.map((c) =>
        c.id === updatedEntry.id ? { ...updatedEntry, answeredBy: meId } : c,
      ),
    )
  }

  // Not every clarification is actually a question — a plain FYI comment
  // has nothing to answer, and without this it would sit in "needs a
  // reply" forever since `answer` would never get set. No push
  // notification here, unlike asking/answering — dismissing something as
  // not needing a reply isn't news the other person needs pinged about.
  async function handleResolve(item) {
    await onChange(
      clarifications.map((c) =>
        c.id === item.id ? { ...c, resolved: true, resolvedBy: meId, resolvedAt: new Date().toISOString() } : c,
      ),
    )
  }

  return (
    <div className="my-1.5 flex flex-col gap-2">
      {clarifications.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {clarifications.map((item) => (
            <div key={item.id} className="flex flex-col gap-1 rounded-[8px] border border-border bg-pill-bg px-2.5 py-2">
              {item.question && (
                <p className="break-words text-[13px] whitespace-pre-wrap">
                  <strong>{memberName(item.askedBy)}:</strong> {item.question}
                </p>
              )}
              <AttachmentList attachments={item.questionAttachments} />
              {item.answer ? (
                <>
                  <p className="break-words text-[13px] whitespace-pre-wrap">
                    <strong>{memberName(item.answeredBy)}:</strong> {item.answer}
                  </p>
                  <AttachmentList attachments={item.answerAttachments} />
                </>
              ) : item.resolved ? (
                <p className="flex items-center gap-1 text-[13px] opacity-70">
                  <Check size={13} /> {memberName(item.resolvedBy)} marked this finished — no reply needed
                </p>
              ) : item.answerAttachments?.length > 0 ? (
                <AttachmentList attachments={item.answerAttachments} />
              ) : item.askedBy === meId ? (
                <p className="text-[13px] italic opacity-60">Waiting for a reply…</p>
              ) : (
                <>
                  <AnswerRow
                    item={item}
                    onChange={handleEntryAnswered}
                    taskTitle={taskTitle}
                    taskId={taskId}
                    meId={meId}
                    otherMembers={otherMembers}
                  />
                  <input
                    type="checkbox"
                    className="task-done-checkbox self-start"
                    title="Mark as handled — no reply needed"
                    aria-label="Mark as handled — no reply needed"
                    onChange={() => handleResolve(item)}
                  />
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <textarea
          className="w-full resize-y rounded-[6px] border border-border bg-bg px-2 py-[7px] text-[13px] text-text-h [font-family:inherit] [font-style:inherit] [font-variant:inherit] [font-weight:inherit] [line-height:inherit]"
          rows={2}
          placeholder="Ask a question or leave a comment…"
          value={questionDraft}
          onChange={(e) => setQuestionDraft(e.target.value)}
        />
        <AttachmentList
          attachments={questionAttachments}
          onRemove={(i) => setQuestionAttachments((prev) => prev.filter((_, idx) => idx !== i))}
        />
        {uploadError && <p className="error">{uploadError}</p>}
        {draftSteps && (
          <div role="note" className="flex flex-col gap-1.5 rounded-md bg-pill-bg px-2.5 py-2 text-xs leading-snug">
            <span>
              This looks like {draftSteps.length} steps. Add them to this task's checklist so each one can be ticked off?
            </span>
            <button
              type="button"
              className="flex w-fit cursor-pointer items-center gap-1.5 rounded-[6px] border border-border bg-bg px-2.5 py-1.5 text-xs font-semibold text-text-h [font-family:inherit]"
              onClick={handleTurnIntoChecklist}
            >
              <ListChecks size={14} aria-hidden="true" />
              Add as checklist
            </button>
          </div>
        )}
        {/* Same visibility condition as the Send button below — only
            worth showing once there's actually a message to send, so an
            idle compose box stays exactly as uncluttered as before this
            feature. Reuses AssigneePicker (the same toggle-pill multi-
            select TaskForm.jsx already uses for assignees) rather than a
            separate checkbox list. */}
        {(questionDraft.trim() || questionAttachments.length > 0) && otherMembers.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide opacity-60">Notify</span>
            <AssigneePicker members={otherMembers} value={notifyIds} onChange={setNotifyIds} />
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="task-submission-upload mt-0 px-2.5 py-1.5 text-xs" title="Attach files">
              {uploading ? 'Uploading…' : <Paperclip width={15} height={15} />}
              <input type="file" multiple onChange={handleAttachmentUpload} hidden aria-label="Attach files" />
            </label>
            {extraActions}
          </div>
          {/* Only shown once there's actually something to send — an empty
              Send button sitting right next to the task's own Edit/
              Delete/Duplicate row (extraActions, to its left) was an easy
              misclick target when reaching for one of those instead. */}
          {(questionDraft.trim() || questionAttachments.length > 0) && (
            <button type="button" className="flex-none cursor-pointer rounded-[6px] border border-accent bg-accent px-3 py-[7px] text-[13px] font-semibold text-white disabled:cursor-default disabled:opacity-60" onClick={handleAsk} disabled={asking || uploading}>
              {asking ? 'Sending…' : 'Send'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

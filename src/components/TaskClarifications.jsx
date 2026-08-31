import { useState } from 'react'
import { sendClarificationAsked, sendClarificationAnswered } from '../lib/manualNotify'
import { uploadCompletionAttachment } from '../lib/attachments'
import { PaperclipIcon } from './icons'
import AttachmentList from './AttachmentList'

// Its own component so the answer textarea can keep local draft state
// while typing, same reasoning as ChecklistView's blocked-reason input —
// only the final "Answer" click writes to Supabase, not every keystroke.
function AnswerRow({ item, onChange, taskTitle, taskId }) {
  const [answerDraft, setAnswerDraft] = useState('')
  const [answerAttachments, setAnswerAttachments] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [sending, setSending] = useState(false)

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
      await sendClarificationAnswered(taskTitle, answer || '📎 Sent an attachment')
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="task-submission-upload mt-0 px-2.5 py-1.5 text-xs" title="Attach files">
          {uploading ? 'Uploading…' : <PaperclipIcon width={15} height={15} />}
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
// comment, a suggestion, whatever. Either person can send one on any
// task regardless of who created or is assigned it; the other gets
// pinged, and replying pings back. Writes straight to Supabase via
// onChange (the full updated array), same pattern as ChecklistEditor/
// ChecklistView. The push notification is best-effort and never blocks
// saving the message itself.
export default function TaskClarifications({
  clarifications,
  onChange,
  meId,
  memberName,
  taskTitle,
  taskId,
  extraActions,
}) {
  const [questionDraft, setQuestionDraft] = useState('')
  const [questionAttachments, setQuestionAttachments] = useState([])
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
      await sendClarificationAsked(taskTitle, question || '📎 Sent an attachment')
    } catch {
      // Best-effort, see AnswerRow above.
    } finally {
      setAsking(false)
    }
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
                <p className="text-[13px] opacity-70">✓ {memberName(item.resolvedBy)} marked this finished — no reply needed</p>
              ) : item.answerAttachments?.length > 0 ? (
                <AttachmentList attachments={item.answerAttachments} />
              ) : item.askedBy === meId ? (
                <p className="text-[13px] italic opacity-60">Waiting for a reply…</p>
              ) : (
                <>
                  <AnswerRow item={item} onChange={handleEntryAnswered} taskTitle={taskTitle} taskId={taskId} />
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="task-submission-upload mt-0 px-2.5 py-1.5 text-xs" title="Attach files">
              {uploading ? 'Uploading…' : <PaperclipIcon width={15} height={15} />}
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

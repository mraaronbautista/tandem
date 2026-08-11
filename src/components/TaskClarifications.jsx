import { useState } from 'react'
import { sendClarificationAsked, sendClarificationAnswered } from '../lib/manualNotify'
import { uploadCompletionAttachment, isImageAttachment } from '../lib/attachments'
import { PaperclipIcon } from './icons'

// Shared between a not-yet-sent draft (has onRemove, so each attachment
// gets a ✕ to back out of before sending) and an already-sent message
// (no onRemove — plain image/link, same markup TaskRow.jsx's completion
// submission modal already uses for the exact same {url, name} shape, so
// this reuses its .task-submission-* classes rather than duplicating them).
function AttachmentList({ attachments, onRemove }) {
  if (!attachments?.length) return null
  return (
    <div className="task-submission-attachments">
      {attachments.map((a, i) =>
        isImageAttachment(a.name) ? (
          <div className="task-submission-attachment task-submission-attachment-image" key={i}>
            <img src={a.url} alt={a.name || 'Attachment'} />
            {onRemove && (
              <button type="button" className="task-submission-remove" onClick={() => onRemove(i)} title="Remove">
                ✕
              </button>
            )}
          </div>
        ) : onRemove ? (
          <div className="task-submission-attachment task-submission-file-link" key={i}>
            <a href={a.url} target="_blank" rel="noreferrer" className="task-submission-file-open">
              <span className="task-submission-file-icon">📎</span>
              <span className="task-submission-file-name">{a.name || 'View attachment'}</span>
            </a>
            <button type="button" className="task-submission-remove" onClick={() => onRemove(i)} title="Remove">
              ✕
            </button>
          </div>
        ) : (
          <a
            className="task-submission-attachment task-submission-file-link"
            href={a.url}
            target="_blank"
            rel="noreferrer"
            key={i}
          >
            <span className="task-submission-file-icon">📎</span>
            <span className="task-submission-file-name">{a.name || 'View attachment'}</span>
          </a>
        ),
      )}
    </div>
  )
}

// Its own component so the answer textarea can keep local draft state
// while typing, same reasoning as ChecklistView's blocked-reason input —
// only the final "Answer" click writes to Supabase, not every keystroke.
function AnswerRow({ item, onChange, taskTitle, taskId }) {
  const [answerDraft, setAnswerDraft] = useState('')
  const [answerAttachments, setAnswerAttachments] = useState([])
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)

  async function handleAttachmentUpload(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true)
    try {
      const uploaded = await Promise.all(
        files.map(async (file) => ({ url: await uploadCompletionAttachment(taskId, file), name: file.name })),
      )
      setAnswerAttachments((prev) => [...prev, ...uploaded])
    } catch (err) {
      alert(err.message)
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
    <div className="clarification-answer-row">
      <textarea
        rows={2}
        placeholder="Type your reply…"
        value={answerDraft}
        onChange={(e) => setAnswerDraft(e.target.value)}
      />
      <AttachmentList
        attachments={answerAttachments}
        onRemove={(i) => setAnswerAttachments((prev) => prev.filter((_, idx) => idx !== i))}
      />
      <div className="clarification-compose-actions">
        <label className="task-submission-upload" title="Attach files">
          {uploading ? 'Uploading…' : <PaperclipIcon width={15} height={15} />}
          <input type="file" multiple onChange={handleAttachmentUpload} hidden />
        </label>
        <button
          type="button"
          className="clarification-answer-button"
          onClick={handleAnswer}
          disabled={sending || uploading}
        >
          {sending ? 'Sending…' : 'Reply'}
        </button>
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
export default function TaskClarifications({ clarifications, onChange, meId, memberName, taskTitle, taskId }) {
  const [questionDraft, setQuestionDraft] = useState('')
  const [questionAttachments, setQuestionAttachments] = useState([])
  const [uploading, setUploading] = useState(false)
  const [asking, setAsking] = useState(false)

  async function handleAttachmentUpload(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true)
    try {
      const uploaded = await Promise.all(
        files.map(async (file) => ({ url: await uploadCompletionAttachment(taskId, file), name: file.name })),
      )
      setQuestionAttachments((prev) => [...prev, ...uploaded])
    } catch (err) {
      alert(err.message)
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

  return (
    <div className="clarifications">
      {clarifications.length > 0 && (
        <div className="clarifications-thread">
          {clarifications.map((item) => (
            <div key={item.id} className="clarification-item">
              {item.question && (
                <p className="clarification-question">
                  <strong>{memberName(item.askedBy)}:</strong> {item.question}
                </p>
              )}
              <AttachmentList attachments={item.questionAttachments} />
              {item.answer ? (
                <>
                  <p className="clarification-answer">
                    <strong>{memberName(item.answeredBy)}:</strong> {item.answer}
                  </p>
                  <AttachmentList attachments={item.answerAttachments} />
                </>
              ) : item.answerAttachments?.length > 0 ? (
                <AttachmentList attachments={item.answerAttachments} />
              ) : item.askedBy === meId ? (
                <p className="clarification-waiting">Waiting for a reply…</p>
              ) : (
                <AnswerRow item={item} onChange={handleEntryAnswered} taskTitle={taskTitle} taskId={taskId} />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="clarification-ask-row">
        <textarea
          rows={2}
          placeholder="Ask a question or leave a comment…"
          value={questionDraft}
          onChange={(e) => setQuestionDraft(e.target.value)}
        />
        <AttachmentList
          attachments={questionAttachments}
          onRemove={(i) => setQuestionAttachments((prev) => prev.filter((_, idx) => idx !== i))}
        />
        <div className="clarification-compose-actions">
          <label className="task-submission-upload" title="Attach files">
            {uploading ? 'Uploading…' : <PaperclipIcon width={15} height={15} />}
            <input type="file" multiple onChange={handleAttachmentUpload} hidden />
          </label>
          <button type="button" className="clarification-ask-button" onClick={handleAsk} disabled={asking || uploading}>
            {asking ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

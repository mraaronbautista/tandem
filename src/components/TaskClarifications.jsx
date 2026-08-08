import { useState } from 'react'
import { sendClarificationAsked, sendClarificationAnswered } from '../lib/manualNotify'

// Its own component so the answer textarea can keep local draft state
// while typing, same reasoning as ChecklistView's blocked-reason input —
// only the final "Answer" click writes to Supabase, not every keystroke.
function AnswerRow({ item, onChange, taskTitle }) {
  const [answerDraft, setAnswerDraft] = useState('')
  const [sending, setSending] = useState(false)

  async function handleAnswer() {
    if (!answerDraft.trim()) return
    setSending(true)
    const answer = answerDraft.trim()
    await onChange({ ...item, answer, answeredAt: new Date().toISOString() })
    try {
      await sendClarificationAnswered(taskTitle, answer)
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
        placeholder="Type your answer…"
        value={answerDraft}
        onChange={(e) => setAnswerDraft(e.target.value)}
      />
      <button type="button" className="clarification-answer-button" onClick={handleAnswer} disabled={sending}>
        {sending ? 'Sending…' : 'Answer'}
      </button>
    </div>
  )
}

// Lightweight Q&A thread for clarifying a vague assignment — either
// person can ask, the other gets pinged; answering pings back. Writes
// straight to Supabase via onChange (the full updated array), same
// pattern as ChecklistEditor/ChecklistView. The push notification is
// best-effort and never blocks saving the question/answer itself.
export default function TaskClarifications({ clarifications, onChange, meId, memberName, taskTitle }) {
  const [questionDraft, setQuestionDraft] = useState('')
  const [asking, setAsking] = useState(false)

  async function handleAsk() {
    if (!questionDraft.trim()) return
    setAsking(true)
    const question = questionDraft.trim()
    const entry = {
      id: crypto.randomUUID(),
      askedBy: meId,
      question,
      answer: null,
      askedAt: new Date().toISOString(),
      answeredBy: null,
      answeredAt: null,
    }
    await onChange([...clarifications, entry])
    setQuestionDraft('')
    try {
      await sendClarificationAsked(taskTitle, question)
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
              <p className="clarification-question">
                <strong>{memberName(item.askedBy)}:</strong> {item.question}
              </p>
              {item.answer ? (
                <p className="clarification-answer">
                  <strong>{memberName(item.answeredBy)}:</strong> {item.answer}
                </p>
              ) : item.askedBy === meId ? (
                <p className="clarification-waiting">Waiting for an answer…</p>
              ) : (
                <AnswerRow item={item} onChange={handleEntryAnswered} taskTitle={taskTitle} />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="clarification-ask-row">
        <textarea
          rows={2}
          placeholder="Ask a question about this task…"
          value={questionDraft}
          onChange={(e) => setQuestionDraft(e.target.value)}
        />
        <button type="button" className="clarification-ask-button" onClick={handleAsk} disabled={asking}>
          {asking ? 'Sending…' : 'Ask'}
        </button>
      </div>
    </div>
  )
}

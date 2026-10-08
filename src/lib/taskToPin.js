// Builds the comment thread a pin starts with when a task is sent to the
// board (archiveTaskToBoard in corkNotes.js). The pin's own text stays just
// the task's title; everything else the task carried is copied in as
// comments so nothing is lost on the board. The original task is never
// touched beyond its archived flag, so "Restore to Today" brings every field
// back exactly as it was.
//
// Pure (no Supabase import) so it can be checked on its own.

function attachmentLines(attachments) {
  return (attachments || [])
    .filter((a) => a && a.name)
    .map((a) => `Attachment: ${a.name} (still on the original task)`)
}

function checklistLine(item) {
  const text = (item.text || '').trim()
  if (!text) return ''
  if (item.blocked) return `✕ ${text}${item.blockedReason ? ` — ${item.blockedReason}` : ''}`
  return `${item.done ? '☑' : '☐'} ${text}`
}

// One comment holding the task's own details: notes, where it came from,
// checklist and completion details. Null when the task had none of those.
function detailsBody(task) {
  const parts = []
  const notes = (task.notes || '').trim()
  if (notes) parts.push(`Notes:\n${notes}`)
  const source = [task.source, task.source_note].map((v) => (v || '').trim()).filter(Boolean).join(' — ')
  if (source) parts.push(`Where it came from: ${source}`)
  const checklist = (task.checklist || []).map(checklistLine).filter(Boolean)
  if (checklist.length) parts.push(`Checklist:\n${checklist.join('\n')}`)
  const completion = [
    (task.completion_note || '').trim(),
    ...attachmentLines(task.completion_attachments),
  ].filter(Boolean)
  if (completion.length) parts.push(`Completion details:\n${completion.join('\n')}`)
  if (!parts.length) return null
  return `Details from the task when it was sent to the board:\n\n${parts.join('\n\n')}`
}

export function taskCommentsForPin(task, authorId, now = new Date()) {
  const comments = []
  const summary = detailsBody(task)
  if (summary) {
    comments.push({ id: crypto.randomUUID(), authorId, body: summary, createdAt: now.toISOString() })
  }
  // Each question and each reply becomes its own comment, in the order the
  // thread happened, with its original author and time. A comment that was
  // dismissed with "No reply needed" has no reply to copy.
  for (const entry of task.clarifications || []) {
    const question = [(entry.question || '').trim(), ...attachmentLines(entry.questionAttachments)].filter(Boolean).join('\n')
    if (question) {
      comments.push({
        id: crypto.randomUUID(),
        authorId: entry.askedBy || authorId,
        body: question,
        createdAt: entry.askedAt || now.toISOString(),
      })
    }
    const reply = [(entry.answer || '').trim(), ...attachmentLines(entry.answerAttachments)].filter(Boolean).join('\n')
    if (reply) {
      comments.push({
        id: crypto.randomUUID(),
        authorId: entry.answeredBy || authorId,
        body: reply,
        createdAt: entry.answeredAt || entry.askedAt || now.toISOString(),
      })
    }
  }
  return comments
}

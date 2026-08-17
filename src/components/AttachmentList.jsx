import { isImageAttachment } from '../lib/attachments'

// Shared between a not-yet-sent draft (has onRemove, so each attachment
// gets a ✕ to back out of before sending) and an already-sent/saved one
// (no onRemove — plain image/link). Reused wherever a {url, name}
// attachment array shows up: task completion submissions, task comments
// (TaskClarifications.jsx), and eod_reports (EodReportsList.jsx/
// EndOfDayReportForm.jsx) — all the same shape, so one component instead
// of four copies of this markup.
export default function AttachmentList({ attachments, onRemove }) {
  if (!attachments?.length) return null
  return (
    <div className="task-submission-attachments">
      {attachments.map((a, i) =>
        isImageAttachment(a.name) ? (
          <div className="task-submission-attachment task-submission-attachment-image" key={i}>
            <img src={a.url} alt={a.name || 'Attachment'} />
            {onRemove && (
              <button
                type="button"
                className="task-submission-remove"
                onClick={() => onRemove(i)}
                title="Remove"
                aria-label="Remove attachment"
              >
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
            <button
              type="button"
              className="task-submission-remove"
              onClick={() => onRemove(i)}
              title="Remove"
              aria-label="Remove attachment"
            >
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

import { Paperclip, X } from 'lucide-react'
import { isImageAttachment } from '../lib/attachments'

// Shared between a not-yet-sent draft (has onRemove, so each attachment
// gets a ✕ to back out of before sending) and an already-sent/saved one
// (no onRemove — plain image/link). Reused wherever a {url, name}
// attachment array shows up: task completion submissions, task comments
// (TaskClarifications.jsx), and eod_reports (EodReportsList.jsx/
// EndOfDayReportForm.jsx) — all the same shape, so one component instead
// of four copies of this markup.
//
// Files (a compact pill each) get their own row above images (a capped-
// size thumbnail each), both wrapping side by side rather than one long
// vertical stack — a report with several screenshots used to render each
// one at up to 280px tall and full container width, one per line, which
// could turn a handful of attachments into a very long scroll for not
// much more information than a smaller thumbnail already conveys.
export default function AttachmentList({ attachments, onRemove }) {
  if (!attachments?.length) return null

  // Carries each attachment's original index through the split so
  // onRemove(i) still targets the right item in the *source* array —
  // the two rendered groups are a display-only partition, not a new
  // array order that persists anywhere.
  const indexed = attachments.map((a, i) => ({ ...a, _i: i }))
  const files = indexed.filter((a) => !isImageAttachment(a.name))
  const images = indexed.filter((a) => isImageAttachment(a.name))

  function removeButton(i) {
    return (
      <button
        type="button"
        className="task-submission-remove"
        onClick={() => onRemove(i)}
        title="Remove"
        aria-label="Remove attachment"
      >
        <X size={12} />
      </button>
    )
  }

  return (
    <div className="task-submission-attachments">
      {files.length > 0 && (
        <div className="task-submission-files-row">
          {files.map((a) =>
            onRemove ? (
              <div className="task-submission-attachment task-submission-file-link" key={a._i}>
                <a href={a.url} target="_blank" rel="noreferrer" className="task-submission-file-open">
                  <span className="task-submission-file-icon">
                  <Paperclip size={13} />
                </span>
                  <span className="task-submission-file-name">{a.name || 'View attachment'}</span>
                </a>
                {removeButton(a._i)}
              </div>
            ) : (
              <a
                className="task-submission-attachment task-submission-file-link"
                href={a.url}
                target="_blank"
                rel="noreferrer"
                key={a._i}
              >
                <span className="task-submission-file-icon">
                  <Paperclip size={13} />
                </span>
                <span className="task-submission-file-name">{a.name || 'View attachment'}</span>
              </a>
            ),
          )}
        </div>
      )}

      {images.length > 0 && (
        <div className="task-submission-images-row">
          {images.map((a) => (
            <div className="task-submission-attachment task-submission-attachment-image" key={a._i}>
              <img src={a.url} alt={a.name || 'Attachment'} />
              {onRemove && removeButton(a._i)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Decides whether a drafted comment reads like a list of steps — the cue
// for TaskClarifications to offer turning it into real checklist items.
// UI/UX overhaul Phase 2: a real task's comment thread was being used as a
// step-by-step instruction log ("login -> tickets -> click the only ticket
// -> reopen ticket ...") because nothing in the comment box pointed at the
// checklist, which is the tool built for exactly that.
//
// Deliberately conservative and only ever an *offer*, never an automatic
// conversion: a false positive costs one ignored suggestion, a false
// negative just means the prompt doesn't appear. Returns the cleaned step
// strings, or null when the text doesn't look like steps.
const LIST_MARKER = /^\s*(?:\d+\s*[.)]|[-*•])\s+/
const ARROW = /\s*(?:->|→|=>)\s*/

export function extractSteps(text) {
  const raw = (text || '').trim()
  if (!raw) return null

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

  // Several lines is the plain case: one step per line, with any leading
  // "1." / "-" / "•" marker stripped, since the checklist item has its own
  // box. Two lines only count when both are explicitly marked as a list,
  // so an ordinary two-line comment doesn't trigger it.
  const markedLines = lines.filter((line) => LIST_MARKER.test(line)).length
  if (lines.length >= 3 || (lines.length === 2 && markedLines === 2)) {
    return lines.map((line) => line.replace(LIST_MARKER, '').trim()).filter(Boolean)
  }

  // A single line chained with arrows reads as a path through steps.
  if (lines.length === 1) {
    const parts = lines[0].split(ARROW).map((part) => part.trim()).filter(Boolean)
    if (parts.length >= 3) return parts
  }

  return null
}

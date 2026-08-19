export const PRIORITY_COLOR = { low: '#4a90d2', med: '#e0a83e', high: '#e0524d' }
export const PRIORITY_LABEL = { low: 'Low priority', med: 'Medium priority', high: 'High priority' }
// Terser labels for TaskForm.jsx's Priority <select> — its own "Priority"
// field label already supplies the word "priority", so PRIORITY_LABEL's
// full "Medium priority" would read redundant there. Kept as its own map
// (not derived from PRIORITY_LABEL by string-stripping) so both stay
// plain, readable data rather than one being a fragile transform of the
// other — but colocated here as the same single source of truth for
// which three priority values exist.
export const PRIORITY_SHORT_LABEL = { low: 'Low', med: 'Med', high: 'High' }

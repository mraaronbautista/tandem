export const PRIORITY_COLOR = { low: '#4a90d2', med: '#e0a83e', high: '#e0524d' }
// A priority dot that does not rely on colour alone (WCAG 1.4.1) — a
// colour-blind person cannot tell the red, amber and blue apart, so the
// three also differ in form: low is a hollow ring, medium a solid dot, high
// a solid dot with a halo.
export function priorityDotStyle(priority) {
  const color = PRIORITY_COLOR[priority]
  if (priority === 'low') return { background: 'transparent', border: `2px solid ${color}` }
  if (priority === 'high') return { background: color, boxShadow: `0 0 0 2px color-mix(in srgb, ${color} 35%, transparent)` }
  return { background: color }
}
export const PRIORITY_LABEL = { low: 'Low priority', med: 'Medium priority', high: 'High priority' }
// Terser labels for TaskForm.jsx's Priority <select> — its own "Priority"
// field label already supplies the word "priority", so PRIORITY_LABEL's
// full "Medium priority" would read redundant there. Kept as its own map
// (not derived from PRIORITY_LABEL by string-stripping) so both stay
// plain, readable data rather than one being a fragile transform of the
// other — but colocated here as the same single source of truth for
// which three priority values exist.
export const PRIORITY_SHORT_LABEL = { low: 'Low', med: 'Med', high: 'High' }

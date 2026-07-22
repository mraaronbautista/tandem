// The `who` field is a fixed two-value enum tied to Ada (principal) and
// Aaron (assistant) — this app will only ever have these two people, so the
// mapping is a constant rather than something derived per-viewer.
export const WHO_LABEL = {
  yours: 'Ada',
  assistant: 'Aaron',
}

// A distinct color per person, separate from the priority-dot color scale —
// since "Ada" and "Aaron" both start with A, color alone isn't reliable at a
// glance, but paired with the name it makes scanning a mixed "All" list fast.
export const WHO_COLOR = {
  yours: '#a8567e',
  assistant: '#4a7ba6',
}

// Reverse lookup: given a display name (e.g. the logged-in member's own
// name), find which `who` enum value belongs to them.
export function whoKeyForName(name) {
  return Object.keys(WHO_LABEL).find((key) => WHO_LABEL[key] === name)
}

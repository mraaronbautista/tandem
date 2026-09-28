// The `who` field is a fixed three-value enum — 'yours'/'assistant' tied
// to Ada/Aaron, plus 'both' for a task that's genuinely one shared thing
// (e.g. a joint interview session) rather than one person's own item —
// this app will only ever have these two people, so the mapping is a
// constant rather than something derived per-viewer. 'both' isn't a real
// display name of either member, so whoKeyForName() below (a reverse
// lookup by display name) never resolves to it — nothing needs it to,
// since a *new* task always defaults to whichever person's context it
// was created from, never 'both' automatically; picking Both is always
// an explicit choice.
export const WHO_LABEL = {
  yours: 'Ada',
  assistant: 'Aaron',
  both: 'Both',
}

// A distinct color per person, separate from the priority-dot color scale —
// since "Ada" and "Aaron" both start with A, color alone isn't reliable at a
// glance, but paired with the name it makes scanning a mixed "All" list fast.
// 'both' gets a third color roughly between the other two (not a literal
// blend, just visually reads as "shared" rather than looking like either
// person's own color got reused) — white badge text (`.task-who-badge` in
// App.css) needs enough contrast against it, same as the other two.
export const WHO_COLOR = {
  yours: '#a8567e',
  assistant: '#4a7ba6',
  both: '#7d6ab8',
}

// The order a "switch who this is for" control cycles through — used by
// PriorityItemsEditor.jsx's badge toggle, which used to be a plain
// yours<->assistant flip before 'both' existed.
export const WHO_CYCLE = ['yours', 'assistant', 'both']

export function nextWho(current) {
  const i = WHO_CYCLE.indexOf(current)
  return WHO_CYCLE[(i + 1) % WHO_CYCLE.length]
}

// Reverse lookup: given a display name (e.g. the logged-in member's own
// name), find which `who` enum value belongs to them. Only ever matches
// 'yours'/'assistant' — see the WHO_LABEL comment above for why 'both'
// deliberately has no name to reverse-lookup from.
export function whoKeyForName(name) {
  return Object.keys(WHO_LABEL).find((key) => WHO_LABEL[key] === name)
}

// True when a task assigned `taskWho` should count as belonging to
// whoever a yours/assistant-scoped filter tab is showing (`filterWho` —
// always 'yours' or 'assistant'; there's no "show only Both" tab
// anywhere) — a 'both' task belongs to everyone, so it always matches
// regardless of which single person's tab is active. Used by
// TaskBoard.jsx's who-tab (`whoFiltered`) and BulkAddTasksForm.jsx's Edit
// tab's per-person filter, so a shared task like a joint interview shows
// up under either person's own tab, not just "All".
export function whoMatchesFilter(taskWho, filterWho) {
  return taskWho === filterWho || taskWho === 'both'
}

// True when two tasks' `who` values share at least one real person —
// either literally the same value, or either side is 'both' (a shared
// task occupies both people's time, so it can genuinely conflict with
// either person's own tasks, not just with another 'both' one). Used by
// overlap detection — getOverlappingTaskIds in tasks.js, and
// DayTimeline.jsx's matching same-shape stack-conflict check.
export function whoSharesPerson(a, b) {
  return a === b || a === 'both' || b === 'both'
}

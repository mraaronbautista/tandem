import { addDaysStr } from './unitTimeline'

// The automatic "Schedule turnover cleaning for {unit}" task (one per
// confirmed booking) is linked to its booking through this column.
export function isTurnoverTask(task) {
  return !!task?.rental_turnover_booking_id
}

// The step the database seeds on that task. Scheduling the cleaning visit is
// exactly what this step asks for, so the shortcut ticks it. Matched on the
// seeded wording; a step someone has rewritten is left alone.
const SEEDED_STEP = /^add a task for when the cleaner/i

export function tickCleanerStep(checklist) {
  const list = checklist || []
  const index = list.findIndex((item) => SEEDED_STEP.test((item.text || '').trim()))
  if (index === -1 || list[index].done) return null // nothing to change
  return list.map((item, i) => (i === index ? { ...item, done: true, blocked: false, blockedReason: '' } : item))
}

// Cleaning is usually the day after the move-out; if that day has already
// passed (a late reminder), start from today instead.
export function cleaningPreset(checkOut, today) {
  const dayAfter = addDaysStr(checkOut, 1)
  return { kind: 'Cleaning', visit_date: dayAfter < today ? today : dayAfter }
}

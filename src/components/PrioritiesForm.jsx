import { useEffect, useState } from 'react'
import { createPriorities, fetchLatestPriorities, fetchLatestPrioritiesForTeam } from '../lib/priorities'
import { createTask } from '../lib/tasks'
import { detectDefaultTimezone, zonedTimeToUtcIso } from '../lib/timezone'
import Modal from './Modal'
import PriorityItemsEditor from './PriorityItemsEditor'
import { PeriodTabs, PeriodTab } from './PeriodTabs'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'
import { friendlyError } from '../lib/friendlyError'

const PERIODS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

function formatDate(iso) {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// 'YYYY-MM-DD' for today in the browser's own local timezone — matches
// what zonedTimeToUtcIso expects as its date argument.
function todayDateString() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Any member can set their own priorities for the upcoming day/week/
// month, and each one becomes a real task on save (not just a line of
// text that's easy to forget about). Genuinely per-person now, not one
// shared note — "Last set" below always shows your own most recent save
// for the period, read-only reference only, never pre-filled into the
// editable list — otherwise reopening this and hitting Save would
// recreate a task for every old item, not just anything new. A second
// read-only section below it shows any teammates' priorities you've
// been granted access to (see priorities_access in schema.sql) — the
// admin-side "Priorities visibility" grant would be pointless without
// somewhere to actually use it.
export default function PrioritiesForm({ me, members = [], onClose, embedded = false, header = null }) {
  const [period, setPeriod] = useState('day')
  const [latest, setLatest] = useState(null)
  // Every accessible person's latest row per (set_by, period) — your own
  // plus anyone you've been granted priorities_access to, read-only.
  // RLS already does the real access filtering (see fetchLatestPriorities
  // ForTeam's own comment); granting access with nowhere to actually view
  // it would make the admin-side "Priorities visibility" control
  // pointless, so this is the other half of that feature, not optional.
  const [teamLatest, setTeamLatest] = useState({})
  // Keyed per period so switching the Day/Week/Month tab never discards
  // what you'd already typed under a different one — each tab keeps its
  // own draft until you actually save.
  const [itemsByPeriod, setItemsByPeriod] = useState({ day: [], week: [], month: [] })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const items = itemsByPeriod[period]
  function setItems(next) {
    setItemsByPeriod((prev) => ({ ...prev, [period]: next }))
  }

  const defaultAssigneeIds = [me.id]

  useEffect(() => {
    fetchLatestPriorities(me.id)
      .then(setLatest)
      .catch((err) => setError(friendlyError(err)))
    fetchLatestPrioritiesForTeam()
      .then(setTeamLatest)
      .catch((err) => setError(friendlyError(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    const validItems = items.filter((i) => i.text.trim())
    if (!validItems.length) return
    setSaving(true)
    setError('')
    try {
      const body = validItems.map((i) => i.text.trim()).join('\n')
      const saved = await createPriorities(me.id, period, body)
      setLatest((prev) => ({ ...prev, [period]: saved }))

      // Day priorities land on today (so an unfinished one can go
      // overdue, same as any other daily task); week/month priorities
      // become All Day tasks — no specific date, they just stick around
      // until done. Zoned to whoever's actually saving this, not always
      // Eastern — that mismatch used to push "today 23:59" into tomorrow
      // morning for Aaron (Philippines, ~12-13h ahead of Eastern).
      const zone = detectDefaultTimezone()
      const dueDate = period === 'day' ? zonedTimeToUtcIso(todayDateString(), '23:59', zone) : null
      await Promise.all(
        validItems.map((item) =>
          createTask({
            title: item.text.trim(),
            assignee_ids: item.assigneeIds,
            due_date: dueDate,
            due_timezone: zone,
            created_by: me.id,
          }),
        ),
      )
      onClose()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSaving(false)
    }
  }

  const current = latest?.[period]
  const lastLines = current?.body ? current.body.split('\n').filter((line) => line.trim()) : []

  // Only teammates teamLatest actually has an entry for at this period —
  // RLS already dropped anyone you don't have priorities_access to, so
  // there's nothing to distinguish "no access" from "hasn't set any" and
  // no need to: either way, there's nothing to show for them right now.
  const teammateEntries = members
    .filter((m) => m.id !== me.id)
    .map((m) => ({ member: m, row: teamLatest[`${m.id}:${period}`] }))
    .filter((entry) => entry.row)

  const content = (
      <ModalCard as="form" onSubmit={handleSubmit}>
        {header}
        <h2>Priorities</h2>

        <PeriodTabs>
          {PERIODS.map((p) => (
            <PeriodTab key={p.value} active={period === p.value} onClick={() => setPeriod(p.value)}>
              {p.label}
            </PeriodTab>
          ))}
        </PeriodTabs>

        {error && <p className="error">{error}</p>}

        {current && (
          <div>
            <p className="mb-1 text-xs opacity-80">
              You last set this — {formatDate(current.created_at)}
            </p>
            {lastLines.length > 0 && (
              <ul className="m-0 mb-1 flex flex-col gap-0.5 pl-5 text-[13px] opacity-80">
                {lastLines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {teammateEntries.length > 0 && (
          <div className="submission-field">
            <span className="submission-field-label">Teammates' priorities this {period}</span>
            <div className="flex flex-col gap-2">
              {teammateEntries.map(({ member, row }) => {
                const lines = row.body.split('\n').filter((line) => line.trim())
                return (
                  <div key={member.id}>
                    <p className="mb-1 text-xs opacity-80">
                      <strong>{member.display_name}</strong> — {formatDate(row.created_at)}
                    </p>
                    {lines.length > 0 && (
                      <ul className="m-0 mb-1 flex flex-col gap-0.5 pl-5 text-[13px] opacity-80">
                        {lines.map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <span className="submission-field-label">What are we prioritizing this {period}?</span>
        <PriorityItemsEditor items={items} onChange={setItems} members={members} defaultAssigneeIds={defaultAssigneeIds} />

        <SubmissionActions>
          <SubmissionButton onClick={onClose}>Cancel</SubmissionButton>
          <SubmissionButton type="submit" variant="primary" disabled={saving || !items.some((i) => i.text.trim())}>
            {saving ? 'Saving…' : 'Save & create tasks'}
          </SubmissionButton>
        </SubmissionActions>
      </ModalCard>
  )

  return embedded ? content : <Modal onClose={onClose}>{content}</Modal>
}

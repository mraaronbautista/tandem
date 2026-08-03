import { useState } from 'react'
import { updateWorkingStatus } from '../lib/members'

function formatSince(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// Aaron gets an actual toggle for his own status; Ada gets a read-only
// badge reflecting it — never the other way around, since "I'm working"
// is inherently about yourself, not something to set on someone else's
// behalf. Nothing renders on Ada's side when Aaron isn't working, rather
// than showing a persistent "not working" badge that'd just be noise.
export default function WorkingStatusToggle({ me, members, onChange }) {
  const [busy, setBusy] = useState(false)

  if (!me) return null

  if (me.display_name === 'Aaron') {
    const isWorking = Boolean(me.working_since)

    async function handleClick() {
      setBusy(true)
      try {
        await updateWorkingStatus(me.id, !isWorking)
        await onChange?.()
      } finally {
        setBusy(false)
      }
    }

    return (
      <button
        className={`working-toggle${isWorking ? ' working-toggle-on' : ''}`}
        onClick={handleClick}
        disabled={busy}
        title={isWorking ? 'Stop working' : 'Start working'}
      >
        {isWorking ? `🟢 Working since ${formatSince(me.working_since)}` : '⚪ Not working'}
      </button>
    )
  }

  const aaron = members.find((m) => m.display_name === 'Aaron')
  if (!aaron?.working_since) return null

  return (
    <span className="working-badge" title={`Working since ${formatSince(aaron.working_since)}`}>
      🟢 Aaron is working
    </span>
  )
}

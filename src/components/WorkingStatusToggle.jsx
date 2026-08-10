import { useState } from 'react'
import { updateWorkingStatus } from '../lib/members'

function formatSince(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// Aaron gets an actual toggle for his own status; Ada gets a read-only
// badge reflecting it — never the other way around, since "I'm working"
// is inherently about yourself, not something to set on someone else's
// behalf. Always visible on Ada's side now, online or offline — it lives
// in the shared header (.header-actions), so it's already on every tab
// without any extra work here.
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
        title={isWorking ? `Online since ${formatSince(me.working_since)} — tap to go offline` : 'Go online'}
      >
        {isWorking ? '🟢 Online' : '⚪ Offline'}
      </button>
    )
  }

  const aaron = members.find((m) => m.display_name === 'Aaron')
  const aaronOnline = Boolean(aaron?.working_since)

  return (
    <span
      className={`working-badge${aaronOnline ? ' working-badge-online' : ''}`}
      title={aaronOnline ? `Online since ${formatSince(aaron.working_since)}` : 'Offline'}
    >
      {aaronOnline ? '🟢 Aaron is online' : '⚪ Aaron is offline'}
    </span>
  )
}

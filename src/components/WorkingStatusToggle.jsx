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
//
// .working-toggle/-on and .working-badge/-online (App.css) had exactly
// one consumer — this component. Both migrated branches share the same
// simplification as ThemeToggle.jsx: the original set two different
// transition durations across three properties (transform 120ms;
// border-color/color 180ms) — collapsed to one uniform 120ms transition
// (transition-all), since Tailwind can't combine two transition-*
// utilities' differing durations on one element. Visually inconsequential
// on a rarely-toggled status control.
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
        className={`cursor-pointer whitespace-nowrap rounded-full border bg-card-bg px-3 py-1.5 text-[13px] transition-all duration-[120ms] ease-tactile active:scale-[0.96] ${
          isWorking ? 'border-[var(--color-online)] text-[var(--color-online)]' : 'border-border text-text-h'
        }`}
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

  // The dot color alone already carries online/offline — "Aaron is
  // online"/"Aaron is offline" was saying the same thing twice. The
  // title tooltip still spells it out for anyone who can't tell green
  // from gray at a glance.
  return (
    <span
      className={`whitespace-nowrap text-[13px] ${
        aaronOnline ? 'text-[var(--color-online)] opacity-100' : 'text-text opacity-60'
      }`}
      title={aaronOnline ? `Online since ${formatSince(aaron.working_since)}` : 'Offline'}
    >
      {aaronOnline ? '🟢 Aaron' : '⚪ Aaron'}
    </span>
  )
}

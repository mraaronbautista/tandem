import { Circle } from 'lucide-react'
import { updateWorkingStatus } from '../lib/members'

// fill="currentColor" + strokeWidth={0}: a solid dot that just inherits
// whichever text-color class the caller already applies (green when
// online, muted otherwise) — no separate color prop to keep in sync.
function StatusDot() {
  return <Circle size={8} fill="currentColor" strokeWidth={0} className="inline align-[1px]" />
}

function formatSince(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// Every member gets their own toggle for their own status now — "I'm
// working" is inherently about yourself, not something to set on
// someone else's behalf, but that no longer means only one hardcoded
// person gets a real control. Everyone else's status collapses into one
// dynamic-text summary pill next to it (deliberately not N separate
// mini-badges) — avoids the header running out of room as the team
// grows, and looks visually identical to the original two-person layout
// when there are only 2 members total. Always visible, online or
// offline — it lives in the shared header (.header-actions), so it's
// already on every tab without any extra work here.
export default function WorkingStatusToggle({ me, members, onChange }) {
  if (!me) return null

  const isWorking = Boolean(me.working_since)

  async function handleClick() {
    await updateWorkingStatus(me.id, !isWorking)
    await onChange?.()
  }

  const others = members.filter((m) => m.id !== me.id)
  const othersWorking = others.filter((m) => m.working_since)

  return (
    <div className="flex items-center gap-2">
      <button
        className={`cursor-pointer whitespace-nowrap rounded-full border bg-card-bg px-3 py-1.5 text-[13px] transition-all duration-[120ms] ease-tactile active:scale-[0.96] ${
          isWorking ? 'border-[var(--color-online)] text-[var(--color-online)]' : 'border-border text-text-h'
        }`}
        onClick={handleClick}
        title={isWorking ? `Online since ${formatSince(me.working_since)} — tap to go offline` : 'Go online'}
      >
        <StatusDot /> {isWorking ? 'Online' : 'Offline'}
      </button>

      {others.length > 0 && (
        <span
          className={`whitespace-nowrap text-[13px] ${
            othersWorking.length ? 'text-[var(--color-online)] opacity-100' : 'text-text opacity-60'
          }`}
          title={othersWorking.length ? othersWorking.map((m) => m.display_name).join(', ') : 'Nobody else working'}
        >
          <StatusDot /> {othersWorking.length ? `Working: ${othersWorking.map((m) => m.display_name).join(', ')}` : 'Nobody else working'}
        </span>
      )}
    </div>
  )
}

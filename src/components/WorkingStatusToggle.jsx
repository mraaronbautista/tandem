import { useEffect, useState } from 'react'
import { ChevronDown, Circle } from 'lucide-react'
import { setAvailability, updateWorkingStatus } from '../lib/members'
import IconButton from './IconButton'
import { PeriodTabs, PeriodTab } from './PeriodTabs'

// fill="currentColor" + strokeWidth={0}: a solid dot that just inherits
// whichever text-color class the caller already applies (green when
// online, muted otherwise) — no separate color prop to keep in sync.
function StatusDot() {
  return <Circle size={8} fill="currentColor" strokeWidth={0} className="inline align-[1px]" />
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

const STATUS_LABEL = { available: 'Available', busy: 'Busy', in_meeting: 'In a meeting' }

// Raw stored working_status/working_status_until can be stale — the
// member it belongs to might have their own browser closed/asleep well
// past their chosen expiry. Every viewer (including the member
// themselves) computes what's actually true right now from the raw
// timestamps rather than trusting the stored status directly, so an
// expiry stays correct without needing a server-side cron to revert it.
function effectiveStatus(member, now) {
  if (!member.working_since) return null
  if (!member.working_status_until) return member.working_status || 'available'
  return new Date(member.working_status_until) <= now ? 'available' : member.working_status
}

const EXPIRY_CHOICES = [
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: 'Until changed', minutes: null },
]

// One other member's row inside the team list — read-only, same shape
// whether shown from the chevron sheet (permitted members) or the
// compact summary button (Ada today).
function TeammateStatusRow({ member, status, now }) {
  const label = status ? STATUS_LABEL[status] : 'Offline'
  const since = status && member.working_since ? ` since ${formatTime(member.working_since)}` : ''
  const until =
    status && status !== 'available' && member.working_status_until && new Date(member.working_status_until) > now
      ? ` until ${formatTime(member.working_status_until)}`
      : ''
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] whitespace-nowrap text-text-h">
      <span className={status ? 'text-[var(--color-online)]' : 'text-text opacity-50'}>
        <StatusDot />
      </span>
      <span className="font-medium">{member.display_name}</span>
      <span className="opacity-70">
        — {label}
        {since}
        {until}
      </span>
    </div>
  )
}

// Every member gets their own toggle for their own status — "I'm
// working" is inherently self-reported — but only if they hold the
// 'workingStatus' permission (off for Ada, who's a viewer only; on by
// default for everyone else, deny-list same as every other feature key).
// A permitted member gets the one-tap Online/Offline pill plus a small
// separately-tappable chevron opening a status sheet (availability +
// team list); a non-permitted member instead gets one compact "N
// working" summary button that opens the same sheet minus the personal
// section. Either way this stays two small controls, not a spelled-out
// text span — the whole point of this redesign, after the original
// text-summary version left no room in the mobile header as the team
// grew past two people.
export default function WorkingStatusToggle({ me, members, onChange }) {
  const [now, setNow] = useState(() => new Date())
  const [sheetOpen, setSheetOpen] = useState(false)

  // Re-derives effective status every minute even if nothing about
  // `members` itself changes — an expiry passing isn't a database write,
  // so nothing would otherwise ever prompt a re-render to notice it.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])

  if (!me) return null

  const canSetStatus = me.permissions?.workingStatus !== false
  const isWorking = Boolean(me.working_since)
  const myStatus = effectiveStatus(me, now)
  const others = members.filter((m) => m.id !== me.id)
  const othersWorking = others.filter((m) => effectiveStatus(m, now))

  async function handleToggleClick() {
    await updateWorkingStatus(me.id, !isWorking)
    await onChange?.()
  }

  async function handleStatusClick(status) {
    await setAvailability(me.id, status, null)
    await onChange?.()
  }

  // Only rendered while myStatus is already busy/in_meeting (see below),
  // so myStatus is never 'available' here.
  async function handleExpiryClick(minutes) {
    const until = minutes == null ? null : new Date(Date.now() + minutes * 60000).toISOString()
    await setAvailability(me.id, myStatus, until)
    await onChange?.()
  }

  return (
    <div className="relative flex items-center gap-1.5">
      {canSetStatus ? (
        <>
          <button
            type="button"
            className={`cursor-pointer whitespace-nowrap rounded-full border bg-card-bg px-3 py-1.5 text-[13px] transition-all duration-[120ms] ease-tactile active:scale-[0.96] ${
              isWorking ? 'border-[var(--color-online)] text-[var(--color-online)]' : 'border-border text-text-h'
            }`}
            onClick={handleToggleClick}
            title={isWorking ? `Online since ${formatTime(me.working_since)} — tap to go offline` : 'Go online'}
          >
            {/* The toggle itself keeps its own long-established Online/
                Offline framing ("preserve the current one-tap behavior")
                even though the sheet below uses Available/Busy/In a
                meeting — Busy/In a meeting still shows here directly so
                the status is visible without opening the sheet at all. */}
            <StatusDot /> {isWorking ? (myStatus === 'available' ? 'Online' : STATUS_LABEL[myStatus]) : 'Offline'}
          </button>
          <IconButton size="header" onClick={() => setSheetOpen((v) => !v)} title="Status" aria-label="Status details">
            <ChevronDown size={16} />
          </IconButton>
        </>
      ) : (
        <button
          type="button"
          className={`cursor-pointer whitespace-nowrap rounded-full border border-border bg-card-bg px-3 py-1.5 text-[13px] transition-all duration-[120ms] ease-tactile active:scale-[0.96] ${
            othersWorking.length ? 'text-[var(--color-online)]' : 'text-text opacity-70'
          }`}
          onClick={() => setSheetOpen((v) => !v)}
        >
          <StatusDot /> {othersWorking.length ? `${othersWorking.length} working` : 'Nobody working'}
        </button>
      )}

      {sheetOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setSheetOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-border bg-card-bg p-2 shadow-raised">
            {canSetStatus && isWorking && (
              <div className="mb-2 border-b border-border pb-2">
                <PeriodTabs>
                  {['available', 'busy', 'in_meeting'].map((status) => (
                    <PeriodTab
                      key={status}
                      size="compact"
                      active={myStatus === status}
                      onClick={() => handleStatusClick(status)}
                    >
                      {STATUS_LABEL[status]}
                    </PeriodTab>
                  ))}
                </PeriodTabs>
                {myStatus !== 'available' && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {EXPIRY_CHOICES.map((choice) => (
                      <button
                        key={choice.label}
                        type="button"
                        className="cursor-pointer rounded-sm border border-border bg-pill-bg px-2 py-1 text-xs text-text-h [font-family:inherit]"
                        onClick={() => handleExpiryClick(choice.minutes)}
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                )}
                {myStatus !== 'available' && me.working_status_until && (
                  <p className="mt-1.5 text-xs opacity-65">Clears at {formatTime(me.working_status_until)}</p>
                )}
              </div>
            )}
            {others.length === 0 ? (
              <p className="px-2.5 py-1.5 text-[13px] opacity-65">No other members yet.</p>
            ) : (
              <div className="flex flex-col">
                {others.map((m) => (
                  <TeammateStatusRow key={m.id} member={m} status={effectiveStatus(m, now)} now={now} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

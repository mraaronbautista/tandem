import { useEffect, useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { staffAlertState, subscribeStaffToPush, unsubscribeStaffFromPush } from '../lib/pushNotifications'
import { friendlyError } from '../lib/friendlyError'

const BTN = 'inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-sm border border-border-accent bg-transparent px-4 text-sm font-semibold text-accent-text disabled:cursor-default disabled:opacity-60'

// The house manager's "Turn on alerts" card. It works the same on Android and
// iPhone, with one difference that no code can remove: on an iPhone, alerts
// only work from the Home Screen app, so a browser tab gets the steps instead.
export default function StaffAlertsCard() {
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function refresh() {
    try {
      setState(await staffAlertState())
    } catch {
      setState('off')
    }
  }
  useEffect(() => {
    refresh()
  }, [])

  async function turnOn() {
    setBusy(true)
    setError('')
    try {
      await subscribeStaffToPush()
    } catch (err) {
      setError(Notification.permission === 'denied'
        ? 'Alerts were blocked. Allow notifications for Tandem in your phone settings, then try again.'
        : friendlyError(err))
    } finally {
      setBusy(false)
      refresh()
    }
  }
  async function turnOff() {
    setBusy(true)
    setError('')
    try {
      await unsubscribeStaffFromPush()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
      refresh()
    }
  }

  if (!state) return null

  return (
    <section aria-label="Alerts" className="min-w-0 rounded-[12px] border border-border bg-card-bg p-3">
      {state === 'on' ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm text-text-h"><Bell size={16} className="text-accent-text" aria-hidden="true" /> Alerts are on</span>
          <button type="button" className="min-h-11 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-accent-text" disabled={busy} onClick={turnOff}>
            Turn off
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm font-semibold text-text-h">
            <BellOff size={16} aria-hidden="true" /> Alerts are off
          </div>
          {state === 'off' && (
            <>
              <p className="mb-2 mt-1 text-[13px] text-text">Get an alert when a visit is booked or changed, a unit note changes, a visit or move is coming up, or your report is marked done.</p>
              <button type="button" className={BTN} disabled={busy} onClick={turnOn}>
                <Bell size={15} aria-hidden="true" /> {busy ? 'Turning on…' : 'Turn on alerts'}
              </button>
            </>
          )}
          {state === 'ios-install' && (
            <ol className="mb-0 mt-1 list-decimal pl-5 text-[13px] text-text">
              <li>In Safari, tap the Share button.</li>
              <li>Tap Add to Home Screen.</li>
              <li>Open Tandem from your Home Screen and sign in.</li>
              <li>Come back here and tap Turn on alerts.</li>
            </ol>
          )}
          {state === 'blocked' && (
            <p className="mb-0 mt-1 text-[13px] text-text">Alerts are blocked for Tandem. Allow notifications for Tandem in your phone's settings, then open this screen again.</p>
          )}
          {state === 'unsupported' && (
            <p className="mb-0 mt-1 text-[13px] text-text">This browser cannot receive alerts. Use Chrome on Android, or Safari on iPhone with Tandem added to your Home Screen.</p>
          )}
        </>
      )}
      {error && <p role="alert" className="mb-0 mt-2 text-[13px] text-overdue-text">{error}</p>}
    </section>
  )
}

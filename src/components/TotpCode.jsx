import { useEffect, useState } from 'react'
import { formatTotpCode, generateTotp } from '../lib/totp'
import { CLOCK_WARN_MS, describeClockSkew, useClockSkewMs } from '../lib/clockCheck'

// A live one-time code with a countdown, like the one in an authenticator
// app. Recomputes only when the 30-second window rolls over; the ticking
// clock just drives the countdown. `onCopy` (optional) adds a Copy button
// that gives the plain digits — the form's preview omits it.
export default function TotpCode({ totp, onCopy, copied = false }) {
  const period = totp.period || 30
  const [now, setNow] = useState(() => Date.now())
  const [result, setResult] = useState(null)
  const skewMs = useClockSkewMs()

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  const counter = Math.floor(now / 1000 / period)
  useEffect(() => {
    let cancelled = false
    generateTotp(totp, Date.now())
      .then((r) => !cancelled && setResult(r))
      .catch(() => !cancelled && setResult({ error: true }))
    return () => {
      cancelled = true
    }
  }, [totp, counter])

  if (result?.error) {
    return <p className="error">Couldn't make a code from this key. Edit the entry and check the setup key.</p>
  }

  const secondsLeft = period - (Math.floor(now / 1000) % period)
  const low = secondsLeft <= 5

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span
          className="flex-1 font-mono text-xl font-semibold tracking-wider text-text-h tabular-nums"
          aria-label={result ? `One-time code ${result.code.split('').join(' ')}` : 'Making a code'}
        >
          {result ? formatTotpCode(result.code) : '••• •••'}
        </span>
        {onCopy && result && (
          <button type="button" className="vault-copy" onClick={() => onCopy(result.code)}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-pill-bg" aria-hidden="true">
          <div
            className={`h-full rounded-full ${low ? 'bg-overdue' : 'bg-accent'}`}
            style={{ width: `${(secondsLeft / period) * 100}%`, transition: 'width 0.5s linear' }}
          />
        </div>
        <span className={`flex-none whitespace-nowrap text-right tabular-nums ${low ? 'font-semibold text-overdue-text' : 'opacity-80'}`}>
          New code in {secondsLeft}s
        </span>
      </div>
      {/* Codes come from this device's clock, so a clock that is off makes
          them wrong without any other sign. Time zone does not matter —
          only the real time being accurate does. */}
      {skewMs != null && Math.abs(skewMs) >= CLOCK_WARN_MS && (
        <p role="alert" className="m-0 text-xs text-overdue-text">
          This device's clock is about {describeClockSkew(skewMs)} the real time, so this code may be rejected. Turn on
          automatic date &amp; time in this device's settings. Your time zone doesn't matter, only the clock.
        </p>
      )}
    </div>
  )
}

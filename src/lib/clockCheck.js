import { useEffect, useState } from 'react'

// Measures how far this device's clock is from real time, for the one place
// it matters: one-time codes (TOTP) are computed from the clock, so a device
// whose time was set by hand or has drifted shows codes sites reject. Time
// ZONES are irrelevant — codes use UTC seconds — only an inaccurate clock
// is a problem.
//
// The reference is the `Date` header of a same-origin request to this app's
// own host. (Supabase's replies can't be used: a browser hides the Date
// header on cross-site responses unless the server opts in, and it doesn't.
// A same-origin request exposes every header.) Compensated by half the
// round trip, and by `Age` if a cache served the file. The header only has
// one-second resolution, so this is meant for "off by tens of seconds", not
// precision; it fails quietly (returns null) when it can't measure.
export const CLOCK_WARN_MS = 10_000
const RECHECK_MS = 5 * 60_000

let cached = null // { at, skewMs }
let inflight = null

// Positive = this device is ahead of real time, negative = behind.
export async function measureClockSkewMs() {
  try {
    const t0 = Date.now()
    const res = await fetch(`/manifest.json?clock=${t0}`, { method: 'HEAD', cache: 'no-store' })
    const t1 = Date.now()
    const header = res.headers.get('date')
    if (!header) return null
    const age = Number(res.headers.get('age') || 0)
    const server = Date.parse(header) + (Number.isFinite(age) ? age * 1000 : 0)
    if (Number.isNaN(server)) return null
    return (t0 + t1) / 2 - server
  } catch {
    return null
  }
}

function getSkewMs() {
  if (cached && Date.now() - cached.at < RECHECK_MS) return Promise.resolve(cached.skewMs)
  if (!inflight) {
    inflight = measureClockSkewMs().then((skewMs) => {
      cached = { at: Date.now(), skewMs }
      inflight = null
      return skewMs
    })
  }
  return inflight
}

// null until measured (or if it could not be).
export function useClockSkewMs() {
  const [skewMs, setSkewMs] = useState(cached ? cached.skewMs : null)
  useEffect(() => {
    let cancelled = false
    getSkewMs().then((v) => !cancelled && setSkewMs(v))
    return () => {
      cancelled = true
    }
  }, [])
  return skewMs
}

export function describeClockSkew(skewMs) {
  const secs = Math.round(Math.abs(skewMs) / 1000)
  const amount = secs >= 120 ? `${Math.round(secs / 60)} minutes` : `${secs} seconds`
  return `${amount} ${skewMs > 0 ? 'ahead of' : 'behind'}`
}

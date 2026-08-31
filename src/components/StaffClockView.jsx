import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import {
  fetchOwnStaffProfile,
  fetchWorkSites,
  fetchActiveEntry,
  fetchOwnTimeEntries,
  clockIn,
  clockOut,
  computeEntryPay,
} from '../lib/staff'
import { findNearestSite } from '../lib/geo'
import ThemeToggle from './ThemeToggle'

function money(n) {
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function startOfWeek() {
  const d = startOfToday()
  d.setDate(d.getDate() - d.getDay())
  return d
}

// Wraps navigator.geolocation.getCurrentPosition in a promise — first
// use of the Geolocation API in this codebase, no existing pattern to
// lean on. Rejects (rather than hanging) on denial/timeout so callers
// can decide per-call whether a missing position should block the
// action (clock-in: yes) or just be logged as absent (clock-out: no —
// see handleStop below).
function getPosition(options) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location is not supported on this device/browser.'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, options)
  })
}

// The property manager's entire UI — deliberately one layout, not the
// isDesktop dual-tree split RentalsView.jsx/TaskBoard.jsx use elsewhere
// in this app. This is a handful of elements (Start/Stop, a timer, a
// summary, a history list), nowhere near the structural complexity
// that justified that split, and a phone is the realistic primary
// device for this role.
export default function StaffClockView({ theme, toggleTheme }) {
  const { session, signOut } = useAuth()
  const [profile, setProfile] = useState(null)
  const [sites, setSites] = useState([])
  const [activeEntry, setActiveEntry] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Start-flow local state
  const [starting, setStarting] = useState(false)
  const [detectedSite, setDetectedSite] = useState(null)
  const [selectedSiteId, setSelectedSiteId] = useState('')
  const [rateType, setRateType] = useState('standard')
  const [notes, setNotes] = useState('')
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [stopping, setStopping] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)

  async function loadAll() {
    try {
      const [profileData, sitesData, entryData] = await Promise.all([
        fetchOwnStaffProfile(session.user.id),
        fetchWorkSites(),
        fetchActiveEntry(session.user.id),
      ])
      setProfile(profileData)
      setSites(sitesData)
      setActiveEntry(entryData)
      if (!entryData) {
        setHistory(await fetchOwnTimeEntries(session.user.id, { from: startOfWeek().toISOString() }))
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ticks the elapsed-time readout locally — no server round-trip
  // needed to keep a clock moving.
  useEffect(() => {
    if (!activeEntry) return
    const tick = () => setElapsedMs(Date.now() - new Date(activeEntry.clock_in_at).getTime())
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [activeEntry])

  async function handleStartTap() {
    setStarting(true)
    setLocationError('')
    setLocating(true)
    setDetectedSite(null)
    try {
      const pos = await getPosition({ enableHighAccuracy: true, timeout: 15000 })
      const { latitude, longitude, accuracy } = pos.coords
      const nearest = findNearestSite(sites, latitude, longitude)
      setDetectedSite({ lat: latitude, lng: longitude, accuracyM: accuracy, nearest })
      if (nearest) setSelectedSiteId(nearest.site.id)
    } catch {
      setLocationError(
        "Couldn't get your location — check that location access is allowed for this site, then try again, or pick your site manually below.",
      )
    } finally {
      setLocating(false)
    }
  }

  async function handleConfirmStart() {
    if (!selectedSiteId) {
      setError('Pick a site before starting.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const entry = await clockIn({
        staffId: session.user.id,
        workSiteId: selectedSiteId,
        rateType,
        lat: detectedSite?.lat ?? null,
        lng: detectedSite?.lng ?? null,
        accuracyM: detectedSite?.accuracyM ?? null,
        notes,
      })
      setActiveEntry(entry)
      setStarting(false)
      setNotes('')
      setRateType('standard')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  function cancelStart() {
    setStarting(false)
    setDetectedSite(null)
    setSelectedSiteId('')
    setLocationError('')
    setNotes('')
    setRateType('standard')
  }

  async function handleStop() {
    setStopping(true)
    setError('')
    // A flaky GPS signal at the END of a shift shouldn't trap someone
    // unable to clock out — fall through to a coordinate-less clock-out
    // on any failure/timeout rather than blocking the action.
    let lat = null
    let lng = null
    try {
      const pos = await getPosition({ enableHighAccuracy: true, timeout: 8000 })
      lat = pos.coords.latitude
      lng = pos.coords.longitude
    } catch {
      // Silently proceed without coordinates — see comment above.
    }
    try {
      await clockOut({ entryId: activeEntry.id, lat, lng })
      setActiveEntry(null)
      await loadAll()
    } catch (err) {
      setError(err.message)
    } finally {
      setStopping(false)
    }
  }

  if (loading) return <p className="loading p-6 text-center">Loading…</p>

  const todayPay = history
    .filter((e) => new Date(e.clock_in_at) >= startOfToday())
    .reduce((sum, e) => sum + (computeEntryPay(e) || 0), 0)
  const weekPay = history.reduce((sum, e) => sum + (computeEntryPay(e) || 0), 0)

  return (
    <div className="mx-auto flex max-w-[480px] flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-semibold text-text-h">
            {profile?.active === false ? 'Account deactivated' : `Hi, ${profile?.display_name || ''}`}
          </h1>
          {profile?.active === false && (
            <p className="text-sm opacity-70">Check with Ada or Aaron — your access has been paused.</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <button
            type="button"
            className="cursor-pointer rounded-sm border border-border bg-card-bg px-2.5 py-1.5 text-xs text-text"
            onClick={signOut}
          >
            Sign out
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {profile?.active !== false && (
        <>
          {!activeEntry && !starting && (
            <button
              type="button"
              className="cursor-pointer rounded-[16px] border-0 bg-accent px-4 py-8 text-2xl font-bold text-white active:scale-[0.98]"
              onClick={handleStartTap}
            >
              ▶ Start
            </button>
          )}

          {!activeEntry && starting && (
            <div className="flex flex-col gap-3 rounded-[8px] border border-border bg-card-bg p-4">
              {locating && <p className="loading">Finding your location…</p>}
              {locationError && <p className="error">{locationError}</p>}
              {detectedSite?.nearest && (
                <p className="text-sm opacity-80">
                  You're ~{Math.round(detectedSite.nearest.distanceM)}m from{' '}
                  <strong>{detectedSite.nearest.site.name}</strong>.
                </p>
              )}

              <label className="flex flex-col gap-1 text-sm">
                Site
                <select
                  className="rounded-sm border border-border bg-bg px-2.5 py-2 text-text-h"
                  value={selectedSiteId}
                  onChange={(e) => setSelectedSiteId(e.target.value)}
                >
                  <option value="">Select a site…</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex gap-2">
                <button
                  type="button"
                  className={`flex-1 cursor-pointer rounded-sm border px-3 py-2 text-sm ${
                    rateType === 'standard' ? 'border-accent bg-accent text-white' : 'border-border bg-bg text-text'
                  }`}
                  onClick={() => setRateType('standard')}
                >
                  Standard (${profile?.hourly_rate}/hr)
                </button>
                <button
                  type="button"
                  className={`flex-1 cursor-pointer rounded-sm border px-3 py-2 text-sm ${
                    rateType === 'emergency' ? 'border-accent bg-accent text-white' : 'border-border bg-bg text-text'
                  }`}
                  onClick={() => setRateType('emergency')}
                >
                  Emergency (${profile?.emergency_rate}/hr)
                </button>
              </div>

              <label className="flex flex-col gap-1 text-sm">
                Notes (optional)
                <textarea
                  className="rounded-sm border border-border bg-bg p-2 text-text-h [font-family:inherit]"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>

              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 cursor-pointer rounded-sm border border-border bg-bg px-3 py-2 text-sm text-text"
                  onClick={cancelStart}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="flex-1 cursor-pointer rounded-sm border-0 bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  onClick={handleConfirmStart}
                  disabled={submitting || !selectedSiteId}
                >
                  {submitting ? 'Starting…' : 'Confirm start'}
                </button>
              </div>
            </div>
          )}

          {activeEntry && (
            <div className="flex flex-col items-center gap-3 rounded-[16px] border border-border bg-card-bg p-6">
              <p className="text-sm opacity-70">Clocked in — {activeEntry.rate_type}</p>
              <p className="text-4xl font-bold text-text-h tabular-nums">{formatElapsed(elapsedMs)}</p>
              {activeEntry.flagged && (
                <p className="text-xs text-overdue">⚠ Flagged — clock-in was outside the expected radius.</p>
              )}
              <button
                type="button"
                className="w-full cursor-pointer rounded-[8px] border-0 bg-overdue px-4 py-3 text-lg font-bold text-white disabled:opacity-50"
                onClick={handleStop}
                disabled={stopping}
              >
                {stopping ? 'Stopping…' : '■ Stop'}
              </button>
            </div>
          )}

          {!activeEntry && (
            <div className="flex flex-col gap-2 rounded-[8px] border border-border bg-card-bg p-4">
              <div className="flex justify-between text-sm">
                <span>Today</span>
                <span className="font-semibold">{money(todayPay)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>This week</span>
                <span className="font-semibold">{money(weekPay)}</span>
              </div>
            </div>
          )}

          {!activeEntry && history.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="text-[13px] opacity-60">Recent shifts</h2>
              {history.map((e) => (
                <div key={e.id} className="flex items-center justify-between rounded-sm border border-border px-3 py-2 text-sm">
                  <span>
                    {new Date(e.clock_in_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    {e.flagged && ' ⚠'}
                  </span>
                  <span>{e.clock_out_at ? money(computeEntryPay(e)) : 'in progress'}</span>
                  <span className={e.status === 'approved' ? 'text-online' : 'opacity-60'}>{e.status}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Flag, MapPin, Play, Square } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import {
  fetchOwnStaffProfile,
  fetchWorkSites,
  fetchActiveEntry,
  fetchOwnTimeEntries,
  fetchOwnTimeEntryRequests,
  submitTimeEntryRequest,
  submitShiftReport,
  clockIn,
  clockOut,
  computeEntryPay,
  workSiteStatus,
  submitWorkSiteLocationCapture,
} from '../lib/staff'
import { sendTimeEntryCorrectionRequest } from '../lib/manualNotify'
import { findNearestSite, haversineDistanceM } from '../lib/geo'
import ThemeToggle from './ThemeToggle'

// How long to wait after first noticing the property manager is outside
// the active shift's geofence before actually prompting them — a single
// reading isn't enough to act on (GPS drift near buildings, a brief step
// outside for a delivery, a signal dropout mid-fix), and per product
// decision this only ever prompts, never auto-clocks-out, so there's no
// urgency pushing that window shorter.
const GEOFENCE_PROMPT_DELAY_MS = 2 * 60 * 1000

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
  // Needs-setup and pending-approval sites, visible to staff specifically so
  // they can capture a point for one — see "staff can read needs-setup work
  // sites" in schema.sql. Kept separate from `sites` (ready sites only) so
  // every existing sites-consuming path below (Start flow, findNearestSite,
  // history lookups) stays exactly as it was — it already only ever expected
  // ready sites, previously true implicitly via RLS alone, now explicit.
  const [captureSites, setCaptureSites] = useState([])
  const [activeEntry, setActiveEntry] = useState(null)
  const [history, setHistory] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // On-site capture flow local state
  const [capturingSiteId, setCapturingSiteId] = useState(null)
  const [captureError, setCaptureError] = useState('')
  const [captureMessage, setCaptureMessage] = useState('')

  // Time-correction-request compose state — one shared panel, not a
  // separate one per shift row: `requestTarget` is either { entryId } for
  // "fix this specific shift" or { entryId: null } for "a shift I never
  // logged at all," and null when the panel is closed. See
  // "Manual time entries and correction requests" in schema.sql.
  const [requestTarget, setRequestTarget] = useState(null)
  const [requestNote, setRequestNote] = useState('')
  const [submittingRequest, setSubmittingRequest] = useState(false)
  const [requestError, setRequestError] = useState('')

  // Start-flow local state
  const [starting, setStarting] = useState(false)
  const [detectedSite, setDetectedSite] = useState(null)
  const [selectedSiteId, setSelectedSiteId] = useState('')
  const [rateType, setRateType] = useState('standard')
  const [notes, setNotes] = useState('')
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Stop-flow state — replaces a single "Stop -> immediately clocked out"
  // action with a choice, per product decision: `stopFlow` is null when
  // closed, or { reason: 'manual' | 'geofence', step: 'choose' | 'report' }.
  // `reason` only changes which options the 'choose' step offers (geofence
  // adds "I'm still working," since that trigger could be a false
  // positive); both reasons run through the exact same clock-out/report
  // logic once a choice is made.
  const [stopFlow, setStopFlow] = useState(null)
  const [stopReportNote, setStopReportNote] = useState('')
  const [stopSubmitting, setStopSubmitting] = useState(false)
  const [stopError, setStopError] = useState('')
  const [elapsedMs, setElapsedMs] = useState(0)

  // Deferred/later shift-report compose state, for Recent shifts — a
  // report isn't only addable in the moment of clocking out; see
  // submitShiftReport() in staff.js.
  const [reportComposeId, setReportComposeId] = useState(null)
  const [reportDraft, setReportDraft] = useState('')
  const [submittingReport, setSubmittingReport] = useState(false)
  const [reportSubmitError, setReportSubmitError] = useState('')

  // Geofence-exit detection state — plain refs, not React state, since
  // neither needs to trigger a re-render on its own; they're read/written
  // only from inside the watchPosition callback below.
  const outsideSinceRef = useRef(null)
  const geofencePromptedRef = useRef(false)

  async function loadAll() {
    try {
      const [profileData, sitesData, entryData] = await Promise.all([
        fetchOwnStaffProfile(session.user.id),
        fetchWorkSites(),
        fetchActiveEntry(session.user.id),
      ])
      setProfile(profileData)
      applySites(sitesData)
      setActiveEntry(entryData)
      if (!entryData) {
        setHistory(await fetchOwnTimeEntries(session.user.id, { from: startOfWeek().toISOString() }))
      }
      await reloadRequests()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function reloadRequests() {
    try {
      setRequests(await fetchOwnTimeEntryRequests(session.user.id))
    } catch (err) {
      setError(err.message)
    }
  }

  // Split out of loadAll so the work_sites Realtime channel below can
  // re-derive just sites/captureSites on a member's approve/discard —
  // re-running the whole loadAll (profile, activeEntry, history) on
  // every work_sites row change would be wasted work and risks
  // clobbering in-flight Start-flow state for no reason.
  function applySites(sitesData) {
    setSites(sitesData.filter((s) => workSiteStatus(s) === 'ready'))
    // Explicitly needsSetup/pendingApproval only, not a plain "!== ready"
    // — RLS ("staff can read needs-setup work sites" in schema.sql)
    // already keeps an inactive/archived site out of what staff ever
    // receives here, but filtering explicitly rather than by exclusion
    // means this stays correct even if that assumption is ever wrong,
    // instead of silently offering a Capture button for an archived site.
    setCaptureSites(sitesData.filter((s) => ['needsSetup', 'pendingApproval'].includes(workSiteStatus(s))))
  }

  async function reloadSites() {
    try {
      applySites(await fetchWorkSites())
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mirrors StaffLogsView.jsx's own staff-work-sites-changes channel, for
  // the same reason in the other direction: a member approving or
  // discarding a capture is a work_sites write that happens entirely
  // outside anything this screen does, so a pmanager already sitting on
  // this screen needs the same live signal a member gets, not just a
  // fetch on mount. Requires the same
  // `alter publication supabase_realtime add table work_sites;` step —
  // see schema.sql.
  useEffect(() => {
    const channel = supabase
      .channel('staff-clock-work-sites-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_sites' }, reloadSites)
      .subscribe()
    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // filter: only this pmanager's own requests — RLS already scopes
  // fetchOwnTimeEntryRequests() the same way, but the filter here also
  // keeps the channel from re-firing on a different staff member's
  // requests (relevant once a second property manager ever exists).
  // Lets a resolved status show up here without a manual reload, the same
  // reason the member-side channel exists for the request it's replying to.
  useEffect(() => {
    const channel = supabase
      .channel('staff-clock-time-entry-requests-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'time_entry_requests', filter: `staff_id=eq.${session.user.id}` },
        reloadRequests,
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
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

  // Continuous geofence-exit check while clocked in — only ever prompts,
  // per product decision, never auto-clocks-out on its own (a GPS glitch
  // or a quick supply run shouldn't silently cut someone's pay). Location
  // permission was already granted at Start, so this doesn't trigger a
  // fresh unprompted permission request the way a cold watch would.
  // enableHighAccuracy is deliberately false here (unlike the one-shot
  // Start/Stop reads) — this can run for an entire shift's duration, so
  // trading GPS precision for battery life is the right default for a
  // continuous background-ish check, not a single point-in-time reading.
  useEffect(() => {
    if (!activeEntry || !navigator.geolocation) return
    const site = sites.find((s) => s.id === activeEntry.work_site_id)
    if (!site) return

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const distanceM = haversineDistanceM(pos.coords.latitude, pos.coords.longitude, site.latitude, site.longitude)
        if (distanceM > site.geofence_radius_m) {
          if (!outsideSinceRef.current) {
            outsideSinceRef.current = Date.now()
          } else if (!geofencePromptedRef.current && Date.now() - outsideSinceRef.current >= GEOFENCE_PROMPT_DELAY_MS) {
            geofencePromptedRef.current = true
            // Functional update, not a direct value — the effect's own
            // closure over stopFlow would otherwise be stale, and this
            // also means an already-open stop flow (e.g. the property
            // manager already tapped Stop manually and is mid-report)
            // never gets silently clobbered by this automatic trigger.
            setStopFlow((current) => current ?? { reason: 'geofence', step: 'choose' })
          }
        } else {
          // Back inside the radius — a real excursion or just drift
          // either way, but no longer relevant; a future exit should be
          // timed fresh, not credited against this one.
          outsideSinceRef.current = null
          geofencePromptedRef.current = false
        }
      },
      // Errors here (denied/unavailable/timeout) are silently ignored —
      // this is a soft, best-effort check layered on top of an already-
      // successful clock-in, not something that should surface as an
      // app-level error the way the Start flow's own location requirement
      // does.
      () => {},
      { enableHighAccuracy: false, maximumAge: 60000, timeout: 20000 },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [activeEntry, sites])

  async function handleStartTap() {
    setStarting(true)
    setError('')
    setLocationError('')
    setLocating(true)
    setDetectedSite(null)
    setSelectedSiteId('')
    try {
      const pos = await getPosition({ enableHighAccuracy: true, timeout: 15000 })
      const { latitude, longitude, accuracy } = pos.coords
      const nearest = findNearestSite(sites, latitude, longitude)
      setDetectedSite({ lat: latitude, lng: longitude, accuracyM: accuracy, nearest })
      if (nearest) setSelectedSiteId(nearest.site.id)
    } catch {
      setLocationError(
        "Couldn't get your location. Clock-in requires a location reading — check this site's location permission, then try again.",
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
    if (!detectedSite) {
      setError('Get your current location before starting.')
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

  // The actual clock-out call, shared by both "taking a break" and
  // "clocking out" below — those two differ only in what happens around
  // this call (an auto-tagged break note vs. an optional typed report),
  // never in how the clock-out itself works. Returns the closed entry's id
  // so callers can attach a report afterward, since activeEntry is cleared
  // by the time this returns.
  async function runClockOut() {
    const closedEntryId = activeEntry.id
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
    await clockOut({ entryId: closedEntryId, lat, lng })
    setActiveEntry(null)
    await loadAll()
    return closedEntryId
  }

  function handleStopTap() {
    setStopError('')
    setStopReportNote('')
    setStopFlow({ reason: 'manual', step: 'choose' })
  }

  // Only reachable from a geofence-triggered prompt — dismisses it as a
  // likely false positive (GPS drift, a brief step outside) and resets the
  // debounce so a later, genuine excursion can still trigger a fresh
  // prompt rather than being permanently suppressed by this one dismissal.
  function handleStillWorking() {
    outsideSinceRef.current = null
    geofencePromptedRef.current = false
    setStopFlow(null)
  }

  // Break = an ordinary clock-out, by product decision — no schema change,
  // no separate pause/resume state. The auto-tagged note is the only thing
  // that distinguishes it from a real end-of-shift in what Ada/Aaron see
  // later: a gap in the day with an explicit reason, not an unexplained
  // missing chunk. Best-effort — the clock-out itself has already
  // succeeded by the time this runs, so a failure tagging the note
  // shouldn't read as the whole action having failed.
  async function handleTakeBreak() {
    setStopSubmitting(true)
    setStopError('')
    try {
      const closedEntryId = await runClockOut()
      try {
        await submitShiftReport(closedEntryId, '(Break — will resume shortly)')
      } catch (err) {
        console.error('Failed to tag break note (clock-out itself still succeeded):', err)
      }
      setStopFlow(null)
    } catch (err) {
      setStopError(err.message)
    } finally {
      setStopSubmitting(false)
    }
  }

  function handleChooseClockOut() {
    setStopFlow((current) => ({ ...current, step: 'report' }))
  }

  // The real end-of-shift path — clocks out first, then attaches whatever
  // report text was typed (optional; per product decision Stop must never
  // be blocked on this). A report-submission failure here is also
  // best-effort for the same reason handleTakeBreak's is: the clock-out
  // itself already succeeded, and the same report can always be added
  // later from Recent shifts (handleSubmitShiftReport below) if this
  // particular attempt doesn't land.
  async function handleFinishClockOut() {
    setStopSubmitting(true)
    setStopError('')
    try {
      const closedEntryId = await runClockOut()
      if (stopReportNote.trim()) {
        try {
          await submitShiftReport(closedEntryId, stopReportNote.trim())
        } catch (err) {
          console.error('Failed to submit shift report (clock-out itself still succeeded):', err)
        }
      }
      setStopFlow(null)
      setStopReportNote('')
    } catch (err) {
      setStopError(err.message)
    } finally {
      setStopSubmitting(false)
    }
  }

  // Adding/editing a report later, from Recent shifts — same
  // submitShiftReport() call the Stop flow above uses, just reached a
  // different way (any past shift, not only the one just closed).
  async function handleSubmitShiftReport(entryId) {
    if (!reportDraft.trim()) return
    setSubmittingReport(true)
    setReportSubmitError('')
    try {
      await submitShiftReport(entryId, reportDraft.trim())
      setReportComposeId(null)
      setReportDraft('')
      await loadAll()
    } catch (err) {
      setReportSubmitError(err.message)
    } finally {
      setSubmittingReport(false)
    }
  }

  // Reuses getPosition() above rather than a third independent geolocation
  // implementation — StaffWorkSitesForm.jsx already has its own separate
  // inline one for a member standing on-site themselves; this is staff's
  // version of the same idea, for the fallback case address lookup can't
  // resolve. Resubmitting before a member approves is allowed on purpose
  // (see staff_submit_location_capture()'s own comment in schema.sql) — the
  // button just relabels to "Recapture" once a capture already exists.
  async function handleCapture(siteId) {
    setCapturingSiteId(siteId)
    setCaptureError('')
    setCaptureMessage('')
    try {
      const pos = await getPosition({ enableHighAccuracy: true, timeout: 15000 })
      const { latitude, longitude, accuracy } = pos.coords
      await submitWorkSiteLocationCapture({ workSiteId: siteId, lat: latitude, lng: longitude, accuracyM: accuracy })
      setCaptureMessage('Location captured. Ask Ada or Aaron to approve it before you can clock in here.')
      await loadAll()
    } catch (err) {
      setCaptureError(err.message || "Couldn't get your location. Check this site's location permission and try again.")
    } finally {
      setCapturingSiteId(null)
    }
  }

  async function handleSubmitRequest() {
    if (!requestNote.trim()) return
    setSubmittingRequest(true)
    setRequestError('')
    try {
      await submitTimeEntryRequest({ staffId: session.user.id, timeEntryId: requestTarget.entryId, note: requestNote.trim() })
      // Best-effort — the request itself is already saved above regardless
      // of whether the push actually reaches Ada/Aaron, so a notification
      // failure here shouldn't read as the request having failed.
      try {
        await sendTimeEntryCorrectionRequest(requestNote.trim())
      } catch (err) {
        console.error('sendTimeEntryCorrectionRequest failed (request was still saved):', err)
      }
      setRequestTarget(null)
      setRequestNote('')
      await reloadRequests()
    } catch (err) {
      setRequestError(err.message)
    } finally {
      setSubmittingRequest(false)
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
            <div className="flex flex-col gap-2">
              <button
                type="button"
                className="cursor-pointer rounded-[16px] border-0 bg-accent px-4 py-8 text-2xl font-bold text-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleStartTap}
                disabled={sites.length === 0}
              >
                <Play size={22} className="mr-1.5 inline align-[-3px]" fill="currentColor" /> Start
              </button>
              {sites.length === 0 && (
                <p className="text-center text-sm opacity-70">
                  {captureSites.length === 0
                    ? 'No active work sites are available. Ask Ada or Aaron to add one.'
                    : "No work sites are ready to clock in at yet — capture your location below for the one you're at."}
                </p>
              )}
            </div>
          )}

          {/* Fallback for when address lookup couldn't place a site
              accurately — the on-site property manager captures their own
              current GPS reading instead. Sits pending until a member
              approves it (see approveWorkSiteLocationCapture in staff.js),
              so this never bypasses member review of a new clock-in point. */}
          {!activeEntry && !starting && captureSites.length > 0 && (
            <div className="flex flex-col gap-2 rounded-[8px] border border-border bg-card-bg p-4">
              <h2 className="text-[13px] opacity-60">Set up a location</h2>
              {captureError && <p className="error">{captureError}</p>}
              {captureMessage && <p className="text-sm text-online">{captureMessage}</p>}
              {captureSites.map((site) => {
                const hasPending = site.pending_latitude != null
                return (
                  <div key={site.id} className="flex items-center justify-between gap-2 rounded-sm border border-border px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text-h">{site.name}</p>
                      {hasPending && <p className="text-xs opacity-65">Submitted — waiting for approval</p>}
                    </div>
                    <button
                      type="button"
                      className="flex-none cursor-pointer rounded-sm border border-border bg-bg px-2.5 py-1.5 text-xs text-text-h disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => handleCapture(site.id)}
                      disabled={capturingSiteId === site.id}
                    >
                      <MapPin size={12} className="mr-1 inline align-[-1px]" />
                      {capturingSiteId === site.id ? 'Locating…' : hasPending ? 'Recapture' : 'Capture location'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {!activeEntry && starting && (
            <div className="flex flex-col gap-3 rounded-[8px] border border-border bg-card-bg p-4">
              {locating && <p className="loading">Finding your location…</p>}
              {locationError && <p className="error">{locationError}</p>}
              {locationError && !locating && (
                <button
                  type="button"
                  className="cursor-pointer self-start rounded-sm border border-border bg-bg px-3 py-2 text-sm text-text-h"
                  onClick={handleStartTap}
                >
                  Try location again
                </button>
              )}
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

              <div className="grid grid-cols-2 gap-2">
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
                  disabled={submitting || locating || !selectedSiteId || !detectedSite}
                >
                  {submitting ? 'Starting…' : 'Confirm start'}
                </button>
              </div>
            </div>
          )}

          {activeEntry && (
            <div className="flex flex-col items-center gap-3 rounded-[16px] border border-border bg-card-bg p-6">
              <div className="text-center text-sm opacity-70">
                <p>Clocked in at {sites.find((site) => site.id === activeEntry.work_site_id)?.name || 'work site'}</p>
                <p className="mt-0.5 capitalize">{activeEntry.rate_type} rate</p>
              </div>
              <p className="text-4xl font-bold text-text-h tabular-nums">{formatElapsed(elapsedMs)}</p>
              {activeEntry.flagged && (
                <p className="flex items-center gap-1 text-xs text-overdue">
                  <AlertTriangle size={13} /> Flagged — clock-in was outside the expected radius.
                </p>
              )}
              <button
                type="button"
                className="w-full cursor-pointer rounded-[8px] border-0 bg-overdue px-4 py-3 text-lg font-bold text-white disabled:opacity-50"
                onClick={handleStopTap}
                disabled={Boolean(stopFlow)}
              >
                <Square size={16} className="mr-1.5 inline align-[-2px]" fill="currentColor" /> Stop
              </button>
            </div>
          )}

          {/* Stop flow — a choice, not an immediate clock-out. Reached
              either by tapping Stop above (reason: 'manual') or
              automatically once the geofence-exit watch decides this
              isn't a fleeting blip (reason: 'geofence', which adds an
              extra "I'm still working" escape). Both reasons converge on
              the same 'choose' -> maybe 'report' steps either way. */}
          {activeEntry && stopFlow && (
            <div className="flex flex-col gap-3 rounded-[16px] border border-accent bg-card-bg p-4">
              {stopError && <p className="error">{stopError}</p>}
              {stopFlow.step === 'choose' && (
                <>
                  <h2 className="text-[13px] opacity-60">
                    {stopFlow.reason === 'geofence' ? "Looks like you've left the site" : 'Stopping the clock'}
                  </h2>
                  <div className="flex flex-col gap-2">
                    {stopFlow.reason === 'geofence' && (
                      <button
                        type="button"
                        className="cursor-pointer rounded-sm border border-border bg-bg px-3 py-2 text-sm text-text-h"
                        onClick={handleStillWorking}
                      >
                        I'm still working
                      </button>
                    )}
                    <button
                      type="button"
                      className="cursor-pointer rounded-sm border border-border bg-bg px-3 py-2 text-sm text-text-h disabled:opacity-50"
                      onClick={handleTakeBreak}
                      disabled={stopSubmitting}
                    >
                      {stopSubmitting ? 'Clocking out…' : 'Taking a break'}
                    </button>
                    <button
                      type="button"
                      className="cursor-pointer rounded-sm border-0 bg-overdue px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      onClick={handleChooseClockOut}
                      disabled={stopSubmitting}
                    >
                      Clocking out for now
                    </button>
                  </div>
                </>
              )}
              {stopFlow.step === 'report' && (
                <>
                  <h2 className="text-[13px] opacity-60">What did you work on? (optional)</h2>
                  <textarea
                    autoFocus
                    className="rounded-sm border border-border bg-bg p-2 text-sm text-text-h [font-family:inherit]"
                    rows={3}
                    placeholder="e.g. cleaned unit 2, met the new tenant, fixed the porch light"
                    value={stopReportNote}
                    onChange={(event) => setStopReportNote(event.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="flex-1 cursor-pointer rounded-sm border border-border bg-bg px-3 py-2 text-sm text-text"
                      onClick={() => setStopFlow((current) => ({ ...current, step: 'choose' }))}
                      disabled={stopSubmitting}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      className="flex-1 cursor-pointer rounded-sm border-0 bg-overdue px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      onClick={handleFinishClockOut}
                      disabled={stopSubmitting}
                    >
                      {stopSubmitting ? 'Clocking out…' : 'Finish clocking out'}
                    </button>
                  </div>
                </>
              )}
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
              {history.map((e) => {
                const hasOpenRequest = requests.some((r) => r.time_entry_id === e.id && r.status === 'open')
                return (
                  <div key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-sm border border-border px-3 py-2 text-sm">
                    <span className="min-w-0 truncate font-medium text-text-h">
                      {sites.find((site) => site.id === e.work_site_id)?.name || 'Work site'}
                    </span>
                    <span className={e.status === 'approved' ? 'text-online' : 'opacity-60'}>{e.status}</span>
                    <span className="text-xs opacity-65">
                      {new Date(e.clock_in_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      {e.flagged && <AlertTriangle size={12} className="ml-1 inline align-[-1px] text-overdue" />}
                    </span>
                    <span className="font-semibold">{e.clock_out_at ? money(computeEntryPay(e)) : 'in progress'}</span>
                    {/* Shift report — existing notes shown read-only above a
                        fresh compose box, mirroring EndOfDayReportForm.jsx's
                        own "read-only existing body, compose a new chunk
                        below" shape (submitShiftReport() appends, it never
                        overwrites), so a later addition can't clobber a
                        report already captured at clock-in or a previous
                        submission. Highlighted when Ada/Aaron explicitly
                        asked — see requestShiftReport() in staff.js. */}
                    <div
                      className={`col-span-2 flex flex-col gap-1.5 ${e.report_requested_at ? 'rounded-sm border border-accent bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-2 py-1.5' : ''}`}
                    >
                      {e.report_requested_at && (
                        <p className="text-xs font-medium text-text-h">Ada/Aaron asked what you worked on</p>
                      )}
                      {e.notes && <p className="whitespace-pre-wrap text-xs opacity-70">{e.notes}</p>}
                      {reportComposeId === e.id ? (
                        <div className="flex flex-col gap-1.5">
                          {reportSubmitError && <p className="error">{reportSubmitError}</p>}
                          <textarea
                            autoFocus
                            rows={2}
                            className="rounded-sm border border-border bg-bg p-1.5 text-xs text-text-h [font-family:inherit]"
                            placeholder="What did you work on?"
                            value={reportDraft}
                            onChange={(event) => setReportDraft(event.target.value)}
                          />
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              className="flex-1 cursor-pointer rounded-sm border border-border bg-bg px-2 py-1 text-xs text-text"
                              onClick={() => setReportComposeId(null)}
                              disabled={submittingReport}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="flex-1 cursor-pointer rounded-sm border-0 bg-accent px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                              onClick={() => handleSubmitShiftReport(e.id)}
                              disabled={submittingReport || !reportDraft.trim()}
                            >
                              {submittingReport ? 'Sending…' : 'Submit'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="cursor-pointer self-start text-xs text-accent-h underline"
                          onClick={() => {
                            setReportComposeId(e.id)
                            setReportDraft('')
                            setReportSubmitError('')
                          }}
                        >
                          {e.notes ? 'Add more' : e.report_requested_at ? 'Submit report' : 'Add a report'}
                        </button>
                      )}
                    </div>
                    {/* Spans the full row width (col-span-2) rather than
                        sitting in one of the two existing grid columns —
                        this is a third line under the pair above, not a
                        third value alongside site/status or date/pay. */}
                    <div className="col-span-2">
                      {hasOpenRequest ? (
                        <span className="text-xs opacity-60">
                          <Flag size={11} className="mr-1 inline align-[-1px]" /> Fix requested — waiting on Ada/Aaron
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="cursor-pointer text-xs text-accent-h underline"
                          onClick={() => {
                            setRequestTarget({ entryId: e.id })
                            setRequestNote('')
                            setRequestError('')
                          }}
                        >
                          Something wrong with this shift?
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Not tied to a specific shift — for a shift that was never
              clocked into at all, there's no history row to attach this to.
              Shown regardless of activeEntry, unlike the sections above,
              since reporting a past missed shift has nothing to do with
              whether one happens to be running right now. */}
          <button
            type="button"
            className="cursor-pointer self-start text-xs text-accent-h underline"
            onClick={() => {
              setRequestTarget({ entryId: null })
              setRequestNote('')
              setRequestError('')
            }}
          >
            <Flag size={11} className="mr-1 inline align-[-1px]" /> Report a shift I forgot to clock in for
          </button>

          {requestTarget && (
            <div className="flex flex-col gap-2 rounded-[8px] border border-border bg-card-bg p-4">
              <h2 className="text-[13px] opacity-60">
                {requestTarget.entryId ? 'What needs fixing?' : 'Describe the missed shift'}
              </h2>
              {requestError && <p className="error">{requestError}</p>}
              <textarea
                autoFocus
                className="rounded-sm border border-border bg-bg p-2 text-sm text-text-h [font-family:inherit]"
                rows={3}
                placeholder={
                  requestTarget.entryId
                    ? 'e.g. clocked in 30 minutes late by mistake, actual start was 8am'
                    : 'e.g. worked at Rachel on Sept 10, roughly 2pm-6pm, forgot to clock in'
                }
                value={requestNote}
                onChange={(event) => setRequestNote(event.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 cursor-pointer rounded-sm border border-border bg-bg px-3 py-2 text-sm text-text"
                  onClick={() => setRequestTarget(null)}
                  disabled={submittingRequest}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="flex-1 cursor-pointer rounded-sm border-0 bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  onClick={handleSubmitRequest}
                  disabled={submittingRequest || !requestNote.trim()}
                >
                  {submittingRequest ? 'Sending…' : 'Send to Ada & Aaron'}
                </button>
              </div>
            </div>
          )}

          {requests.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="text-[13px] opacity-60">Your requests</h2>
              {requests.map((r) => (
                <div key={r.id} className="flex flex-col gap-1 rounded-sm border border-border px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className={r.status === 'open' ? 'text-accent-h' : 'opacity-60'}>
                      {r.status === 'open' ? 'Waiting on Ada/Aaron' : 'Resolved'}
                    </span>
                    <span className="text-xs opacity-60">
                      {new Date(r.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <p className="truncate opacity-80">{r.note}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

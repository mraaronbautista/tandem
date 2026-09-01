import { useEffect, useState } from 'react'
import { AlertTriangle, Clock3, MapPin } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { fetchRentalProperties } from '../lib/rentals'
import {
  fetchStaffRoster,
  fetchWorkSites,
  fetchAllTimeEntries,
  approveTimeEntry,
  setStaffActive,
  computeEntryPay,
  workSiteStatus,
} from '../lib/staff'
import { PeriodTabs, PeriodTab } from './PeriodTabs'
import StaffWorkSitesForm from './StaffWorkSitesForm'
import StaffPayrollExport from './StaffPayrollExport'
import StaffProfileForm from './StaffProfileForm'
import StaffLocationsManager from './StaffLocationsManager'

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
]

function money(n) {
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
}

function formatDuration(entry) {
  if (!entry.clock_out_at) return 'in progress'
  const hours = (new Date(entry.clock_out_at) - new Date(entry.clock_in_at)) / 3_600_000
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return `${h}h ${m}m`
}

// The admin dashboard — Ada and Aaron both reach this the same way,
// through TaskBoard.jsx's own "staff" tab, same as every other tab.
// Self-contained like RentalsView.jsx/CorkBoardView.jsx (fetches its
// own data, just `me` as a prop) rather than wired through TaskBoard's
// shared tasks-changes/members-changes channels.
export default function StaffLogsView({ me }) {
  const [roster, setRoster] = useState([])
  const [sites, setSites] = useState([])
  const [rentalProperties, setRentalProperties] = useState([])
  const [entries, setEntries] = useState([])
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [approvingId, setApprovingId] = useState(null)
  const [editingSite, setEditingSite] = useState(null)
  const [addingSite, setAddingSite] = useState(false)
  const [locationsOpen, setLocationsOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [editingStaff, setEditingStaff] = useState(null)

  async function reloadEntries() {
    try {
      setEntries(await fetchAllTimeEntries({ status: statusFilter === 'all' ? undefined : statusFilter }))
    } catch (err) {
      setError(err.message)
    }
  }

  async function reloadAll() {
    try {
      const [rosterData, sitesData, awaProperties, azuProperties] = await Promise.all([
        fetchStaffRoster(),
        fetchWorkSites(),
        fetchRentalProperties('awa'),
        fetchRentalProperties('azu'),
      ])
      setRoster(rosterData)
      setSites(sitesData)
      setRentalProperties(
        [...awaProperties, ...azuProperties].sort((a, b) =>
          `${a.company}-${a.unit_name}`.localeCompare(`${b.company}-${b.unit_name}`),
        ),
      )
      await reloadEntries()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reloadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    reloadEntries()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  // Requires `alter publication supabase_realtime add table time_entries;`
  // to be run by hand — see the deployment note in schema.sql.
  useEffect(() => {
    const channel = supabase
      .channel('staff-time-entries-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries' }, reloadEntries)
      .subscribe()
    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  async function handleApprove(entryId) {
    setApprovingId(entryId)
    try {
      await approveTimeEntry(entryId, me.id)
      await reloadEntries()
    } catch (err) {
      setError(err.message)
    } finally {
      setApprovingId(null)
    }
  }

  async function handleToggleActive(staffMember) {
    try {
      await setStaffActive(staffMember.id, !staffMember.active)
      setRoster(await fetchStaffRoster())
    } catch (err) {
      setError(err.message)
    }
  }

  const totalPay = entries.reduce((sum, e) => sum + (computeEntryPay(e) || 0), 0)
  // workSiteStatus() (src/lib/staff.js) is the single source of truth for
  // this now — was duplicated inline here and in StaffLocationsManager.jsx's
  // own StatusBadge, a real drift risk once a 4th state (a pending on-site
  // capture) existed to keep in sync between the two.
  const readyLocationCount = sites.filter((site) => workSiteStatus(site) === 'ready').length
  const pendingApprovalCount = sites.filter((site) => workSiteStatus(site) === 'pendingApproval').length
  const locationNeedsSetupCount = sites.filter((site) => workSiteStatus(site) === 'needsSetup').length
  const unassignedUnitCount = rentalProperties.filter((property) => !property.work_site_id).length

  if (loading) return <p className="loading">Loading…</p>

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="error">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* flex-1: PeriodTabs has no width of its own to fill (unlike
            TaskBoard.jsx's view-mode-row usage, this row's other sibling
            is a fixed-width button group, not another flex-1 element) —
            without it, each PeriodTab (px-0 by design, sized purely by
            flex-1 within PeriodTabs' own intrinsic content width) had
            almost no room to breathe, reading as "AllPendingApproved"
            packed together. */}
        <PeriodTabs className="min-w-0 flex-1">
          {STATUS_TABS.map((t) => (
            <PeriodTab key={t.key} active={statusFilter === t.key} onClick={() => setStatusFilter(t.key)}>
              {t.label}
            </PeriodTab>
          ))}
        </PeriodTabs>
        <div className="flex flex-none gap-1.5">
          <button
            type="button"
            className="cursor-pointer whitespace-nowrap rounded-sm border border-border bg-pill-bg px-2 py-1 text-xs text-text-h"
            onClick={() => setLocationsOpen(true)}
          >
            <MapPin size={12} className="mr-1 inline align-[-2px]" /> Locations
          </button>
          <button
            type="button"
            className="cursor-pointer whitespace-nowrap rounded-sm border border-border bg-pill-bg px-2 py-1 text-xs text-text-h"
            onClick={() => setExportOpen(true)}
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="flex justify-between rounded-[8px] border border-border bg-card-bg px-4 py-3 text-sm">
        <span>Total ({statusFilter})</span>
        <span className="font-semibold">{money(totalPay)}</span>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[12px] border border-dashed border-border bg-card-bg px-5 py-8 text-center">
          <Clock3 size={26} className="text-accent opacity-90" />
          <div>
            <h2 className="text-base font-semibold text-text-h">No shifts recorded yet</h2>
            <p className="mt-1 text-sm opacity-65">
              {readyLocationCount > 0
                ? 'Clock-in is ready. Shifts will appear here after the property manager starts tracking time.'
                : 'Configure at least one property for clock-in, then the property manager can begin tracking time.'}
            </p>
          </div>
          <button
            type="button"
            className="cursor-pointer rounded-sm border border-accent bg-accent px-3.5 py-2 text-sm font-semibold text-white"
            onClick={() => setLocationsOpen(true)}
          >
            {readyLocationCount > 0 ? 'Manage clock-in locations' : 'Set up clock-in locations'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((e) => (
            <div key={e.id} className="flex min-w-0 flex-col gap-1 rounded-[8px] border border-border px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-text-h">{e.staff?.display_name}</span>
                <span className={e.status === 'approved' ? 'text-online' : 'opacity-60'}>{e.status}</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 opacity-80">
                <span className="min-w-0">
                  {e.work_sites?.name} — {new Date(e.clock_in_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  {e.flagged && (
                    <span className="text-overdue">
                      {' '}
                      <AlertTriangle size={12} className="inline align-[-1px]" /> outside geofence
                    </span>
                  )}
                </span>
                <span>{formatDuration(e)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs opacity-60">
                  {e.rate_type} — ${e.rate_amount}/hr
                </span>
                <div className="flex items-center gap-2">
                  <span>{e.clock_out_at ? money(computeEntryPay(e)) : '—'}</span>
                  {e.status === 'pending' && e.clock_out_at && (
                    <button
                      type="button"
                      className="cursor-pointer rounded-sm border-0 bg-accent px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                      onClick={() => handleApprove(e.id)}
                      disabled={approvingId === e.id}
                    >
                      {approvingId === e.id ? 'Approving…' : 'Approve'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-[13px] opacity-60">Staff roster</h3>
        {roster.map((s) => (
          <div key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-sm border border-border px-3 py-2 text-sm">
            <span className="min-w-0">
              <strong className="block truncate font-semibold text-text-h">{s.display_name}</strong>
              <span className="text-xs opacity-65">${s.hourly_rate}/hr · ${s.emergency_rate}/hr emergency</span>
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                className="cursor-pointer rounded-sm border border-border bg-pill-bg px-2.5 py-1 text-xs text-text-h"
                onClick={() => setEditingStaff(s)}
              >
                Edit
              </button>
              <button
                type="button"
                className="cursor-pointer rounded-sm border border-border bg-pill-bg px-2.5 py-1 text-xs text-text-h"
                onClick={() => handleToggleActive(s)}
              >
                {s.active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[8px] border border-border px-3 py-3 text-sm">
        <div className="min-w-0">
          <h3 className="font-semibold text-text-h">Clock-in locations</h3>
          <p className="mt-0.5 text-xs opacity-65">
            {readyLocationCount} ready
            {pendingApprovalCount > 0 ? ` · ${pendingApprovalCount} awaiting approval` : ''}
            {locationNeedsSetupCount > 0 ? ` · ${locationNeedsSetupCount} ${locationNeedsSetupCount === 1 ? 'location needs' : 'locations need'} setup` : ''}
            {unassignedUnitCount > 0 ? ` · ${unassignedUnitCount} unassigned ${unassignedUnitCount === 1 ? 'unit' : 'units'}` : ''}
          </p>
        </div>
        <button
          type="button"
          className="cursor-pointer rounded-sm border border-border bg-pill-bg px-2.5 py-1 text-xs text-text-h"
          onClick={() => setLocationsOpen(true)}
        >
          Manage
        </button>
      </div>

      {locationsOpen && (
        <StaffLocationsManager
          properties={rentalProperties}
          sites={sites}
          onClose={() => setLocationsOpen(false)}
          onEditSite={(site) => {
            setLocationsOpen(false)
            setEditingSite(site)
          }}
          onAddLocation={() => {
            setLocationsOpen(false)
            setAddingSite(true)
          }}
        />
      )}

      {(addingSite || editingSite) && (
        <StaffWorkSitesForm
          site={editingSite}
          rentalProperties={rentalProperties}
          onClose={() => {
            setAddingSite(false)
            setEditingSite(null)
          }}
          onSaved={async () => {
            setAddingSite(false)
            setEditingSite(null)
            const [siteData, awaProperties, azuProperties] = await Promise.all([
              fetchWorkSites(),
              fetchRentalProperties('awa'),
              fetchRentalProperties('azu'),
            ])
            setSites(siteData)
            setRentalProperties([...awaProperties, ...azuProperties])
          }}
          onArchived={async () => {
            setEditingSite(null)
            setSites(await fetchWorkSites())
          }}
        />
      )}

      {exportOpen && <StaffPayrollExport entries={entries} onClose={() => setExportOpen(false)} />}

      {editingStaff && (
        <StaffProfileForm
          staffMember={editingStaff}
          onClose={() => setEditingStaff(null)}
          onSaved={(saved) => {
            setRoster((current) => current.map((member) => (member.id === saved.id ? saved : member)))
            setEditingStaff(null)
          }}
        />
      )}
    </div>
  )
}

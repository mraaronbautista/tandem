import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchRentalProperties } from '../lib/rentals'
import {
  fetchStaffRoster,
  fetchWorkSites,
  fetchAllTimeEntries,
  approveTimeEntry,
  setStaffActive,
  computeEntryPay,
} from '../lib/staff'
import { PeriodTabs, PeriodTab } from './PeriodTabs'
import StaffWorkSitesForm from './StaffWorkSitesForm'
import StaffPayrollExport from './StaffPayrollExport'

const COMPANY = 'awa'
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
  const [exportOpen, setExportOpen] = useState(false)

  async function reloadEntries() {
    try {
      setEntries(await fetchAllTimeEntries({ status: statusFilter === 'all' ? undefined : statusFilter }))
    } catch (err) {
      setError(err.message)
    }
  }

  async function reloadAll() {
    try {
      const [rosterData, sitesData, rentalPropertiesData] = await Promise.all([
        fetchStaffRoster(),
        fetchWorkSites(),
        fetchRentalProperties(COMPANY),
      ])
      setRoster(rosterData)
      setSites(sitesData)
      setRentalProperties(rentalPropertiesData)
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

  if (loading) return <p className="loading">Loading…</p>

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="error">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <PeriodTabs>
          {STATUS_TABS.map((t) => (
            <PeriodTab key={t.key} active={statusFilter === t.key} onClick={() => setStatusFilter(t.key)}>
              {t.label}
            </PeriodTab>
          ))}
        </PeriodTabs>
        <div className="flex gap-2">
          <button
            type="button"
            className="cursor-pointer rounded-sm border border-border bg-pill-bg px-3 py-1.5 text-sm text-text-h"
            onClick={() => setAddingSite(true)}
          >
            + Add site
          </button>
          <button
            type="button"
            className="cursor-pointer rounded-sm border border-border bg-pill-bg px-3 py-1.5 text-sm text-text-h"
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
        <p className="empty">No time entries yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((e) => (
            <div key={e.id} className="flex flex-col gap-1 rounded-[8px] border border-border px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-text-h">{e.staff?.display_name}</span>
                <span className={e.status === 'approved' ? 'text-online' : 'opacity-60'}>{e.status}</span>
              </div>
              <div className="flex items-center justify-between opacity-80">
                <span>
                  {e.work_sites?.name} — {new Date(e.clock_in_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  {e.flagged && <span className="text-overdue"> ⚠ outside geofence</span>}
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
          <div key={s.id} className="flex items-center justify-between rounded-sm border border-border px-3 py-2 text-sm">
            <span>
              {s.display_name} — ${s.hourly_rate}/hr (${s.emergency_rate}/hr emergency)
            </span>
            <button
              type="button"
              className="cursor-pointer rounded-sm border border-border bg-pill-bg px-2.5 py-1 text-xs text-text-h"
              onClick={() => handleToggleActive(s)}
            >
              {s.active ? 'Deactivate' : 'Reactivate'}
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-[13px] opacity-60">Work sites</h3>
        {sites.map((s) => (
          <button
            key={s.id}
            type="button"
            className="cursor-pointer rounded-sm border border-border px-3 py-2 text-left text-sm text-text-h"
            onClick={() => setEditingSite(s)}
          >
            {s.name} {!s.active && '(inactive)'}
          </button>
        ))}
      </div>

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
            setSites(await fetchWorkSites())
          }}
          onArchived={async () => {
            setEditingSite(null)
            setSites(await fetchWorkSites())
          }}
        />
      )}

      {exportOpen && <StaffPayrollExport entries={entries} onClose={() => setExportOpen(false)} />}
    </div>
  )
}

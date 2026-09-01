import { Building2, CircleCheck, MapPin, Plus } from 'lucide-react'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

const COMPANY_LABEL = { awa: 'Awa', azu: 'Azu' }

function StatusBadge({ site }) {
  const ready = site.active && site.latitude != null && site.longitude != null
  const needsSetup = site.latitude == null || site.longitude == null
  const label = ready ? 'Ready' : needsSetup ? 'Needs setup' : 'Inactive'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        ready ? 'bg-[color-mix(in_srgb,var(--online)_14%,transparent)] text-online' : 'bg-pill-bg text-text'
      }`}
    >
      {ready && <CircleCheck size={11} />}
      {label}
    </span>
  )
}

function UnitList({ properties }) {
  if (!properties.length) return <span className="text-xs opacity-55">No rental units linked</span>
  return (
    <span className="text-xs opacity-65">
      {properties.map((property) => `${COMPANY_LABEL[property.company]} · ${property.unit_name}`).join(' · ')}
    </span>
  )
}

export default function StaffLocationsManager({ properties, sites, onEditSite, onAddLocation, onClose }) {
  const unassignedProperties = properties.filter((property) => !property.work_site_id)

  return (
    <Modal onClose={onClose}>
      <ModalCard>
        <h2>Clock-in locations</h2>
        <p className="text-sm opacity-70">
          Group rental units by physical place. Staff clocks into Rachel or Parkside—not an individual unit.
        </p>

        <div className="flex max-h-[52vh] flex-col gap-2 overflow-y-auto pr-0.5">
          {sites.map((site) => {
            const linkedProperties = properties.filter((property) => property.work_site_id === site.id)
            return (
              <button
                key={site.id}
                type="button"
                className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[8px] border border-border px-3 py-2.5 text-left"
                onClick={() => onEditSite(site)}
              >
                <MapPin size={16} className="opacity-60" />
                <span className="min-w-0">
                  <strong className="block truncate text-sm font-semibold text-text-h">{site.name}</strong>
                  <span className="block truncate"><UnitList properties={linkedProperties} /></span>
                </span>
                <StatusBadge site={site} />
              </button>
            )
          })}

          {sites.length === 0 && (
            <p className="rounded-[8px] border border-dashed border-border p-4 text-center text-sm opacity-65">
              Create Rachel, Parkside, or another physical location to begin.
            </p>
          )}

          {unassignedProperties.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              <h3 className="text-[13px] opacity-60">Units needing a physical location</h3>
              {unassignedProperties.map((property) => (
                <div
                  key={property.id}
                  className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-[8px] border border-border px-3 py-2.5"
                >
                  <Building2 size={15} className="opacity-60" />
                  <span className="min-w-0">
                    <strong className="block truncate text-sm font-medium text-text-h">{property.unit_name}</strong>
                    <span className="block truncate text-xs opacity-60">{COMPANY_LABEL[property.company]} Rentalz</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <SubmissionActions className="justify-between">
          <SubmissionButton onClick={onAddLocation}>
            <Plus size={14} className="mr-1 inline align-[-2px]" /> Add physical location
          </SubmissionButton>
          <SubmissionButton variant="primary" onClick={onClose}>Done</SubmissionButton>
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

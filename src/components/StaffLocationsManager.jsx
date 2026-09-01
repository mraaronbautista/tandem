import { Building2, CircleCheck, MapPin, Plus } from 'lucide-react'
import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'

const COMPANY_LABEL = { awa: 'Awa Rentalz', azu: 'Azu Rentals' }

function StatusBadge({ state }) {
  const ready = state === 'ready'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        ready ? 'bg-[color-mix(in_srgb,var(--online)_14%,transparent)] text-online' : 'bg-pill-bg text-text'
      }`}
    >
      {ready && <CircleCheck size={11} />}
      {ready ? 'Ready' : state === 'inactive' ? 'Inactive' : 'Needs setup'}
    </span>
  )
}

export default function StaffLocationsManager({ properties, sites, onConfigureProperty, onEditSite, onAddOther, onClose }) {
  const linkedSiteByProperty = new Map(sites.filter((site) => site.rental_property_id).map((site) => [site.rental_property_id, site]))
  const otherSites = sites.filter((site) => !site.rental_property_id)

  return (
    <Modal onClose={onClose}>
      <ModalCard>
        <h2>Clock-in locations</h2>
        <p className="text-sm opacity-70">
          Rental properties are already listed here. Configure only the places where the property manager will work.
        </p>

        <div className="flex max-h-[52vh] flex-col gap-2 overflow-y-auto pr-0.5">
          {properties.map((property) => {
            const site = linkedSiteByProperty.get(property.id)
            const state = !site ? 'needs_setup' : site.active ? 'ready' : 'inactive'
            return (
              <div
                key={property.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[8px] border border-border px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <Building2 size={15} className="flex-none opacity-60" />
                    <strong className="truncate text-sm font-semibold text-text-h">{property.unit_name}</strong>
                  </div>
                  <p className="mt-0.5 truncate pl-[23px] text-xs opacity-60">
                    {COMPANY_LABEL[property.company]}{property.address ? ` · ${property.address}` : ''}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <StatusBadge state={state} />
                  <button
                    type="button"
                    className="cursor-pointer rounded-sm border border-border bg-pill-bg px-2.5 py-1 text-xs text-text-h"
                    onClick={() => (site ? onEditSite(site) : onConfigureProperty(property))}
                  >
                    {site ? 'Edit' : 'Configure'}
                  </button>
                </div>
              </div>
            )
          })}

          {properties.length === 0 && <p className="rounded-[8px] border border-dashed border-border p-4 text-center text-sm opacity-65">No active rental properties found.</p>}

          {otherSites.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              <h3 className="text-[13px] opacity-60">Other locations</h3>
              {otherSites.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[8px] border border-border px-3 py-2.5 text-left"
                  onClick={() => onEditSite(site)}
                >
                  <MapPin size={15} className="opacity-60" />
                  <span className="truncate text-sm font-medium text-text-h">{site.name}</span>
                  <StatusBadge state={site.active ? 'ready' : 'inactive'} />
                </button>
              ))}
            </div>
          )}
        </div>

        <SubmissionActions className="justify-between">
          <SubmissionButton onClick={onAddOther}>
            <Plus size={14} className="mr-1 inline align-[-2px]" /> Add other location
          </SubmissionButton>
          <SubmissionButton variant="primary" onClick={onClose}>Done</SubmissionButton>
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

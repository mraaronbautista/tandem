import Modal from './Modal'
import ModalCard from './ModalCard'
import { SubmissionActions, SubmissionButton } from './SubmissionActions'
import { computeEntryPay } from '../lib/staff'

// Same csvEscape/buildCsv/Blob-download mechanics as VaultExportForm.jsx
// — duplicated locally rather than extracted to a shared module,
// matching this codebase's own established preference for small local
// duplication over cross-file sharing of a handful of helper lines
// (e.g. buildWeeks() is independently duplicated between MonthView.jsx
// and RentalCalendar.jsx). Deliberately WITHOUT VaultExportForm's typed-
// EXPORT-confirmation gate — that exists specifically because the vault
// export leaks raw passwords; names/hours/pay don't carry that same
// risk class, so a plain export button is proportionate.
function csvEscape(value) {
  let s = String(value ?? '')
  if (/^[=+\-@]/.test(s)) s = `'${s}`
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function buildCsv(entries) {
  const header = ['Staff', 'Site', 'Clock in', 'Clock out', 'Hours', 'Rate type', 'Rate', 'Pay', 'Status', 'Flagged']
  const rows = entries.map((e) => {
    const pay = computeEntryPay(e)
    const hours = e.clock_out_at ? (new Date(e.clock_out_at) - new Date(e.clock_in_at)) / 3_600_000 : ''
    return [
      e.staff?.display_name,
      e.work_sites?.name,
      new Date(e.clock_in_at).toLocaleString(),
      e.clock_out_at ? new Date(e.clock_out_at).toLocaleString() : '',
      hours === '' ? '' : hours.toFixed(2),
      e.rate_type,
      e.rate_amount,
      pay === null ? '' : pay.toFixed(2),
      e.status,
      e.flagged ? 'yes' : 'no',
    ]
      .map(csvEscape)
      .join(',')
  })
  return [header.join(','), ...rows].join('\n')
}

// periodDates: [start, end] Date pair for the active payroll period, or null
// when "Show all time" is on — drives the filename so a payroll CSV is
// named by the pay period it actually covers, more useful for
// recordkeeping than just today's export date.
export default function StaffPayrollExport({ entries, periodLabel, periodDates, onClose }) {
  function handleExport() {
    const csv = buildCsv(entries)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const filenameDate = periodDates
      ? `${periodDates[0].toISOString().slice(0, 10)}-to-${periodDates[1].toISOString().slice(0, 10)}`
      : new Date().toISOString().slice(0, 10)
    a.download = `tandem-staff-hours-${filenameDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
    onClose()
  }

  return (
    <Modal onClose={onClose}>
      <ModalCard>
        <h2>Export staff hours</h2>

        <p>
          Downloads a CSV of the {entries.length} entr{entries.length === 1 ? 'y' : 'ies'} currently shown (matching
          the active status filter and {periodLabel || 'all time'}) — staff name, site, clock in/out, hours, rate,
          pay, and approval status.
        </p>

        <SubmissionActions>
          <SubmissionButton onClick={onClose}>Cancel</SubmissionButton>
          <SubmissionButton variant="primary" onClick={handleExport} disabled={entries.length === 0}>
            Download CSV
          </SubmissionButton>
        </SubmissionActions>
      </ModalCard>
    </Modal>
  )
}

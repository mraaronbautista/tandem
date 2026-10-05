import { supabase } from './supabaseClient'
import { fetchAccessibleVaults, fetchVaultMeta, unlockVault, decryptJSON } from './vault'

// Only user records: no task tables, credentials, push subscriptions or access grants.
export const EXPORT_GROUPS = {
  Rentals: [
    ['Rental units', 'rental_properties', 'id,company,term,unit_name,address,monthly_rent,color,active,in_negotiation,work_site_id,created_at', ['id']],
    ['Leases and bookings', 'rental_bookings', 'id,property_id,guest_name,guest_names,check_in,check_out,status,source,source_note,notes,paid_charges,created_by,created_at', ['id']],
    ['Expenses', 'rental_expenses', 'id,company,label,amount,created_at', ['id']],
    ['Savings goals', 'rental_savings_goal', 'id,company,label,target_amount,saved_amount,updated_at', ['id']],
    ['Lease notes', 'rental_lease_notes', 'id,property_id,booking_id,unit_name,tenant_label,lease_start,lease_end,created_by,author_name,body,archived,created_at,updated_at,edited_at', ['id']],
  ],
  Contacts: [
    ['Contacts', 'rental_contacts', 'id,kind,name,organization,trade,phone,phone_alt,email,notes,active,created_by,created_at,updated_at', ['id']],
    ['Unit contact coverage', 'rental_contact_links', 'contact_id,property_id,role', ['contact_id', 'property_id']],
    ['Location contact coverage', 'rental_contact_location_links', 'contact_id,work_site_id,role', ['contact_id', 'work_site_id']],
  ],
  Reports: [['Reports', 'eod_reports', 'id,submitted_by,period,report_date,minutes_logged,body,created_at,updated_at', ['id']]],
  Priorities: [['Priorities', 'priorities', 'id,set_by,period,body,created_at', ['id']]],
  Board: [['Board pins', 'cork_notes', 'id,author_id,body,shared_with,comments,created_at,archived,archived_task_id,roadmap_items', ['id']], ['Board projects', 'cork_notes', 'id,author_id,body,shared_with,comments,created_at,archived,archived_task_id,roadmap_items', ['id']]],
  Staff: [
    ['Staff', 'staff', 'id,display_name,hourly_rate,emergency_rate,job_description,payroll_cadence,active,created_at', ['id']], ['Locations', 'work_sites', 'id,name,address,latitude,longitude,geofence_radius_m,rental_property_id,active,created_at', ['id']],
    ['Time entries', 'time_entries', 'id,staff_id,work_site_id,rate_type,rate_amount,clock_in_at,clock_in_lat,clock_in_lng,clock_in_accuracy_m,distance_from_site_m,flagged,clock_out_at,clock_out_lat,clock_out_lng,status,approved_by,approved_at,notes,created_at', ['id']], ['Correction requests', 'time_entry_requests', 'id,staff_id,time_entry_id,note,status,resolved_by,resolved_at,created_at', ['id']],
  ],
  Team: [
    ['Team members', 'members', 'id,display_name,color,default_timezone,permissions,is_admin', ['id']],
    ['Working status', 'members', 'id,display_name,working_since,working_status,working_status_until', ['id']],
    ['Person nudges', 'member_nudges', 'id,sender_id,target_id,created_at', ['id']],
    ['External tools', 'external_tools', 'id,title,url', ['id']],
  ],
}
export function allowedGroups(me) {
  if (!me || me.role === 'staff') return []
  return Object.keys(EXPORT_GROUPS).filter(g => !['Rentals', 'Contacts', 'Staff'].includes(g) || me.permissions?.[g === 'Contacts' ? 'rentals' : g.toLowerCase()] !== false)
}
export async function readPages(table, columns, keys = ['id'], client = supabase, filter) {
  const rows = []
  for (let offset = 0; ; offset += 500) {
    let query = client.from(table).select(columns)
    for (const key of keys) query = query.order(key, { ascending: true })
    if (filter) query = query.eq(filter[0], filter[1])
    const { data, error } = await query.range(offset, offset + 499)
    if (error) throw new Error(`Could not export ${table}. ${error.message || 'Try again.'}`)
    if (!Array.isArray(data)) throw new Error(`No response while exporting ${table}.`)
    rows.push(...data)
    if (data.length < 500) return rows
  }
}
function cleanBoard(row) {
  const { archived_task_id: _archivedTaskId, roadmap_items, ...rest } = row
  // Board milestone text is retained; task references/state are excluded.
  return { ...rest, roadmap_items: (roadmap_items || []).map(({ task_id: _taskId, taskId: _taskIdCamel, ...item }) => item) }
}
export async function collectExport(groups, me, includeArchived = false) {
  const permitted = allowedGroups(me)
  if (groups.some(g => !permitted.includes(g))) throw new Error('This export includes an unavailable section.')
  const result = []
  const cache = new Map()
  for (const group of groups) {
    for (const [name, table, columns, keys] of EXPORT_GROUPS[group]) {
      const cacheKey = `${table}:${columns}`
      if (!cache.has(cacheKey)) cache.set(cacheKey, await readPages(table, columns, keys))
      let rows = cache.get(cacheKey)
      if (!includeArchived) rows = rows.filter(r => r.active !== false && r.archived !== true)
      if (group === 'Board') {
        rows = rows.filter(r => !r.archived_task_id)
        rows = rows.filter(r => name === 'Board projects' ? (r.roadmap_items?.length > 0) : !r.roadmap_items?.length).map(cleanBoard)
      }
      result.push({ name, rows, columns: columns === '*' ? Object.keys(rows[0] || {}) : columns.split(',') })
    }
  }
  if (groups.includes('Contacts') && !groups.includes('Rentals')) {
    cache.set('unitNames', await readPages('rental_properties', 'id,unit_name,company,work_site_id'))
  }
  let locationNames = []
  if (groups.includes('Contacts') || groups.includes('Rentals')) {
    const { data, error } = await supabase.rpc('get_rental_locations')
    if (error) throw new Error('Could not load rental location names. No file was downloaded.')
    locationNames = data || []
  }
  // Readable names accompany stable IDs without accessing any task data.
  const units = result.find(s => s.name === 'Rental units')?.rows || cache.get('unitNames') || []
  const contacts = result.find(s => s.name === 'Contacts')?.rows || []
  const members = result.find(s => s.name === 'Team members')?.rows || []
  for (const sheet of result) {
    sheet.rows = sheet.rows.map(row => ({ ...row,
      ...(row.work_site_id && locationNames.some(l => l.id === row.work_site_id) ? { location: locationNames.find(l => l.id === row.work_site_id).name } : {}),
      ...(row.property_id && units.some(u => u.id === row.property_id) ? { unit: units.find(u => u.id === row.property_id).unit_name, company: units.find(u => u.id === row.property_id).company } : {}),
      ...(row.contact_id && contacts.some(c => c.id === row.contact_id) ? { contact_name: contacts.find(c => c.id === row.contact_id).name } : {}),
      ...((row.submitted_by || row.set_by || row.author_id) && members.some(m => m.id === (row.submitted_by || row.set_by || row.author_id)) ? { author: members.find(m => m.id === (row.submitted_by || row.set_by || row.author_id)).display_name } : {}),
    }))
    sheet.columns = [...new Set([...sheet.columns.filter(c => !['archived_task_id'].includes(c)), ...sheet.rows.flatMap(r => Object.keys(r))])]
    if (!sheet.columns.length) sheet.columns = ['Record ID']
  }
  return result
}
export async function collectVault(passwords) {
  const vaults = await fetchAccessibleVaults()
  if (!vaults.length) throw new Error('No accessible Vault is available.')
  const rows = []
  for (const vault of vaults) {
    if (!passwords[vault.id]) throw new Error(`Enter the master password for ${vault.name}.`)
    const meta = await fetchVaultMeta(vault.id)
    if (!meta) throw new Error(`${vault.name} has not been set up.`)
    const key = await unlockVault(passwords[vault.id], meta)
    const encrypted = await readPages('vault_entries', 'id,ciphertext,iv,created_at,updated_at', ['id'], supabase, ['vault_id', vault.id])
    for (const row of encrypted) {
      const entry = await decryptJSON(key, row.ciphertext, row.iv)
      rows.push({ vault: vault.name, id: row.id, folder: entry.folder || '', label: entry.label || '', username: entry.username || '', login_method: entry.loginMethod || '', password: entry.password || '', url: entry.url || '', notes: entry.notes || '', authenticator: entry.totp || '', created_at: row.created_at, updated_at: row.updated_at })
    }
  }
  return { name: 'Vault', rows, columns: ['vault','id','folder','label','username','login_method','password','url','notes','authenticator','created_at','updated_at'] }
}
export function cellValue(value) {
  const result = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : value
  if (String(result).length > 32767) throw new Error('A record exceeds Excel’s cell limit. No file was downloaded; shorten that record before exporting.')
  return result
}
export function csvText(sheet) {
  const escape = value => {
    let text = String(cellValue(value))
    if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`
    return `"${text.replaceAll('"', '""')}"`
  }
  return '\uFEFF' + [sheet.columns, ...sheet.rows.map(r => sheet.columns.map(c => r[c]))].map(row => row.map(escape).join(',')).join('\r\n')
}
export async function workbookBlob(sheets) {
  const { default: writeXlsx } = await import('write-excel-file/universal')
  const info = { name: 'Export summary', columns: ['Sheet', 'Records'], rows: sheets.map(s => ({ Sheet: s.name, Records: s.rows.length })) }
  const all = [info, ...sheets]
  if (all.some(s => s.rows.length > 1048575)) throw new Error('Too many rows for one Excel sheet.')
  const data = all.map(s => [s.columns.map(c => ({ value: c.replaceAll('_',' '), type: String, fontWeight: 'bold', backgroundColor: '#EEDDC8' })), ...s.rows.map(row => s.columns.map(c => {
    const v = cellValue(row[c]); return { value: v, type: typeof v === 'number' ? Number : typeof v === 'boolean' ? Boolean : String, wrap: true }
  }))])
  return writeXlsx(all.map((s, i) => ({ data: data[i], sheet: s.name, columns: s.columns.map(() => ({ width: 24 })), stickyRowsCount: 1 })), { fontFamily: 'Arial', fontSize: 11 }).toBlob()
}
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

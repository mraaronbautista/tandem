// Google CSV is quoted CSV: notes can contain commas, quotes and newlines.
export function parseGoogleContacts(text) {
  const table = []
  let row = [], cell = '', quoted = false
  text = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++ }
      else if (quoted || !cell) quoted = !quoted
      else throw new Error('The CSV has an unexpected quote. Export it again from Google Contacts.')
    } else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      row.push(cell); cell = ''
      if (c !== ',') {
        if (row.some((value) => value.trim())) table.push(row)
        row = []
        if (c === '\r' && text[i + 1] === '\n') i++
      }
    } else cell += c
  }
  if (quoted) throw new Error('The CSV has an unfinished quoted field.')
  row.push(cell)
  if (row.some((value) => value.trim())) table.push(row)
  const headers = table.shift()?.map((header) => header.trim()) || []
  if (!headers.includes('First Name') && !headers.includes('Name')) throw new Error('Choose a Google Contacts CSV export, rather than an Outlook CSV or vCard.')
  if (!table.length) throw new Error('This file has no contacts.')
  if (table.length > 500) throw new Error('Import up to 500 contacts at a time.')
  return table.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`Row ${index + 2} has a different number of columns. Export the CSV again.`)
    const source = Object.fromEntries(headers.map((key, i) => [key, values[i].trim()]))
    const multiple = (pattern) => headers.filter((key) => pattern.test(key)).flatMap((key) => (source[key] || '').split(/\s*:::\s*/)).filter(Boolean)
    const phones = multiple(/^Phone \d+ - Value$/)
    const emails = multiple(/^E-mail \d+ - Value$/)
    const name = [source['Name Prefix'], source['First Name'], source['Middle Name'], source['Last Name'], source['Name Suffix']].filter(Boolean).join(' ') || source.Name || source['Organization Name'] || ''
    const notes = [source.Notes, phones.length > 2 && `Other phone numbers: ${phones.slice(2).join('; ')}`, emails.length > 1 && `Other emails: ${emails.slice(1).join('; ')}`].filter(Boolean).join('\n\n')
    return { key: index, name, kind: 'other', phone: phones[0] || '', phone_alt: phones[1] || '', email: emails[0] || '', organization: source['Organization Name'] || '', trade: source['Organization Title'] || '', notes, link: '', selected: Boolean(name), status: '', error: '' }
  })
}
export function contactPhoneKey(value = '') {
  const digits = value.replace(/\D/g, '')
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}
export function matchingContacts(row, contacts) {
  const phones = [row.phone, row.phone_alt].map(contactPhoneKey).filter((phone) => phone.length >= 7)
  const email = row.email.trim().toLowerCase()
  const name = row.name.trim().toLowerCase().replace(/\s+/g, ' ')
  return contacts.filter((contact) =>
    (name && contact.name.trim().toLowerCase().replace(/\s+/g, ' ') === name) ||
    (email && contact.email?.trim().toLowerCase() === email) ||
    [contact.phone, contact.phone_alt].some((phone) => phones.includes(contactPhoneKey(phone))),
  )
}
export function contactImportError(row) {
  if (!row.name.trim()) return 'Enter a name.'
  if (row.name.trim().length > 200) return 'Keep the name under 200 characters.'
  if (row.notes.length > 10000) return 'Keep notes under 10,000 characters.'
  if (['phone', 'phone_alt', 'email', 'organization', 'trade'].some((field) => row[field].length > 500)) return 'One of the contact fields is too long (maximum 500 characters).'
  return ''
}
export function contactImportPayload(row) {
  const details = Object.fromEntries(['name', 'kind', 'phone', 'phone_alt', 'email', 'organization', 'trade', 'notes'].map((field) => [field, row[field].trim()]))
  return { details, links: row.link.startsWith('unit:') ? [{ property_id: row.link.slice(5), role: row.trade.trim() }] : [], locationLinks: row.kind !== 'tenant' && row.link.startsWith('site:') ? [{ work_site_id: row.link.slice(5), role: row.trade.trim() }] : [] }
}

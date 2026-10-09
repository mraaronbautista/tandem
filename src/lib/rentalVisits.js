import { supabase } from './supabaseClient'

// Quick suggestions only. The type is free text; whatever has been typed
// before shows up as its own chip (see recentVisitKinds in unitTimeline.js).
export const VISIT_KIND_SUGGESTIONS = ['Cleaning', 'Repair', 'Inspection']

export async function fetchRentalVisits() {
  // Page so Supabase's default 1,000-row cap can never silently hide visits.
  const result = []
  for (let start = 0; ; start += 500) {
    const { data, error } = await supabase
      .from('rental_visits')
      .select('*')
      .order('visit_date', { ascending: true })
      .order('id', { ascending: true })
      .range(start, start + 499)
    if (error) throw error
    result.push(...data)
    if (data.length < 500) return result
  }
}

// `fields`: kind, visit_date, visit_time ('' or null for no time), who, note,
// contact_id, and EITHER property_id OR work_site_id. The database stamps
// created_by and done_at itself.
export async function saveRentalVisit(id, fields) {
  const row = {
    kind: fields.kind.trim(),
    visit_date: fields.visit_date,
    visit_time: fields.visit_time || null,
    who: (fields.who || '').trim(),
    note: (fields.note || '').trim(),
    contact_id: fields.contact_id || null,
    property_id: fields.property_id || null,
    work_site_id: fields.work_site_id || null,
  }
  const query = id
    ? supabase.from('rental_visits').update(row).eq('id', id)
    : supabase.from('rental_visits').insert(row)
  const { data, error } = await query.select().single()
  if (error) throw error
  return data
}

export async function setRentalVisitDone(id, done) {
  const { data, error } = await supabase
    .from('rental_visits')
    .update({ status: done ? 'done' : 'scheduled' })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteRentalVisit(id) {
  const { error } = await supabase.from('rental_visits').delete().eq('id', id)
  if (error) throw error
}

import { supabase } from './supabaseClient'

const REPORT_COLUMNS = 'id, submitted_by, period, report_date, hours_logged, body, created_at'

export async function createEodReport(submittedBy, { period = 'day', hoursLogged, body }) {
  const { data, error } = await supabase
    .from('eod_reports')
    .insert({ submitted_by: submittedBy, period, hours_logged: hoursLogged || null, body })
    .select(REPORT_COLUMNS)
    .single()
  if (error) throw error
  return data
}

export async function fetchEodReports() {
  const { data, error } = await supabase
    .from('eod_reports')
    .select(REPORT_COLUMNS)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

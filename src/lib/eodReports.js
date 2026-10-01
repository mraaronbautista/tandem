import { supabase } from './supabaseClient'

const REPORT_COLUMNS =
  'id, submitted_by, period, report_date, minutes_logged, body, attachments, created_at, updated_at'

// One row per (submitted_by, period, report_date) — appends bodyChunk to
// the existing row's body, appends attachments to the existing row's
// attachments array, and overwrites minutesLogged (not sums it) if a
// bucket already exists for this period, via the upsert_eod_report SQL
// function (plain .upsert() can't express "old body + new chunk").
export async function submitEodReport(period, reportDate, { bodyChunk, minutesLogged, attachments }) {
  const { data, error } = await supabase.rpc('upsert_eod_report', {
    p_period: period,
    p_report_date: reportDate,
    p_body_chunk: bodyChunk || null,
    p_minutes_logged: minutesLogged ?? null,
    p_attachments: attachments?.length ? attachments : [],
  })
  if (error) throw error
  return data
}

// The caller's own report for a given bucket, if one already exists —
// used to show read-only history and seed the "since last submission"
// tally when opening the form for a period already started today.
export async function fetchOwnEodReport(submittedBy, period, reportDate) {
  const { data, error } = await supabase
    .from('eod_reports')
    .select(REPORT_COLUMNS)
    .eq('submitted_by', submittedBy)
    .eq('period', period)
    .eq('report_date', reportDate)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function fetchEodReports() {
  const { data, error } = await supabase
    .from('eod_reports')
    .select(REPORT_COLUMNS)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data
}

// A plain overwrite, not upsert_eod_report's append-a-chunk RPC — that
// one exists specifically for a later session adding to a bucket that
// may not exist yet; this is fixing what's already there (a typo, a
// wrong number), on a row that definitely exists. RLS alone already
// scopes this to the caller's own report ("members can update own eod
// reports", submitted_by = auth.uid()) — no RPC needed just to enforce
// that, the same reasoning cork_notes' own author-only edit uses.
export async function updateEodReport(id, { body, minutesLogged }) {
  const { data, error } = await supabase
    .from('eod_reports')
    .update({ body, minutes_logged: minutesLogged, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(REPORT_COLUMNS)
    .single()
  if (error) throw error
  return data
}

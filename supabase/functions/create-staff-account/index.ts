// The second function invoked directly from the browser (see
// manual-notify) — Ada/Aaron creating a property-manager account from
// StaffProfileForm.jsx. Needs the service-role client throughout: staff.id
// references auth.users, and creating a new auth user (auth.admin.createUser)
// is a privileged operation the browser's own anon-key client can never
// perform, unlike every other staff write in this app (those are all plain
// RLS-gated client calls or member-authored RPCs against rows that already
// exist).
//
// Deployed with --no-verify-jwt for the same reason manual-notify is: the
// platform's own JWT check runs on the CORS preflight (OPTIONS) too, which
// never carries an Authorization header, so with verification on the
// preflight gets rejected before the real request goes out. That means the
// caller-is-a-member check below is not optional the way it might look —
// without it, --no-verify-jwt would let literally anyone with a network
// path to this URL create arbitrary staff accounts with a password of
// their choosing. This function is the one place in the app where getting
// that check wrong has real consequences beyond a UX bug.
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(async (req) => {
  const preflight = handleCors(req)
  if (preflight) return preflight

  // Client scoped to this request's own Authorization header (not the
  // service role) so auth.getUser() reflects the real caller's session —
  // same pattern manual-notify already establishes.
  const supabaseUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const {
    data: { user },
  } = await supabaseUser.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

  const { data: memberRow } = await supabaseAdmin.from('members').select('id').eq('id', user.id).maybeSingle()
  if (!memberRow) return new Response('Forbidden — members only', { status: 403, headers: corsHeaders })

  const { username, password, displayName, hourlyRate, emergencyRate, payrollCadence, jobDescription } = await req.json()
  const cleanUsername = String(username || '').trim().toLowerCase()
  const cleanDisplayName = String(displayName || '').trim()
  if (!cleanUsername || !cleanDisplayName) {
    return new Response('Missing username or display name', { status: 400, headers: corsHeaders })
  }
  if (!password || String(password).length < 8) {
    return new Response('Password must be at least 8 characters', { status: 400, headers: corsHeaders })
  }
  // Same @tandem.local placeholder-domain convention every real account in
  // this app already uses — see toLoginEmail() in Login.jsx. A duplicate
  // username surfaces naturally as a Supabase Auth "already registered"
  // error from createUser() below, since email is the real uniqueness
  // constraint underneath.
  const email = `${cleanUsername}@tandem.local`

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: String(password),
    email_confirm: true,
  })
  if (createError) return new Response(createError.message, { status: 400, headers: corsHeaders })

  // emergencyRate is optional — not every role works emergency shifts, so
  // '', null, or undefined all mean "no emergency rate," not 0
  // (stamp_time_entry_meta() in schema.sql refuses an 'emergency' clock-in
  // for a null rate rather than silently paying $0/hr for it).
  const cleanEmergencyRate = emergencyRate === '' || emergencyRate == null ? null : Number(emergencyRate)
  const { error: staffError } = await supabaseAdmin.from('staff').insert({
    id: created.user.id,
    display_name: cleanDisplayName,
    hourly_rate: Number(hourlyRate) || 0,
    emergency_rate: cleanEmergencyRate,
    job_description: jobDescription ? String(jobDescription).trim() || null : null,
    payroll_cadence: payrollCadence || 'biweekly',
    active: true,
  })
  if (staffError) {
    // Roll back the just-created auth user so a failed staff insert can't
    // leave an orphaned account — useAccountRole.js would otherwise
    // classify it 'blocked' forever, and it wouldn't show up in the
    // roster for a member to notice or fix.
    await supabaseAdmin.auth.admin.deleteUser(created.user.id)
    return new Response(staffError.message, { status: 400, headers: corsHeaders })
  }

  return new Response(JSON.stringify({ id: created.user.id, username: cleanUsername }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})

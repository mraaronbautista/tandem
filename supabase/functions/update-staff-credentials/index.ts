// Supersedes the earlier reset-staff-password function — Ada/Aaron
// changing a property manager's login username and/or password from
// StaffLogsView.jsx. Both need auth.admin.updateUserById(), a privileged
// operation the browser's own anon-key client can never perform, unlike
// every other staff write in this app (see create-staff-account for the
// same reasoning on account creation). Username changes exist specifically
// for account turnover — reassigning an existing staff row (rates, job
// description, time_entries history) to a new person rather than creating
// a fresh one and losing that continuity.
//
// Deployed with --no-verify-jwt for the same preflight-has-no-Authorization-
// header reason create-staff-account/manual-notify already document. The
// caller-is-a-member check below is what actually gates this, same as
// those two — without it, --no-verify-jwt would let anyone with a network
// path to this URL overwrite any account's login, staff or member.
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(async (req) => {
  const preflight = handleCors(req)
  if (preflight) return preflight

  const supabaseUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const {
    data: { user },
  } = await supabaseUser.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

  const { data: memberRow } = await supabaseAdmin.from('members').select('id').eq('id', user.id).maybeSingle()
  if (!memberRow) return new Response('Forbidden — members only', { status: 403, headers: corsHeaders })

  const { staffId, newUsername, newPassword } = await req.json()
  const cleanUsername = newUsername ? String(newUsername).trim().toLowerCase() : null
  if (cleanUsername === '') {
    return new Response('Username cannot be blank', { status: 400, headers: corsHeaders })
  }
  if (newPassword && String(newPassword).length < 8) {
    return new Response('Password must be at least 8 characters', { status: 400, headers: corsHeaders })
  }
  if (!cleanUsername && !newPassword) {
    return new Response('Nothing to update', { status: 400, headers: corsHeaders })
  }

  // Confirms staffId is actually a staff row, not just any auth.users id —
  // without this, a member could point this at their own or the other
  // member's account id and overwrite that login instead.
  const { data: staffRow } = await supabaseAdmin.from('staff').select('id').eq('id', staffId).maybeSingle()
  if (!staffRow) return new Response('Staff member not found', { status: 404, headers: corsHeaders })

  // Same @tandem.local placeholder-domain convention every real account
  // already uses — see toLoginEmail() in Login.jsx. A duplicate username
  // surfaces naturally as a Supabase Auth "already registered" error from
  // updateUserById() below, since email is the real uniqueness constraint
  // underneath.
  const attrs: { email?: string; password?: string; email_confirm?: boolean } = {}
  if (cleanUsername) {
    attrs.email = `${cleanUsername}@tandem.local`
    attrs.email_confirm = true
  }
  if (newPassword) attrs.password = String(newPassword)

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(staffId, attrs)
  if (updateError) return new Response(updateError.message, { status: 400, headers: corsHeaders })

  return new Response(JSON.stringify({ ok: true, username: cleanUsername }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})

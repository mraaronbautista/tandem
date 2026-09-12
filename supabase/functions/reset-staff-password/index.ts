// The third function invoked directly from the browser (alongside
// manual-notify and create-staff-account) — Ada/Aaron resetting a property
// manager's login password from StaffLogsView.jsx, for the same reason
// create-staff-account exists: auth.admin.updateUser() is a privileged
// operation the browser's own anon-key client can never perform, unlike
// every other staff write in this app.
//
// Deployed with --no-verify-jwt for the same preflight-has-no-Authorization-
// header reason create-staff-account/manual-notify already document. The
// caller-is-a-member check below is what actually gates this, same as
// those two — without it, --no-verify-jwt would let anyone with a network
// path to this URL overwrite any account's password, staff or member.
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

  const { staffId, newPassword } = await req.json()
  if (!newPassword || String(newPassword).length < 8) {
    return new Response('Password must be at least 8 characters', { status: 400, headers: corsHeaders })
  }

  // Confirms staffId is actually a staff row, not just any auth.users id —
  // without this, a member could point this at their own or the other
  // member's account id and overwrite that password instead.
  const { data: staffRow } = await supabaseAdmin.from('staff').select('id').eq('id', staffId).maybeSingle()
  if (!staffRow) return new Response('Staff member not found', { status: 404, headers: corsHeaders })

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(staffId, {
    password: String(newPassword),
  })
  if (updateError) return new Response(updateError.message, { status: 400, headers: corsHeaders })

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})

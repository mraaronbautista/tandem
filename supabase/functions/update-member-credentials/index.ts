// Ada/Aaron changing another member's login username and/or password —
// the member-account counterpart to update-staff-credentials/index.ts,
// which this mirrors almost exactly. Members had no equivalent of that
// function at all until now: create-member-account covers onboarding, but
// nothing let an admin reset a forgotten password or reassign a login
// after this function existed.
//
// Deployed with --no-verify-jwt for the same preflight-has-no-Authorization-
// header reason every other browser-invoked function in this app
// documents. The caller-is-an-admin check below is what actually gates
// this — without it, --no-verify-jwt would let anyone with a network path
// to this URL overwrite any member's login.
//
// One deliberate difference from update-staff-credentials: that function
// only checks "is the caller a member at all" (staff accounts aren't
// admin-gated the same way). Resetting another *member's* login is more
// sensitive — same reasoning create-member-account already applies to
// creating one — so this checks is_admin specifically.
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

  const { data: callerRow } = await supabaseAdmin.from('members').select('is_admin').eq('id', user.id).maybeSingle()
  if (!callerRow?.is_admin) return new Response('Forbidden — admins only', { status: 403, headers: corsHeaders })

  const { memberId, newUsername, newPassword } = await req.json()
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

  // Confirms memberId is actually a members row, not just any auth.users
  // id — without this, an admin could point this at a staff account's id
  // and overwrite that login instead (update-staff-credentials is the
  // correct path for staff).
  const { data: memberRow } = await supabaseAdmin.from('members').select('id').eq('id', memberId).maybeSingle()
  if (!memberRow) return new Response('Member not found', { status: 404, headers: corsHeaders })

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

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(memberId, attrs)
  if (updateError) return new Response(updateError.message, { status: 400, headers: corsHeaders })

  return new Response(JSON.stringify({ ok: true, username: cleanUsername }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})

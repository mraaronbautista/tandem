// AddMemberForm.jsx — Aaron creating a brand-new member account (the
// healthcare VA, and whoever joins after her). Same reasoning as
// create-staff-account: staff.id/members.id both reference auth.users, so
// creating either needs auth.admin.createUser(), a privileged operation
// the browser's anon-key client can never perform directly. Mirrors that
// function's shape almost exactly — see its own header comment for the
// full explanation of why the caller check below isn't optional despite
// --no-verify-jwt.
//
// One deliberate difference from create-staff-account: that function only
// checks "is the caller a member at all" (staff creation isn't admin-gated
// in this app). Creating a full member — task-board access, feature
// permissions, eventual admin eligibility — is more sensitive, so this
// checks is_admin specifically.
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(async (req) => {
  const preflight = handleCors(req)
  if (preflight) return preflight

  // Client scoped to this request's own Authorization header (not the
  // service role) so auth.getUser() reflects the real caller's session —
  // same pattern create-staff-account/manual-notify already establish.
  const supabaseUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const {
    data: { user },
  } = await supabaseUser.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

  const { data: callerRow } = await supabaseAdmin.from('members').select('is_admin').eq('id', user.id).maybeSingle()
  if (!callerRow?.is_admin) return new Response('Forbidden — admins only', { status: 403, headers: corsHeaders })

  const { username, password, displayName, color, permissions } = await req.json()
  const cleanUsername = String(username || '').trim().toLowerCase()
  const cleanDisplayName = String(displayName || '').trim()
  if (!cleanUsername || !cleanDisplayName) {
    return new Response('Missing username or display name', { status: 400, headers: corsHeaders })
  }
  if (!password || String(password).length < 8) {
    return new Response('Password must be at least 8 characters', { status: 400, headers: corsHeaders })
  }
  if (permissions != null && (typeof permissions !== 'object' || Array.isArray(permissions))) {
    return new Response('permissions must be an object', { status: 400, headers: corsHeaders })
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

  const { error: memberError } = await supabaseAdmin.from('members').insert({
    id: created.user.id,
    display_name: cleanDisplayName,
    color: color || '#8a8a8a',
    permissions: permissions || {},
    // Never settable through this endpoint — admin promotion stays
    // SQL-editor only for now (see guard_member_privilege_columns() in
    // schema.sql), same as changing an existing member's is_admin.
    is_admin: false,
  })
  if (memberError) {
    // Roll back the just-created auth user so a failed members insert
    // can't leave an orphaned account — useAccountRole.js would otherwise
    // classify it 'blocked' forever, and it wouldn't show up in the
    // roster for anyone to notice or fix. Same rollback
    // create-staff-account already establishes for the identical failure
    // mode on the staff table.
    await supabaseAdmin.auth.admin.deleteUser(created.user.id)
    return new Response(memberError.message, { status: 400, headers: corsHeaders })
  }

  return new Response(JSON.stringify({ id: created.user.id, username: cleanUsername }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})

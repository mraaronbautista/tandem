// Called from the browser (Settings > Issue photos). Deployed with
// --no-verify-jwt like manual-notify (the browser's preflight carries no
// Authorization header); the handler verifies the caller itself.
//
// Kinds:
//   status  { configured }                    is the Google Drive script connected?
//   backup  copies up to 5 photos to Drive    any member with Rentals
//   remove  { expectedCount }                 deletes backed-up photos of DONE issues; admins only
//
// Secrets (set by Aaron with `supabase secrets set`, never by an AI session):
//   DRIVE_BACKUP_URL    the Apps Script web app address (ends in /exec)
//   DRIVE_BACKUP_TOKEN  the shared password the script also holds
import { fetchAllMembers, memberHasPermission, supabaseAdmin } from '../_shared/notify.ts'
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { runBackupBatch, runRemoval } from '../_shared/issuePhotoBackupRun.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

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

  const members = await fetchAllMembers()
  const caller = members.find((m) => m.id === user.id)
  // Members with Rentals only: a staff account, or a member whose Rentals
  // access was turned off, can never run or learn anything from this.
  if (!caller || !memberHasPermission(caller, 'rentals')) {
    return new Response('Forbidden', { status: 403, headers: corsHeaders })
  }

  let payload: { kind?: string; expectedCount?: unknown }
  try {
    payload = await req.json()
  } catch {
    return json({ ok: false, reason: 'bad_request', message: 'Unreadable request.' }, 400)
  }

  const driveUrl = Deno.env.get('DRIVE_BACKUP_URL') || ''
  const driveToken = Deno.env.get('DRIVE_BACKUP_TOKEN') || ''
  const configured = Boolean(driveUrl && driveToken)

  if (payload.kind === 'status') return json({ ok: true, configured })

  const deps = { admin: supabaseAdmin, fetchFn: fetch, driveUrl, driveToken }

  if (payload.kind === 'backup') {
    if (!configured) return json({ ok: false, reason: 'not_configured', message: "Google Drive isn't connected yet.", backedUp: 0 })
    return json(await runBackupBatch(deps))
  }

  if (payload.kind === 'remove') {
    if (!caller.is_admin) return json({ ok: false, reason: 'admin_only', message: 'Only an admin can remove photos.' }, 403)
    const expected = payload.expectedCount
    if (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 0) {
      return json({ ok: false, reason: 'bad_request', message: 'Missing the number of photos to remove.' }, 400)
    }
    return json(await runRemoval(deps, expected))
  }

  return json({ ok: false, reason: 'bad_request', message: 'Unknown request.' }, 400)
})

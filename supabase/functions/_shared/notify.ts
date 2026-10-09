// Shared between notify-task-events and notify-reminders: sending a push
// requires the VAPID keys and a Supabase client with enough access to
// read every member's subscriptions (RLS on push_subscriptions only
// allows a member to see their own, so this deliberately uses the
// service role key to read across both).
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { isTransientPushFailure, type PushResult } from './delivery.ts'

// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically
// in every Edge Function's environment — only the VAPID keys need to be
// set by hand (see the setup steps).
const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

webpush.setVapidDetails(
  'mailto:mraaronbautista@gmail.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

export { supabaseAdmin }

// Shared-secret check for the two functions only the database calls
// (notify-task-events from a trigger, notify-reminders from a scheduled
// job). Both are deployed with --no-verify-jwt and their address is not a
// secret, so without this anyone could POST a made-up payload and push text
// of their choosing to every admin. The database sends the same value in an
// `x-notify-secret` header; the function refuses everything else. Fails
// closed: if NOTIFY_SECRET was never set, every request is refused (and the
// log says why), rather than silently accepting everyone.
function sameText(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  // Always walk the longer length, so timing does not reveal how much matched.
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

export function rejectUnlessNotifySecret(req: Request): Response | null {
  const expected = Deno.env.get('NOTIFY_SECRET')
  if (!expected) {
    console.error('NOTIFY_SECRET is not set; refusing the request. Set it with `supabase secrets set NOTIFY_SECRET=...`.')
    return new Response('Unauthorized', { status: 401 })
  }
  if (!sameText(req.headers.get('x-notify-secret') ?? '', expected)) {
    return new Response('Unauthorized', { status: 401 })
  }
  return null
}

// Every real member — no more hardcoded Ada/Aaron extraction now that a
// task's own assignee_ids already carries real member ids directly (no
// resolution step needed there any more). `permissions` included so
// callers can skip a feature-specific notification (e.g. a Rentals
// reminder) for a member who's been denied that feature — same
// deny-list semantics has_permission() enforces in RLS, just read
// directly here since this is a plain data fetch, not a query needing
// row-level security of its own. `is_admin` included so notify-task-events
// can scope a completion ping to admins only, instead of every member
// not assigned. Still worth throwing on a failed query rather than
// returning an empty array silently: every downstream notifyMember()
// call would otherwise just no-op with nothing in the logs to explain
// why a notification never went out.
export async function fetchAllMembers() {
  const { data, error } = await supabaseAdmin.from('members').select('id, display_name, permissions, is_admin')
  if (error) throw new Error(`fetchAllMembers: failed to load members: ${error.message}`)
  return data || []
}

// Mirrors has_permission() in schema.sql — a deny-list, so an absent key
// or explicit true means allowed, only an explicit false denies it.
export function memberHasPermission(member, feature) {
  return member?.permissions?.[feature] !== false
}

// Returns how it went so a caller that must not lose a one-shot reminder
// (notify-reminders) can leave it unmarked and try again: `delivered` is how
// many devices accepted the push, `retry` is true when something temporary
// went wrong (see isTransientPushFailure). Other callers ignore the result.
export async function notifyMember(memberId, payload): Promise<PushResult> {
  if (!memberId) return { delivered: 0, retry: false }
  const { data: subs, error: subsError } = await supabaseAdmin.from('push_subscriptions').select('*').eq('member_id', memberId)
  if (subsError) {
    console.error(`notifyMember: could not read subscriptions for member ${memberId}: ${subsError.message}`)
    return { delivered: 0, retry: true }
  }
  if (!subs?.length) return { delivered: 0, retry: false }

  const outcomes = await Promise.all(
    subs.map(async (sub) => {
      const pushSubscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }
      try {
        await webpush.sendNotification(pushSubscription, JSON.stringify(payload))
        return { delivered: 1, retry: false }
      } catch (err) {
        // 404/410 means the subscription is dead (browser data cleared,
        // app uninstalled, etc.) — drop it so we stop retrying forever.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id)
          return { delivered: 0, retry: false }
        }
        // Every other failure (a VAPID key mismatch, a malformed
        // subscription, a push-service-side error) used to be caught
        // and silently discarded here — the caller (manual-notify,
        // notify-task-events) still returns 200 either way, since this
        // whole call is fire-and-forget, so a real delivery failure had
        // no trace anywhere. Logged now so it shows up in this
        // function's own logs instead of vanishing.
        console.error(
          `notifyMember: push failed for subscription ${sub.id} (member ${memberId}): ${err.statusCode ?? err.code ?? '?'} ${err.body || err.message}`,
        )
        return { delivered: 0, retry: isTransientPushFailure(err) }
      }
    }),
  )
  return {
    delivered: outcomes.reduce((sum, o) => sum + o.delivered, 0),
    retry: outcomes.some((o) => o.retry),
  }
}

// Shared between notify-task-events and notify-reminders: sending a push
// requires the VAPID keys and a Supabase client with enough access to
// read every member's subscriptions (RLS on push_subscriptions only
// allows a member to see their own, so this deliberately uses the
// service role key to read across both).
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

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

// The `who` enum ('yours'/'assistant') maps to Ada/Aaron by display_name
// — mirrors src/lib/whoLabels.js, which is the one place that mapping is
// otherwise defined. Kept here too since an Edge Function can't import
// from the frontend's src/.
export async function resolveMemberIds() {
  const { data, error } = await supabaseAdmin.from('members').select('id, display_name')
  if (error) throw new Error(`resolveMemberIds: failed to load members: ${error.message}`)
  const byName = Object.fromEntries((data || []).map((m) => [m.display_name, m.id]))
  const { yours, assistant } = { yours: byName['Ada'], assistant: byName['Aaron'] }
  // A failed query and a genuinely-missing/renamed member both used to
  // collapse into the same silent-undefined outcome — every downstream
  // notifyMember(undefined, ...) call just no-ops with no visible error
  // anywhere, and in manual-notify specifically it also skews
  // callerIsAda (== caller.id === yours) to always false, misattributing
  // who a notification is from. Throwing here instead surfaces the
  // failure loudly (visible in the function's own logs) rather than
  // silently dropping notifications.
  if (!yours || !assistant) {
    throw new Error("resolveMemberIds: couldn't find both 'Ada' and 'Aaron' in members")
  }
  return { yours, assistant }
}

export async function notifyMember(memberId, payload) {
  if (!memberId) return
  const { data: subs } = await supabaseAdmin.from('push_subscriptions').select('*').eq('member_id', memberId)
  if (!subs?.length) return

  await Promise.all(
    subs.map(async (sub) => {
      const pushSubscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }
      try {
        await webpush.sendNotification(pushSubscription, JSON.stringify(payload))
      } catch (err) {
        // 404/410 means the subscription is dead (browser data cleared,
        // app uninstalled, etc.) — drop it so we stop retrying forever.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id)
        } else {
          // Every other failure (a VAPID key mismatch, a malformed
          // subscription, a push-service-side error) used to be caught
          // and silently discarded here — the caller (manual-notify,
          // notify-task-events) still returns 200 either way, since this
          // whole call is fire-and-forget, so a real delivery failure had
          // no trace anywhere. Logged now so it shows up in this
          // function's own logs instead of vanishing.
          console.error(
            `notifyMember: push failed for subscription ${sub.id} (member ${memberId}): ${err.statusCode ?? '?'} ${err.body || err.message}`,
          )
        }
      }
    }),
  )
}

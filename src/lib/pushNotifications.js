import { supabase } from './supabaseClient'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

// PushManager.subscribe wants the VAPID key as a Uint8Array, not the
// base64url string it's normally shared as.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window
}

// Whether this browser currently holds a push subscription — used to
// decide whether the UI should offer "Enable" or "Disable" notifications.
export async function getPushSubscription() {
  if (!pushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration()
  return (await registration?.pushManager.getSubscription()) || null
}

export async function subscribeToPush(memberId) {
  const registration = await navigator.serviceWorker.register('/service-worker.js')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission was not granted')

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  })

  const { endpoint, keys } = subscription.toJSON()
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ member_id: memberId, endpoint, p256dh: keys.p256dh, auth: keys.auth }, { onConflict: 'endpoint' })

  if (error) throw error
  return subscription
}

export async function unsubscribeFromPush() {
  const subscription = await getPushSubscription()
  if (!subscription) return

  await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
  await subscription.unsubscribe()
}

// ---- The house manager's phone (a staff account, not a member) ----

export function deviceIsIos() {
  const ua = navigator.userAgent || ''
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

// Installed to the Home Screen (iPhone) or opened as an app.
export function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true
}

// What the "Turn on alerts" card should offer on this phone:
//   'ios-install'  iPhone in a browser tab: alerts only work from the Home Screen app
//   'unsupported'  this browser cannot receive push at all
//   'blocked'      alerts were refused in the phone's settings
//   'off' / 'on'   the normal two states ('on' only when the server has this phone too)
export async function staffAlertState() {
  if (!pushSupported()) return deviceIsIos() && !isStandalone() ? 'ios-install' : 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  const subscription = await getPushSubscription()
  if (!subscription) return 'off'
  const { data, error } = await supabase.rpc('staff_push_registered', { p_endpoint: subscription.endpoint })
  return !error && data === true ? 'on' : 'off'
}

export async function subscribeStaffToPush() {
  const registration = await navigator.serviceWorker.register('/service-worker.js')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission was not granted')
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  })
  const { endpoint, keys } = subscription.toJSON()
  const { error } = await supabase.rpc('staff_register_push', { p_endpoint: endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth })
  if (error) throw error
  return subscription
}

export async function unsubscribeStaffFromPush() {
  const subscription = await getPushSubscription()
  if (!subscription) return
  await supabase.rpc('staff_unregister_push', { p_endpoint: subscription.endpoint })
  await subscription.unsubscribe()
}

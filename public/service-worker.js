// Push notifications only — this app has no offline/caching needs, so the
// service worker's sole job is receiving push events and displaying them.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let payload = { title: 'Tandem', body: '' }
  try {
    payload = event.data.json()
  } catch {
    // Non-JSON push payload — fall back to the default above.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // Android honors this; iOS mostly ignores custom vibration patterns
      // and just defers to the device's own Sounds & Haptics settings —
      // no web API controls that on iOS specifically.
      vibrate: [200, 100, 200],
      data: { url: payload.url || '/' },
    }),
  )
})

// Tapping a notification focuses an already-open tab if there is one,
// rather than always opening a fresh one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus()
      }
      return self.clients.openWindow(targetUrl)
    }),
  )
})

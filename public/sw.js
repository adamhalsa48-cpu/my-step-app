const CACHE_NAME = 'stay-fit-public-v1'
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  ]))
})

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(fetch(event.request).catch(async () => {
    const cache = await caches.open(CACHE_NAME)
    return (await cache.match(OFFLINE_URL)) || Response.error()
  }))
})

self.addEventListener('push', (event) => {
  let payload = { title: 'Stay Fit', body: 'A small step counts. Check in when you’re ready.', url: '/' }
  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {}
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/apple-icon.png',
    badge: '/icon-light-32x32.png',
    data: { url: payload.url },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => client.url === target)
    return existing ? existing.focus() : self.clients.openWindow(target)
  }))
})

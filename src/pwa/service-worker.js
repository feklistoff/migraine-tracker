/* global self, caches, URL, fetch, MessageChannel, setTimeout, clearTimeout, __BASE_PATH__, __PRECACHE__, __CACHE_NAME__ */
/* Built by scripts/build-service-worker.mjs. All URLs are scoped to this GitHub Pages project path. */
const BASE_PATH = __BASE_PATH__
const PRECACHE = __PRECACHE__
const CACHE_NAME = __CACHE_NAME__
const CACHE_PREFIX = `headache-diary-shell:${BASE_PATH}:`
const BASE_URL = new URL(BASE_PATH, self.location.origin).href

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // Keep old hashed assets while any tab could still be running an older bundle.
    if (windows.filter((client) => client.url.startsWith(BASE_URL)).length === 0) {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)))
    }
    await self.clients.claim()
  })())
})

async function cachedResponse(request, isNavigation) {
  const current = await caches.open(CACHE_NAME)
  if (isNavigation) return current.match(new URL('index.html', BASE_URL).href)
  const direct = await current.match(request)
  if (direct) return direct
  // A still-open old tab can request an old chunk after the new worker activates.
  const keys = await caches.keys()
  for (const key of keys.filter((entry) => entry.startsWith(CACHE_PREFIX) && entry !== CACHE_NAME)) {
    const response = await (await caches.open(key)).match(request)
    if (response) return response
  }
  return undefined
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE_PATH)) return
  const isNavigation = request.mode === 'navigate'
  event.respondWith((async () => {
    const cached = await cachedResponse(request, isNavigation)
    if (cached) return cached
    return fetch(request)
  })())
})

function askClient(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(false), 2500)
    channel.port1.onmessage = (event) => {
      clearTimeout(timer)
      resolve(event.data?.canActivate === true)
    }
    client.postMessage({ type: 'CAN_ACTIVATE_UPDATE' }, [channel.port2])
  })
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'APPLY_UPDATE' || !event.ports?.[0]) return
  event.waitUntil((async () => {
    const clients = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .filter((client) => client.url.startsWith(BASE_URL))
    const replies = await Promise.all(clients.map(askClient))
    if (replies.some((canActivate) => !canActivate)) {
      event.ports[0].postMessage({ applied: false, reason: 'Finish open forms and diary changes in every app tab, then try again.' })
      return
    }
    event.ports[0].postMessage({ applied: true })
    await self.skipWaiting()
  })())
})

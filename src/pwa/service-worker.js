/* global self, caches, URL, fetch, MessageChannel, setTimeout, clearTimeout, __BASE_PATH__, __PRECACHE__, __CACHE_NAME__ */
/* Built by scripts/build-service-worker.mjs. All URLs are scoped to this GitHub Pages project path. */
const BASE_PATH = __BASE_PATH__
const PRECACHE = __PRECACHE__
const CACHE_NAME = __CACHE_NAME__
const CACHE_PREFIX = `headache-diary-shell:${BASE_PATH}:`
const BASE_URL = new URL(BASE_PATH, self.location.origin).href

async function pruneOldCachesIfNoClients(preservePendingWorker = true) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  if (windows.some((client) => client.url.startsWith(BASE_URL))) return
  // A pending worker owns a cache it will need after its install completes.
  // Let its activate handler prune against its own CACHE_NAME instead.
  if (preservePendingWorker && (self.registration.installing || self.registration.waiting)) return
  const keys = await caches.keys()
  await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)))
}

async function requestOldCachePrune() {
  // pagehide fires before a tab is removed from clients.matchAll(). Give the
  // browser a moment to finish closing it and any sibling tabs.
  await new Promise((resolve) => setTimeout(resolve, 300))
  await pruneOldCachesIfNoClients()
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Keep old hashed assets while any tab could still be running an older bundle.
    await pruneOldCachesIfNoClients(false)
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
  if (event.data?.type === 'CLIENT_CLOSING') {
    event.waitUntil(requestOldCachePrune())
    return
  }
  if (event.data?.type !== 'APPLY_UPDATE' || !event.ports?.[0]) return
  event.waitUntil((async () => {
    const clients = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .filter((client) => client.url.startsWith(BASE_URL))
    const replies = await Promise.all(clients.map(askClient))
    if (replies.some((canActivate) => !canActivate)) {
      clients.forEach((client) => client.postMessage({ type: 'UPDATE_ABORTED' }))
      event.ports[0].postMessage({ applied: false, reason: 'Finish open forms and diary changes in every app tab, then try again.' })
      return
    }
    event.ports[0].postMessage({ applied: true })
    await self.skipWaiting()
  })())
})

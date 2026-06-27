const CACHE = 'bmls-v7'

const PRECACHE = [
  '/',
  '/bundle.js',
  '/manifest.json',
  '/fonts/fonts.css',
  '/fonts/bebas-neue-latin.woff2',
  '/fonts/bebas-neue-latin-ext.woff2',
  '/fonts/dm-sans-latin.woff2',
  '/fonts/dm-sans-latin-ext.woff2',
  '/api/state',
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE))
  )
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return

  if (url.pathname === '/api/state') {
    // Network-first: fresh data when online, cached data when offline
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone()
          caches.open(CACHE).then(cache => cache.put(request, clone))
          return response
        })
        .catch(() => caches.match(request))
    )
    return
  }

  if (url.pathname.startsWith('/api/')) {
    // All other API calls (writes) — network only, no caching
    return
  }

  // Static assets — stale-while-revalidate
  // Serve from cache immediately, update cache in background
  event.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(request).then(cached => {
        const networkFetch = fetch(request).then(response => {
          cache.put(request, response.clone())
          return response
        }).catch(() => cached)

        return cached || networkFetch
      })
    )
  )
})

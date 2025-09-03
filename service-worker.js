// Bump this when you release a new version
const CACHE_NAME = 'Really Simple Soundboard V0.01';

// Files to always pre-cache (your core app shell)
const urlsToCache = [
  './index.html',
  './icons/android-chrome-192x192.png',
  './icons/android-chrome-512x512.png'
];

// INSTALL: open cache and store core files
self.addEventListener('install', event => {
  self.skipWaiting(); // activate new SW immediately
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-caching app shell');
      return cache.addAll(urlsToCache);
    })
  );
});

// ACTIVATE: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      )
    )
  );
  self.clients.claim(); // start controlling pages immediately
});

// FETCH: handle all requests
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      if (url.pathname.endsWith('/index.html') || url.pathname === '/') {
        // Always serve the cached base index.html
        const cached = await cache.match('./index.html');
        if (cached) return cached;

        // If not cached, fetch from network and cache it
        const networkResponse = await fetch(event.request);
        if (networkResponse && networkResponse.status === 200) {
          cache.put('./index.html', networkResponse.clone());
        }
        return networkResponse;
      }

      // STATIC ASSETS: cache once, ignore query params
      if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|webp|mp3|wav|ogg|m4a|woff2?|ttf|eot)$/.test(url.pathname)) {
        const normalized = new Request(url.origin + url.pathname, {
          method: event.request.method,
          headers: event.request.headers,
          mode: event.request.mode,
          credentials: event.request.credentials,
          redirect: event.request.redirect,
          referrer: event.request.referrer,
          integrity: event.request.integrity,
        });

        const cached = await cache.match(normalized);
        if (cached) return cached;

        const networkResponse = await fetch(event.request);
        if (networkResponse && networkResponse.status === 200) {
          cache.put(normalized, networkResponse.clone());
        }
        return networkResponse;
      }

      // DEFAULT: try cache first, then network
      const cached = await cache.match(event.request);
      return cached || fetch(event.request);
    })
  );
});

// A version number for our cache. Change this string to force an update.
const CACHE_NAME = 'Bug-And-Moss-Soundboard-v033'; 

// The list of files that make up the "app shell".
const urlsToCache = [
  './index.html',
  // Add icon files to make sure they are available offline too
  './icons/android-chrome-192x192.png',
  './icons/android-chrome-512x512.png'
];

// The 'install' event is fired when the service worker is first registered.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache and caching app shell');
        return cache.addAll(urlsToCache);
      })
  );
});

// The 'activate' event is fired after install. It's a good place to clean up old caches.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // If a cache's name is old (not our current CACHE_NAME), delete it.
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// The 'fetch' event intercepts all network requests.
self.addEventListener('fetch', event => {
  // We only apply special logic for navigation requests (i.e., for HTML pages).
  if (event.request.mode === 'navigate') {
    const requestUrl = new URL(event.request.url);

    // ONLY if the navigation is for the soundboard, serve the cached app shell.
    if (requestUrl.pathname.endsWith('/soundboard.html')) {
      event.respondWith(
        caches.match('./soundboard.html').then(response => {
          return response || fetch(event.request);
        })
      );
    }
    // For all other navigation requests (like the homepage), we do nothing.
    // The request will pass through to the network as if the service worker wasn't here.
    return;
  }

  // For all other requests (like images), use a "cache-first" strategy.
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});

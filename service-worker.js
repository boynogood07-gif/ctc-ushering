/**
 * CTC Ushering System — Service Worker
 * Strategy: Cache-First for static assets, Network-First for HTML
 * Version: ctc-ushering-v2
 */

const CACHE_VERSION   = 'ctc-ushering-v2';
const STATIC_CACHE    = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE   = `${CACHE_VERSION}-dynamic`;

// Core app shell — cached on install
const PRECACHE_URLS = [
  '/usher-dashboard.html',
  '/ushering-app.js',
  '/ushering-styles.css',
  '/manifest.json',
  // Google Fonts (preloaded offline copies)
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;900&family=Nunito:wght@300;400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap',
  // Font Awesome
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css'
];

// ---- INSTALL: pre-cache app shell ----
self.addEventListener('install', event => {
  console.log('[SW] Installing version:', CACHE_VERSION);
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Pre-caching app shell');
        // Cache individually so one failure doesn't block all
        return Promise.allSettled(
          PRECACHE_URLS.map(url =>
            cache.add(url).catch(err => console.warn('[SW] Failed to cache:', url, err))
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ---- ACTIVATE: clean old caches ----
self.addEventListener('activate', event => {
  console.log('[SW] Activating version:', CACHE_VERSION);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ---- FETCH: tiered strategy ----
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests (except pre-cached CDN)
  if (request.method !== 'GET') return;

  // Strategy A — HTML pages: Network-First (always try fresh, fallback to cache)
  if (request.headers.get('Accept') && request.headers.get('Accept').includes('text/html')) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }

  // Strategy B — Static assets (JS, CSS, fonts, images): Cache-First
  if (
    url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff2?|ttf|eot)$/) ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('cdnjs.cloudflare.com')
  ) {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }

  // Default: Network-First for everything else
  event.respondWith(networkFirstStrategy(request));
});

// ---- Network-First: try network, store in dynamic cache, fallback to cache ----
async function networkFirstStrategy(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (_) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Offline fallback for navigation requests
    if (request.headers.get('Accept') && request.headers.get('Accept').includes('text/html')) {
      return caches.match('/usher-dashboard.html');
    }
    return new Response('Offline — resource unavailable', { status: 503 });
  }
}

// ---- Cache-First: serve from cache, fetch & store if missing ----
async function cacheFirstStrategy(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (_) {
    return new Response('Offline — resource unavailable', { status: 503 });
  }
}

// ---- Background Sync: re-emit queued attendance updates ----
self.addEventListener('sync', event => {
  if (event.tag === 'attendance-sync') {
    console.log('[SW] Background sync: attendance-sync');
    // Future Firebase sync hook goes here
    event.waitUntil(Promise.resolve());
  }
});

// ---- Push Notifications (reserved for future use) ----
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title   = data.title   || 'CTC Ushering System';
  const options = {
    body:    data.body    || 'New update available.',
    icon:    data.icon    || '/icons/icon-192.png',
    badge:   data.badge   || '/icons/icon-72.png',
    vibrate: [200, 100, 200]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

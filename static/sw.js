// Service Worker for XL Smart MS Support Tracker PWA
const CACHE_NAME = 'ms-tracker-v8';
const STATIC_ASSETS = [
  '/manifest.json',
  '/static/manifest.json',
  '/static/favicon.png',
  '/static/icon-192.png',
  '/static/icon-512.png',
  '/static/logo-xlsmart.png',
  '/static/logo-xlsmart-dark.png',
  '/static/css/style.css',
  '/static/js/app.js',
  '/static/js/ticket_engine.js',
  '/static/js/kb_search.js',
  '/static/js/ai_summary.js',
  '/static/js/sla_report.js',
  '/static/js/analytics.js',
  '/static/js/activities.js',
  '/static/js/dossier.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Pre-caching encountered some errors:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Do not intercept cross-origin requests (e.g. CDN scripts with SRI)
  if (url.origin !== self.location.origin) {
    return;
  }

  // Never cache API endpoints, healthchecks, or login page
  if (url.pathname.startsWith('/api/') || url.pathname === '/login' || url.pathname === '/login.html' || url.pathname === '/healthz') {
    return;
  }

  // For HTML navigation requests and JS/CSS bundles, use Network-First so auth redirects and code updates take effect immediately
  if (
    event.request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname === '/index.html' ||
    url.pathname.startsWith('/static/js/') ||
    url.pathname.startsWith('/static/css/')
  ) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && !networkResponse.redirected) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // For static assets, use Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && !networkResponse.redirected) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

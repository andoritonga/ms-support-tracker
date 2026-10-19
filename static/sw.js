// Service Worker for MS Support Tracker PWA
const CACHE_NAME = 'ms-tracker-v2';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/static/manifest.json',
  '/static/favicon.png',
  '/static/icon-192.png',
  '/static/icon-512.png',
  '/static/logo.png',
  '/static/logo-dark.png',
  '/static/css/style.css',
  '/static/js/app.js',
  '/static/js/ticket_engine.js',
  '/static/js/kb_search.js',
  '/static/js/ai_summary.js',
  '/static/js/sla_report.js',
  '/static/js/analytics.js',
  '/static/js/activities.js',
  '/static/js/dossier.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/marked/marked.min.js'
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
  const url = new URL(event.request.url);

  // For API endpoints, always use Network First
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request);
      })
    );
    return;
  }

  // For navigation or static files, try Cache then Network
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch background update
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});

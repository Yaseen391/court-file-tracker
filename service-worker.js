const CACHE_NAME = 'cft-cache-v3';
const STATIC_ASSETS = [
  '/court-file-tracker/',
  '/court-file-tracker/index.html',
  '/court-file-tracker/style.css',
  '/court-file-tracker/app.js',
  '/court-file-tracker/icon-192.png',
  '/court-file-tracker/icon-512.png',
  '/court-file-tracker/icon-192-maskable.png',
  '/court-file-tracker/icon-512-maskable.png',
  '/court-file-tracker/manifest.json',
  '/court-file-tracker/offline.html',
  'https://cdnjs.cloudflare.com/ajax/libs/croppie/2.6.5/croppie.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/croppie/2.6.5/croppie.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/fuse.js@6.6.2/dist/fuse.min.js',
  'https://cdn.jsdelivr.net/npm/exif-js'
];

// Install event: Pre-cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.error('Cache addAll failed:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate event: Clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(name => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event: Serve cached content if available, otherwise fetch from network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response;
      }
      return fetch(event.request).then((networkResponse) => {
        if (event.request.method === 'GET' && !event.request.url.includes('/api')) {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        }
        return networkResponse;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('/court-file-tracker/offline.html');
        }
        return new Response('Offline: Please check your internet connection.', { status: 503 });
      });
    })
  );
});

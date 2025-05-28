// Service Worker for Court File Tracker
const CACHE_NAME = 'cft-cache-v2'; // Updated cache name to force re-cache
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-192-maskable.png',
  '/icon-512-maskable.png',
  '/manifest.json', // Added manifest
  '/offline.html', // Added offline page
  'https://cdnjs.cloudflare.com/ajax/libs/croppie/2.6.5/croppie.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/croppie/2.6.5/croppie.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/fuse.js@6.6.2/dist/fuse.min.js',
  'https://accounts.google.com/gsi/client', // Added Google API client
  'https://apis.google.com/js/api.js' // Added Google API script
];

// Install Event: Cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((error) => {
        console.error('Cache addAll failed:', error);
      });
    })
  );
  self.skipWaiting();
});

// Activate Event: Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event: Cache-first for static assets, network-first for APIs
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle Google API requests (network-only)
  if (
    url.origin === 'https://apis.google.com' ||
    url.origin === 'https://www.googleapis.com' ||
    url.origin === 'https://accounts.google.com'
  ) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: 'Network unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response;
      }
      return fetch(event.request).then((networkResponse) => {
        // Cache new resources
        if (event.request.method === 'GET' && !url.pathname.startsWith('/api')) {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        }
        return networkResponse;
      });
    }).catch(() => {
      // Fallback to offline page for navigation requests
      if (event.request.mode === 'navigate') {
        return caches.match('/offline.html');
      }
      return new Response('Offline: Please check your internet connection.', { status: 503 });
    })
  );
});

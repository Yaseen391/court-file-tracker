const CACHE_NAME = 'cft-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-192-maskable.png',
  '/icons/icon-512-maskable.png',
  'https://apis.google.com/js/api.js',
  'https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .catch(error => console.error('Cache addAll failed:', error))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Network-only for Google API and authentication requests
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
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request)
          .then(networkResponse => {
            // Cache new GET requests (excluding APIs)
            if (event.request.method === 'GET' && !url.pathname.startsWith('/api')) {
              return caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, networkResponse.clone());
                return networkResponse;
              });
            }
            return networkResponse;
          })
          .catch(() => {
            // Serve offline.html for navigation requests
            if (event.request.mode === 'navigate') {
              return caches.match('/offline.html');
            }
            return new Response('Offline: Please check your internet connection.', {
              status: 503
            });
          });
      })
  );
});

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : { title: 'Court File Tracker', body: 'New update available' };
  const options = {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png'
  };
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});

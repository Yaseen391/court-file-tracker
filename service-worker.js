const CACHE_NAME = 'court-file-tracker-cache-v1.1'; // Increment version for new changes
const OFFLINE_URL = '/court-file-tracker/offline.html'; // Path to your offline page

// List of files to cache on install (your app shell)
const urlsToCache = [
  '/court-file-tracker/', // Cache the root index.html when accessed as root
  '/court-file-tracker/index.html',
  '/court-file-tracker/app.js',
  '/court-file-tracker/style.css',
  '/court-file-tracker/manifest.json',
  '/court-file-tracker/offline.html',
  // Your icons (make sure these exist at these paths)
  '/court-file-tracker/icon-48.png',
  '/court-file-tracker/icon-72.png',
  '/court-file-tracker/icon-96.png',
  '/court-file-tracker/icon-144.png',
  '/court-file-tracker/icon-168.png',
  '/court-file-tracker/icon-192.png',
  '/court-file-tracker/icon-192-maskable.png',
  '/court-file-tracker/icon-256.png',
  '/court-file-tracker/icon-384.png',
  '/court-file-tracker/icon-512.png',
  '/court-file-tracker/icon-512-maskable.png',
  '/court-file-tracker/badge-72.png', // Optional: for notifications
  // External libraries (if you host them locally, adjust paths)
  // If you are using CDN, they will be handled by network-first strategy below
  // Or, you can pre-cache them here if you want them always offline-available
  // 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  // 'https://cdnjs.cloudflare.com/ajax/libs/fuse.js/6.6.2/fuse.min.js',
  // 'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js',
  // 'https://cdn.jsdelivr.net/npm/exif-js',
];

self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .catch((error) => {
        console.error('[Service Worker] Caching failed:', error);
      })
  );
  self.skipWaiting(); // Force the new service worker to activate immediately
});

self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName.startsWith('court-file-tracker-cache')) { // Only delete old versions of this app's cache
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Ensure the service worker takes control of clients immediately
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests and skip chrome-extension://
  if (event.request.method !== 'GET' || event.request.url.startsWith('chrome-extension://')) {
    return;
  }

  // Define strategy: Cache-first for explicitly cached assets, Network-first for others
  const requestUrl = new URL(event.request.url);
  const isAppShellAsset = urlsToCache.some(url => requestUrl.pathname.endsWith(url.replace('/court-file-tracker/', '')));
  const isCDNAsset = requestUrl.hostname.includes('cdnjs.cloudflare.com') || requestUrl.hostname.includes('cdn.jsdelivr.net');

  if (isAppShellAsset) {
    // Cache-first strategy for our app's static assets
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request);
      }).catch(() => caches.match(OFFLINE_URL)) // Fallback to offline page
    );
  } else if (isCDNAsset) {
    // Network-first with cache fallback for CDN assets
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          // Check if we received a valid response
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return response;
        })
        .catch(() => caches.match(event.request)) // Fallback to cache on network failure
    );
  } else {
    // Default: Network-first, then cache for all other requests
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return response;
        })
        .catch(async () => {
          const cachedResponse = await caches.match(event.request);
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.mode === 'navigate') {
            return caches.match(OFFLINE_URL);
          }
          return new Response('<h1>Offline</h1><p>The application is currently offline and this content is not cached.</p>', {
            headers: { 'Content-Type': 'text/html' }
          });
        })
    );
  }
});

self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push Received.');
  const data = event.data.json ? event.data.json() : {};
  const title = data.title || 'Court File Tracker Notification';
  const options = {
    body: data.body || 'You have new updates or overdue files to check!',
    icon: '/court-file-tracker/icon-192.png', // Main app icon
    badge: '/court-file-tracker/badge-72.png', // Small monochrome icon for notification tray
    vibrate: [200, 100, 200],
    tag: 'court-file-tracker-notification', // Group notifications
    renotify: true, // Re-show notification if content changes for the same tag
    data: {
      url: data.url || '/court-file-tracker/index.html#dashboard' // URL to open when notification is clicked
    }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification click received.');
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : '/court-file-tracker/index.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(targetUrl) && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});

const CACHE_NAME = 'court-file-tracker-v1';
const OFFLINE_URL = 'offline.html';

const urlsToCache = [
  '/',
  'index.html',
  'style.css',
  'app.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  OFFLINE_URL
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then((response) => response || caches.match(OFFLINE_URL))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) =>
      Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }))
    )
  );
});

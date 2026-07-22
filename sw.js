// Service worker: cache-first offline support for the NS Fish Field ID & Catalogue app.
// Bump CACHE_VERSION whenever precached files change so clients pick up the new set.
const CACHE_VERSION = 'fisher-v1';
const RUNTIME_CACHE = 'fisher-runtime-v1';

const PRECACHE_URLS = [
  './',
  './index.html',
  './species.html',
  './key.html',
  './catalogue.html',
  './export.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/species-list.js',
  './js/key-engine.js',
  './js/identify-modal.js',
  './js/catalogue.js',
  './js/export.js',
  './js/species-page.js',
  './js/key-page.js',
  './data/species.json',
  './data/key.json',
  './data/images.json',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Cache-first, network-fallback-and-store, for all same-origin GET requests.
// This covers the precached app shell AND anything not explicitly precached
// (e.g. reference images under /images/), so images cached on a first online
// visit remain available offline afterward.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          if (req.mode === 'navigate') return caches.match('./index.html');
          return caches.match('./icons/icon.svg');
        });
    })
  );
});

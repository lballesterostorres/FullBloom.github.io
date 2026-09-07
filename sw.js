const CACHE_NAME = 'fullbloom-v11';
const APP_SHELL = [
  './',
  './index.html',
  './7cb36653-a001-4e60-93a2-b2e66f0b6c6c.css',
  './fonts/Gotham-Book.otf',
  './fonts/Gotham-Medium.otf',
  './styles.css',
  './config.js',
  './content.es.js',
  './content.pt.js',
  './app.js',
  './icono_pandora.webp',
  './20260828 - SMC 2026 - Key Visual No Text-01.png',
  './img/mateo.jpg',
  './img/valeria.jpg',
  './img/andres.jpg',
  './img/rocio.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});

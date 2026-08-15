/* Cache-first for the handful of files this app is made of, so it still works
   in a kitchen with bad wifi. Bump CACHE when any of them change. */

const CACHE = 'popcorn-ear-v2';
const ASSETS = [
  '/popcorn/',
  '/popcorn/index.html',
  '/popcorn/styles.css',
  '/popcorn/detector.js',
  '/popcorn/app.js',
  '/popcorn/manifest.json',
  '/popcorn/icons/icon-180.png',
  '/popcorn/icons/icon-192.png',
  '/popcorn/icons/icon-512.png',
  '/popcorn/icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then((hit) => {
      // Serve from cache immediately, refresh it in the background.
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});

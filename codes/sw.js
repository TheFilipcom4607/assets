/* Cache-first service worker so the app works fully offline. */
var CACHE = 'codes-v3';
var ASSETS = [
  '/codes/',
  '/codes/index.html',
  '/codes/styles.css',
  '/codes/app.js',
  '/codes/manifest.webmanifest',
  '/codes/vendor/qrcode.js',
  '/codes/vendor/jsbarcode.all.min.js',
  '/codes/icons/icon-192.png',
  '/codes/icons/icon-512.png',
  '/codes/icons/icon-maskable-512.png',
  '/codes/icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k !== CACHE;
      }).map(function (k) {
        return caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;
      return fetch(e.request).then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(e.request, copy);
          });
        }
        return res;
      }).catch(function () {
        if (e.request.mode === 'navigate') return caches.match('/codes/index.html');
      });
    })
  );
});

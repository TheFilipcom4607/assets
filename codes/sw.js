/* Offline support with reliable updates:
   - Pages (navigations) are network-first, so a new deploy is picked up on
     the next launch; the cached copy is only used when offline.
   - Static assets are cache-first with versioned URLs (?v=N), so bumping
     the version in index.html + this file rolls everything forward. */
var VERSION = '4';
var CACHE = 'codes-v' + VERSION;
var ASSETS = [
  '/codes/',
  '/codes/index.html',
  '/codes/styles.css?v=' + VERSION,
  '/codes/app.js?v=' + VERSION,
  '/codes/manifest.webmanifest',
  '/codes/vendor/qrcode.js?v=' + VERSION,
  '/codes/vendor/jsbarcode.all.min.js?v=' + VERSION,
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

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put('/codes/index.html', copy);
          });
        }
        return res;
      }).catch(function () {
        return caches.match('/codes/index.html');
      })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(function (cached) {
      if (cached) return cached;
      return fetch(e.request).then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(e.request, copy);
          });
        }
        return res;
      });
    })
  );
});

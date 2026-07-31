/*
 * Super Slide service worker.
 *
 * Registered from /slide/index.html, so its scope is this folder only —
 * nothing else on the site is intercepted.
 *
 * Offline is the default path, not a fallback:
 *  - Navigations are answered from cache first, so a launch never waits on
 *    (or requires) the network. A fresh copy is fetched in the background
 *    and picked up on the next launch.
 *  - Every navigation in scope resolves to the cached shell regardless of
 *    query string, so /slide/ and /slide/?screen=levels both work offline.
 *  - Precaching stores each asset independently. One bad response can no
 *    longer abort the whole install and leave the app with no worker at all.
 *  - Cached responses are rebuilt from their bytes. A host that redirects
 *    (e.g. /slide/ -> /slide) otherwise yields a `redirected` response, which
 *    the browser refuses to use to satisfy a navigation.
 */
const VERSION = 'super-slide-v2';

const SHELL = [
  'index.html',
  'css/style.css',
  'js/solver.js',
  'js/solver-worker.js',
  'js/levels.js',
  'js/feel.js',
  'js/game.js',
  'manifest.webmanifest',
  'icons/favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-192.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png'
];

const scopeUrl = () => self.registration.scope;
const abs = (path) => new URL(path, scopeUrl()).toString();
const indexUrl = () => abs('index.html');

/** Rebuild a response from its bytes, dropping redirect provenance. */
async function repack(response) {
  const body = await response.arrayBuffer();
  return new Response(body, {
    status: 200,
    statusText: 'OK',
    headers: new Headers(response.headers)
  });
}

async function store(cache, url, key) {
  const response = await fetch(url, { cache: 'reload', credentials: 'same-origin' });
  if (!response.ok) throw new Error(response.status + ' for ' + url);
  await cache.put(key || url, await repack(response));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Independent puts: a single failure must not abort the install.
    await Promise.allSettled(SHELL.map((path) => store(cache, abs(path))));
    // The shell also answers bare-directory navigations to /slide/.
    await Promise.allSettled([store(cache, indexUrl(), scopeUrl())]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL(scopeUrl()).pathname)) return;

  // Navigations: cache first, so launching never depends on connectivity.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match(indexUrl()) || await cache.match(scopeUrl());

      const refresh = (async () => {
        try {
          const response = await fetch(request);
          if (response && response.ok) {
            const copy = await repack(response.clone());
            await cache.put(indexUrl(), copy.clone());
            await cache.put(scopeUrl(), copy);
          }
          return response;
        } catch (err) {
          return null;
        }
      })();

      if (cached) {
        event.waitUntil(refresh);
        return cached;
      }
      const live = await refresh;
      return live || new Response(
        '<!doctype html><meta charset="utf-8"><title>Super Slide</title>' +
        '<body style="font:16px system-ui;padding:2rem">Super Slide could not load. ' +
        'Reconnect once and it will work offline from then on.</body>',
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    })());
    return;
  }

  // Assets: cache first, refreshed in the background for the next launch.
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(request);

    if (cached) {
      event.waitUntil((async () => {
        try {
          const response = await fetch(request);
          if (response && response.ok) await cache.put(request, await repack(response));
        } catch (err) { /* offline: the cached copy stands */ }
      })());
      return cached;
    }

    try {
      const response = await fetch(request);
      if (response && response.ok) await cache.put(request, await repack(response.clone()));
      return response;
    } catch (err) {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});

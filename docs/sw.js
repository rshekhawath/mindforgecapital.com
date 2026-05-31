/* MindForge Capital — minimal service worker (v1)
 * Strategy: network-first for HTML, cache-first for assets.
 * Deliberately stays out of the way of the live data path: nothing under
 * /script.google.com is cached. Apps Script responses change per-second so
 * a stale cache would mislead subscribers.
 */
const CACHE = 'mfc-v1';
const ASSET_PATHS = [
  '/assets/LogoNav.png',
  '/assets/favicon-32.png',
  '/assets/favicon-192.png',
  '/assets/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSET_PATHS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Never touch live API calls (Apps Script, Yahoo, etc.) or non-GET
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // HTML: network-first (so subscribers see the latest dashboard)
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((cached) => cached || caches.match('/index.html')))
    );
    return;
  }

  // Assets (images, css if ever, etc.): cache-first
  if (/\.(?:png|jpg|jpeg|webp|svg|ico|css|woff2)$/i.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => cached))
    );
  }
});

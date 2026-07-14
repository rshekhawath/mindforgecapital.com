/* MindForge Capital — minimal service worker (v2)
 * Strategy: network-first for HTML, cache-first for assets.
 * Deliberately stays out of the way of the live data path: nothing under
 * /script.google.com is cached. Apps Script responses change per-second so
 * a stale cache would mislead subscribers.
 * v2 (V12.0): cache bumped so the old HTML fallback is purged on activate and
 * returning visitors land on the V12.0 interactive hero even when offline.
 * v3 (V14.3): JS added to the cache-first asset list (was css/img only, so the
 * shared scripts re-fetched every navigation); cache bumped to re-install.
 * v4 (V22.4): the website is now the installed iOS/Android app (Add to Home
 * Screen), so the app SHELL is precached at install — the two entry documents
 * (login = the app's start_url, and the homepage the navigation fallback serves)
 * — so the installed app opens even on a cold offline launch. Cache bumped to
 * re-install and purge the v3 entries.
 * v5 (V22.5): the smooth theme-transition release touches the two precached
 * shell documents (index.html + login.html carry the toggle gate) and the
 * cache-first shared asset mfc-finish.css. Cache bumped so activate purges the
 * v4 entries and the offline shell re-installs with the current HTML.
 */
const CACHE = 'mfc-v5';
const ASSET_PATHS = [
  '/login.html',                    // manifest start_url — the installed app's entry
  '/index.html',                    // offline navigation fallback (see fetch handler)
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

  // Assets (images, css, js, fonts): cache-first. ?v= query versioning keeps
  // these fresh — a new ?v is a new cache key, so bumping it ships new code.
  if (/\.(?:png|jpg|jpeg|webp|svg|ico|css|js|woff2)$/i.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => cached))
    );
  }
});

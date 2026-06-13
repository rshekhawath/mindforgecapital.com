/* ============================================================================
   MindForge Capital — Member App · service worker
   ----------------------------------------------------------------------------
   • App shell: precache + cache-first (instant launch, works offline).
   • Navigations: network-first with cache fallback (updates flow; offline still
     opens the app).
   • API (script.google.com / cross-origin): never touched — always live network,
     never cached (holdings/OTP must be fresh and are credential-bearing).
   ========================================================================== */
var CACHE = 'mfc-app-v2';
var SHELL = [
  './', './index.html',
  './css/app.css',
  './js/config.js', './js/api.js', './js/store.js', './js/brokers.js', './js/app.js',
  './manifest.webmanifest',
  './assets/favicon-192.png', './assets/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // Same-origin only. Cross-origin (the Apps Script backend) always goes to the
  // network and is never cached.
  if (url.origin !== self.location.origin) return;

  // Navigations → network-first, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
        return res;
      }).catch(function () { return caches.match('./index.html').then(function (m) { return m || caches.match('./'); }); })
    );
    return;
  }

  // Same-origin assets (css/js/icons) → stale-while-revalidate: serve cache
  // instantly, refresh it in the background, so the next launch picks up new app
  // code automatically — no manual cache-version bump needed between releases.
  e.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || net;
      });
    })
  );
});

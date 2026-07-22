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
 * v6 (V23.7): the tap-target pass edits the precached shell document index.html
 * (the .hv-tab min-height). The shared assets it also touches ride their own
 * ?v= bumps, but a precached document has no query to bust — so the cache is
 * bumped to purge v5 and re-install the offline shell with the current HTML.
 * v7 (V24.0): index.html changed twice since v6 was cut — the V23.9 republish
 * (hero title/period + the corrected figures) and the V24.0 data-count fix that
 * stops count-ups animating BACK to the old numbers. An installed app serving
 * the v6 offline shell would replay exactly that bug, so the cache is bumped.
 * v8 (V24.1): the MultiAsset window redefinition (full Feb-2023 span for both
 * legs) changes index.html's MFSTAT values + data-count targets again — same
 * precached-shell rationale as v6/v7.
 * v9 (V24.2): the live-portfolio pivot restructures the precached index.html
 * hero (live strip + demoted backtest pair). live-perf.json itself is NOT
 * cached here — it must always come from the network so the LIVE figure is
 * never a stale offline copy.
 * v10 (V24.3): the deeper pivot adds live metrics to index.html's strategy
 * cards (precached shell doc changed again — same rationale chain).
 * v11 (V24.4): Multicap and S&P 500 are retired. index.html (a precached shell
 * doc) loses two hero tabs, two strategy cards and the All-Access band, and
 * login.html — the installed app's start_url, also precached — changed too. An
 * installed app on the v10 shell would keep offering both dead strategies and
 * link to pages that now 404, so the cache is bumped to purge and re-install.
 * v12 (V24.5): the dashboard's dual-currency path is gone (every book is NSE/₹),
 * and index.html — a precached shell doc — carries new ?v= query strings for the
 * two shared scripts that changed with it. A precached document has no query to
 * bust, so the cache name is again the version.
 * v13 (V24.6): the simulated "+32.01% annual alpha · LIVE" claim is off the
 * precached index.html proof bar, and its strategy cards now label the headline
 * figure "5Y Backtest CAGR". An installed app serving the v12 shell would keep
 * presenting a backtested number as a live one, so the cache is bumped.
 * v14 (V24.7): responsive fixes to the precached index.html shell — the 4-item
 * proof bar no longer strands a cell on tablets/phones, the hero alpha chip no
 * longer truncates its "· backtest" label, and stacked strategy cards are capped
 * instead of stretching full-bleed. Bumped so installed apps re-install the shell.
 * v15 (V24.8): index.html (precached shell) carries the new mfc-live.js ?v, whose
 * live figures now count up and whose live containers rise in.
 * v16 (V25.1): index.html (precached shell) now counts the hero's LIVE cycle
 * figure up on a strategy switch too — the backtest CAGR/bench beside it always
 * animated, the live value snapped. An installed app serving the v15 shell would
 * keep snapping it, so the cache is bumped to re-install the current shell.
 */
const CACHE = 'mfc-v16';
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

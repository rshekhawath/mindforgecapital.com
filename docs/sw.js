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
 * v17 (V25.3): BOTH precached shell documents (index.html and login.html) now
 * reference mfc-finish.css?v=1790, which carries the site-wide fix for the
 * theme toggle being stranded in the middle of the mobile nav. A precached
 * document has no query to bust, so an installed app serving the v16 shell
 * would keep requesting ?v=1780 and keep the broken nav indefinitely — the
 * cache name is the only version these two documents have.
 */
// V25.8: bumped because index.html — precached below as the offline navigation
// fallback — changed its FAQ answers (SEBI registration attribution). Online
// visitors get fresh HTML (navigations are network-first), but the offline copy
// would otherwise keep serving the pre-V25.8 text.
// v20 (V26.7): index.html (precached shell) carries the dark-mode legibility pass —
// the Market-Pulse sentiment verdict/score and the science-timeline year now lift
// to the dark palette instead of sitting at ~3.5–3.9:1. A precached document has no
// ?v to bust, so the cache name is bumped to re-install the current offline shell.
// v21 (V26.9): BOTH precached shell documents (index.html and login.html) now
// reference mfc-finish.css?v=2696, which ships the site-wide dark-mode data-ink
// scale (grading colours, factor pillars, semantic reds/greens that had collapsed
// to 2.5–3.5:1 on the dark theme) plus the horizontal-scroll edge-fade affordance.
// A precached document has no ?v to bust, so the cache is bumped to re-install the
// current offline shell and pull the new stylesheet.
// v23 (V27.3): the July rebalance republished every backtest figure, and
// index.html — precached below as the offline navigation fallback — carries
// three of them (the LargeMidcap / SmallMicro / MultiAsset CAGR + benchmark
// tiles, now 35.6/14.01, 46.9/16.88, 21.7/10.56). The 30 chart files under
// /assets/charts/ do NOT need the cache name: inject_site_stats.py re-stamps
// each one's ?v= from the new PNG's content hash, and a new ?v is a new cache
// key under the cache-first asset rule below. A precached document has no ?v,
// so the cache name is its only version — bumped here so an offline visitor
// cannot be served last month's figures. Same reasoning as v20 and v22.
// v24 (V27.4): the light-mode small-text contrast pass changed index.html again —
// the strategy-card metrics moved off the hard-coded #00b894 (2.54:1 on white,
// below even the 3:1 large-text bar), and the team-role / save-badge / hero
// live-badge / WhatsApp-eyebrow inks moved onto the --data-* token family so they
// flip with the theme instead of being baked light. index.html is precached below
// as the offline navigation fallback, so the cache name is the only version it
// has. No shared docs/assets/ file changed this release — every edit is page-local
// CSS — so nothing needed a ?v= bump.
// v25 (V27.5): index.html (precached below as the offline navigation fallback)
// gains the strategy-card backtest-vs-benchmark comparison bars. No shared
// docs/assets/ file changed — the CSS and JS are page-local, and dashboard.html
// is not precached — so the cache name is again the only version that moves.
// v26 (V27.6): the phone-only density pass touches BOTH precached shell
// documents — index.html (offline navigation fallback) and login.html (the
// installed app's start_url). Everything in it is scoped to max-width:600px, so
// tablets and desktop are unaffected, but a precached document has no ?v to
// bust and an installed app would otherwise keep the old loose mobile layout.
// v27 (V27.7): index.html (precached offline fallback) gains the phone-only
// section accordions, and both shell documents carry the second phone polish
// pass. All of it is scoped to max-width:600px — the accordion script returns
// before touching the DOM above that width — so tablets and desktop are
// unaffected, but a precached document has no ?v to bust.
// v28 (V27.8): the cross-viewport chrome corrections ship as new ?v on
// mfc-finish.css and mfc-chrome.js, and BOTH precached shell documents
// (index.html — the offline navigation fallback, login.html — the installed
// app's start_url) carry those references. A precached document has no ?v of
// its own to bust, so an installed app would keep serving the old markup with
// the old asset URLs and never see the fixes.
// v29 (V27.9): the on-tint ink tier lands in mfc-finish.css, the live-vs-
// benchmark line in mfc-live.js and the dismiss-button hit area in
// mfc-offer.js — all three shared assets get a new ?v, and BOTH precached
// shell documents reference all three. index.html additionally carries the
// footer tap-target and proof-link changes in its own markup, which a
// precached copy has no ?v of its own to bust.
// v30 (V28.0): mfc-finish.css (the dark market-pulse sign inversion, the
// site-wide footer tap-target rule and the scrollable mobile nav drawer),
// mfc-live.js (the live-vs separator ink and the .ls-cta hit area) and
// mfc-chrome.js (Escape / outside-click dismissal for that drawer) all change,
// and BOTH precached shell documents reference all three.
// (superseded note kept for the record) mfc-finish.css (the dark market-pulse sign inversion + the
// site-wide footer tap-target rule) and mfc-live.js (the live-vs separator ink
// and the .ls-cta hit area) both change, and BOTH precached shell documents
// reference both. index.html additionally carries the net-flow rail and the
// strategy-card / why-card layout corrections in its own markup, and a
// precached document has no ?v of its own to bust. This bump also unifies the
// mfc-finish.css query across the whole site: the 28 generated stock-directory
// pages had been pinned at ?v=2782 while everything else moved to 2790, so they
// were fetching and caching a second, separate copy of the same file.
// v31 (V28.1): index.html — precached below as the offline navigation fallback —
// changes again (the hero's aria-busy quieting, the WhatsApp auto-hide timer now
// armed when the bubble appears rather than at load, and the price-pop keyframe
// rewritten to animate the gradient that actually paints those glyphs). No file
// under docs/assets/ changed this release, so nothing needed a ?v= bump; the
// cache name is the only version a precached document has.
// v32 (V28.2): index.html — precached below as the offline navigation fallback —
// changes again: the strategy cards gain the risk ladder (max drawdown on one
// shared axis + Sharpe), and their backtest labels stop dating MultiAsset's
// 2023–2026 window as "5Y". No file under docs/assets/ changed this release, so
// nothing needed a ?v= bump; the cache name is the only version a precached
// document has. (dashboard.html is not precached — it is network-first — so its
// cycle rail and portfolio-map changes reach members without this bump.)
const CACHE = 'mfc-v32';
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

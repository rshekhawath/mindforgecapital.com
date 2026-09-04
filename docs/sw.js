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
// v33 (V28.3): index.html — precached below as the offline navigation fallback —
// gains the "what each rung of return costs" trade-off strip (return vs drawdown
// on diverging axes, read from the strategy cards). Both precached shell
// documents (index.html, login.html) also carry the new mfc-finish.css?v=2830,
// which adds the site-wide 24px pointer-target pads for the small links WCAG
// 2.5.8 had never covered. A precached document has no ?v of its own to bust, so
// the cache name is the version that moves. (dashboard.html is network-first —
// its new "what moved your number" return-attribution card reaches members
// without this bump.)
// v34 (V28.4): both precached shell documents (index.html, login.html) change —
// not in body copy this time but in the asset query they point at. mfc-finish.css
// moves 2830 -> 2840 (the pointer-target pads for the fee-calculator disclosure
// toggle and the two SEBI grievance mailto links), and mfc-chrome.js is unified at
// ?v=6 across the whole site — the 28 generated stock-directory pages had been
// pinned at ?v=4 since V27.8 and were serving returning visitors a chrome script
// two releases old from a second, duplicate cache entry. A precached document has
// no ?v of its own, so the cache name is what makes the offline fallback point at
// the same asset versions the live pages do. (The month-by-month calendar lands on
// smallmicro/largemidcap and the capital-coverage card on dashboard.html; none of
// those three are precached — HTML is network-first — so they need no bump.)
// v35 (V28.5): index.html — precached below as the offline navigation fallback —
// changes twice over. Its body gains the measurement-window rail under the
// trade-off strip (three backtest spans on one shared axis, so "windows differ per
// strategy" stops being a footnote the reader has to carry), and its asset query
// moves mfc-finish.css 2840 -> 2850, which adds the 24px pointer-target pad for the
// .tip-icon tooltip trigger — the one control the V28.4 sweep could not see,
// because its hit-test never scrolled and elementFromPoint answers null outside the
// viewport. login.html carries the same asset bump. A precached document has no ?v
// of its own to bust, so the cache name is the only version that can move it.
// (dashboard.html is network-first — the whole-share weight-drift strip, the ticker
// cell that no longer wraps its broker chip, and the broker link the phone card was
// missing all reach members without this bump.)
//
// V28.6 -> mfc-v36. index.html is precached as the offline navigation fallback and
// its BODY changed: the new "Your month" section (a month track per strategy, built
// at parse time from the strategy cards) plus the corrected rebalance FAQ answer,
// which is also the FAQPage answer text. No shared asset in /assets/ changed this
// release, so no page needed a ?v bump — the cache name is the only thing that can
// move a precached document. login.html is unchanged but shares the cache.
// (dashboard.html stays network-first: the half-placed-book strip, the company cell
// that no longer widows its link glyph and the wrapped sector labels reach members
// with no cache move at all.)
//
// V28.7 -> mfc-v37. index.html is precached as the offline navigation fallback and
// its BODY changed: the new fee ladder under "Why MindForge" (drag per strategy on
// one axis against the 2–2.5% AUM band, derived from STRAT_MONTHLY and each card's
// recommended investment) plus the two hand-written fee figures in the "Honest
// pricing" card, which now read from the same computation. Its HEAD changed too —
// the inert frame-ancestors directive is gone from the meta CSP on all 52 pages.
// No shared asset in /assets/ changed this release, so no page needed a ?v bump;
// the cache name is the only thing that can move a precached document.
// (dashboard.html stays network-first: the capital ladder, the corrected drift
// sentence and the phone card's untangled hit pads reach members with no cache
// move at all.)
//
// V28.8 -> mfc-v38. index.html is precached as the offline navigation fallback and
// its BODY changed: the new narrowing rail under "The process" (universe → scored
// → survives the ≤3-per-industry cap → held, per equity strategy on one shared
// axis, from MFFUN markers the monthly run rewrites) plus stage 01's chip, which
// said "Up to 750 stocks" — LargeMidcap's 250-name universe added to SmallMicro's
// 500, a field no pipeline has ever started from. No shared asset in /assets/
// changed this release, so no page needed a ?v bump; the cache name is the only
// thing that can move a precached document.
// (dashboard.html stays network-first: the four "How to invest" steps now report
// the member's own session — capital, broker, orders placed, days to rebalance —
// and reach members with no cache move at all.)
//
// V28.9 -> mfc-v39. index.html is precached as the offline navigation fallback
// and its BODY changed in three places, all of them corrections rather than
// additions: the MultiAsset card no longer claims "Weekly signals" (no model has
// a weekly leg — STRATEGY_CADENCE is "monthly" for all three), the "Your month"
// track now draws the same twice-a-month portfolio review on all three rows
// instead of four weekly touch points on one, and the pipeline stage that said
// stocks are scored on "value, quality" now names the factors the models
// actually use. No shared asset in /assets/ changed, so no page needed a ?v
// bump; the cache name is the only thing that can move a precached document.
// (dashboard.html stays network-first: the new "Why these 25" factor-mix card
// reaches members with no cache move at all.)
//
// V29.0 -> mfc-v40. index.html is unchanged this release; the work is all in
// dashboard.html, which is network-first and reaches members without any cache
// move. The bump is here so no installed PWA can keep serving a shell whose
// precached assets predate the strategy-switcher fix, and to keep the cache
// name monotonic with the release it belongs to.
// V29.2 -> mfc-v42. This one MUST move: every page's mfc-finish.css reference
// steps 2910 -> 2920, and mfc-dir.css 2571 -> 2920. Assets are served
// cache-first keyed by the exact URL including ?v, so without a new cache name
// an installed PWA would hold both the old and the new copy of each file.
// It is also the release that retires the ?v=2850 pin on the 28 generated
// directory pages — the mismatch that kept V29.1's 44px hamburger away from
// them for anyone who had visited one before.
// V29.5 -> mfc-v43. This one MUST move too: every page's mfc-finish.css
// reference steps 2920 -> 2950 for the shared phone layer (iOS text autosizing +
// the toast/WhatsApp de-collision), and assets are served cache-first keyed by
// the exact URL including ?v, so an installed PWA would otherwise hold both
// copies. login.html — the manifest start_url and a PRECACHED document, which
// no query string can bust — is one of the eight pages that gained the 16px
// touch rule, so the shell has to be re-installed for a member signing in on a
// phone to stop being zoomed into the email field.
// V29.6 -> mfc-v44. login.html — the manifest start_url and a PRECACHED
// document, which no query string can bust — changed this release: arriving with
// ?from=switcher (the dashboard's new "Find my other strategies" row) now
// retitles the page and suppresses the "Continue to your dashboard" shortcut,
// which is the one action that cannot help a member who came here precisely
// BECAUSE their dashboard only knows one strategy. An installed PWA holding the
// v43 shell would keep offering that shortcut and the switcher fix would not
// reach it. index.html is unchanged this release and no shared asset moved — the
// rest of the work is inline in strategies.html and dashboard.html, both
// network-first — but the shell has to be re-installed for the above.
// V29.7 -> mfc-v45. dashboard.html is network-first and needs no cache move, but
// the token-cookie fix changes how a session is READ, and an installed PWA that
// kept a v44 shell would keep pairing the old login.html with it. Bumped to keep
// the cache name monotonic with the release and force one clean re-install.
// V29.8 -> mfc-v46. THIS ONE MUST MOVE, and it is a purge, not a refresh: the
// v45 cache holds `/dashboard.html?token=MFC…` entries — real member access
// tokens written to disk by the HTML branch's blanket put(), one per emailed
// link and one per V29.7 strategy switch. activate() deletes every cache whose
// name is not CACHE, so bumping the name is what actually removes them from a
// browser that already has them. The exclusion added to the fetch handler stops
// new ones; this bump clears the ones already there.
// V29.8c -> mfc-v47. dashboard.html gains the stale-tab notice, which only ever
// fires on `controllerchange` — i.e. when a NEWER worker takes over an open tab.
// Bumping the cache name is what makes that transition happen for everyone
// currently holding v46, so the notice ships and is exercised in the same move.
// V29.9 -> mfc-v48. dashboard.html changes again (the open menu now tracks the
// pill, and the attention nudge stops when the menu opens). dashboard.html is
// network-first and excluded from the cache since v46, so this bump is not what
// delivers it — but it IS what makes `controllerchange` fire, which is how an
// already-open tab learns to offer the reload that picks the change up. Keeping
// the name monotonic with the release is the point.
// V30.0 -> mfc-v49. THIS ONE MUST MOVE for two independent reasons. index.html is
// precached as the offline navigation fallback and it changed substantively: the
// "Popular" and "Free" ribbons are recoloured (both failed AA against white), the
// WhatsApp bubble's dismiss gains the 28px hit pad the rest of the site got in
// V28.0, and the FAQ answers now animate open. Separately, BOTH shared assets moved
// — mfc-finish.css and mfc-offer.js are cached first-party keyed by exact URL, so a
// returning visitor holding v48 would keep the old copies of each. The ?v strings
// were bumped to 3000 on all 49 / 19 referencing pages (and in export_static.py, so
// the 28 generated directory pages do not drift back), and the cache name moves with
// them so nothing is served from a stale entry.
// V30.1 -> mfc-v50. Load-bearing twice. (1) mfc-finish.css moved: it gains the
// site-wide @media print block that stops every page painting its floating screen
// chrome onto paper. That file is cached first-party keyed by the EXACT url, so a
// returning visitor holding v49 would keep the old copy — its ?v went 3000 -> 3010
// on all 49 referencing pages AND in screener/export_static.py, so the 28
// generated directory pages do not drift back to the old pin the next time the
// data refresh regenerates them. (2) index.html is precached as the offline
// navigation fallback and changed: the four numbered step chips in "Ten minutes on
// the 1st" carry a brighter ink in dark mode (--accent2 measured 4.0:1 on that
// tinted chip, under AA). The bump is also what makes `controllerchange` fire, so
// an already-open tab learns to offer the reload that picks this up.
// V30.6 -> mfc-v51. mfc-finish.css moves again — the print block gains the two
// controls the V30.1 and V30.4 passes could not see: `.nav-hamburger` (not fixed,
// not floating, and shown on paper because the ≤1024px query resolves against the
// PAGE BOX) and `#mfcScrollProg` (minted by mfc-enhance.js, so it matched none of
// the three scroll-prog names the guard already listed). That file is cached
// first-party keyed by the EXACT url, so a returning visitor holding v50 would
// keep the old copy: its ?v went 3040 -> 3050 on all 49 referencing pages AND in
// screener/export_static.py — which was still pinned at 3010 and would have
// dragged the 28 generated directory pages back two releases on the next data
// refresh. index.html is precached as the offline navigation fallback and carries
// the new ?v, so the shell has to be refetched regardless.
// V30.8 -> mfc-v52. THIS ONE IS A PRICE CHANGE, which makes the precached shell a
// commercial liability rather than a cosmetic one: index.html is cached below as
// the offline navigation fallback and now carries ₹999 / ₹1,499 (was ₹1,499 /
// ₹2,499), the three new recommended-investment figures, the two broker-verified
// Zerodha P&L links in the proof bar, and a new FAQ answer. Online visitors are
// safe — navigations are network-first — but an INSTALLED app opening cold would
// quote a price we no longer charge, straight off disk, with no ?v of its own to
// bust. No shared docs/assets/ file changed this release (every rule is page-local
// inline CSS), so nothing is owed a ?v bump; the cache name is again the only
// version these documents have.
// V31.0 -> mfc-v53. index.html is precached below as the offline navigation
// fallback and gains a whole new block: the two-account verified strip under the
// strategy grid, with both broker links and two live model figures. An installed
// app opening cold on the v52 shell would show the pricing it was given in V30.8
// and none of the proof that now sits directly beneath it — and a precached
// document has no ?v of its own to bust. No shared docs/assets/ file changed this
// release (every rule is page-local inline CSS), so nothing else is owed a bump.
// V31.2 -> mfc-v54. index.html is precached as the offline navigation fallback
// and it changed this release (the Market-Pulse sentiment glyph and the SEBI
// shield both move off hardcoded light inks, and two criterion icons gain a dark
// tier). A precached document has no ?v of its own to bust, so an installed app
// opening cold on v53 would keep serving the V31.1 homepage. mfc-finish.css also
// changed — it is cache-FIRST here, keyed by exact URL including ?v — and its
// ?v moved 3050 -> 3060 on all 49 referencing pages plus the generator that
// rewrites the 28 stock-directory pages, so returning visitors get the toast fix.
// V31.3 -> mfc-v55. index.html is precached as the offline navigation fallback
// and it changed twice this release: the hero chart's value readout stops being
// mouse-only (it now works on touch and from the keyboard, which is the whole
// point of the change on the device an installed app runs on), and the
// "Multi-Asset" category pill moves to teal-800. A precached document has no ?v
// of its own to bust, so an installed app opening cold on v54 would keep serving
// a homepage whose flagship chart a phone cannot read. No file under
// docs/assets/ changed this release — every rule and script here is page-local —
// so no ?v bump is owed anywhere and export_static.py needs no edit.
// V31.4 -> mfc-v56. index.html is precached as the offline navigation fallback
// and it changed twice this release: the Market Pulse card gains a 20-session
// combined-net strip (drawn from cash_history the card was already fetching and
// never using), and the Nifty driver chip stops calling a flat day an up day.
// A precached document has no ?v of its own to bust, so an installed app opening
// cold on v55 would keep showing the homepage without either. dashboard.html is
// NOT precached — it is network-first — so the portfolio map's return-by-default
// ranking and its spread strip reach members with no cache step at all, and the
// three strategy pages and the Scanner are network-first for the same reason.
// No file under docs/assets/ changed this release — every rule and script added
// here is page-local — so no ?v bump is owed anywhere and export_static.py needs
// no edit.
//
// V31.5 -> mfc-v57. THREE shared assets moved this release and all three are
// served cache-first keyed by the exact URL:
//   • LogoNav.png and LogoNav-dark.png were re-cut. The 256x256 canvas carried
//     34% transparent margin, so the mark painted at 24x20 inside the 44px box
//     the CSS reserves and the baked "MindForge CAPITAL" wordmark rendered ~5px
//     tall — illegible on every page of the site. Cropped to the artwork's own
//     alpha bounds (142x116); the artwork itself is untouched. Every <img src>
//     gains ?v=b1f0c2 (49 pages, incl. the 34 generated directory pages and
//     export_static.py, whose tag also had no width attribute at all), and the
//     DARK file — referenced only from mfc-finish.css's content:url() where
//     there is no per-page src — gains the same token there.
//   • mfc-finish.css 3060 -> 3070 for that url() change, on all 49 pages AND in
//     export_static.py, which regenerates 28 of them and has reverted this bump
//     before (V31.4) when the scheduled refresh ran mid-session.
//   • index.html is a PRECACHED document with no ?v of its own and it changed,
//     so an installed app opening cold on v56 would keep serving the old shell.
// The <img> aspect hints moved with the file: width/height were 80x80 for the
// square canvas and are now 98x80 (same 142:116 ratio), because a stale hint is
// a layout shift, not a cosmetic detail.
// V31.7 -> mfc-v58. ONE shared asset moved: assets/mfc-live.js 2910 -> 2920,
// whose injected `.live-vs-a` rule gained `white-space:nowrap` so the rounded
// live-alpha pill on the homepage stops breaking in half across a line (it did,
// at 360px and at 1024px, on two of the three strategy cards). FIVE pages load
// the file — index, strategies and the three strategy pages. dashboard.html was
// bumped too and should not have been: its only mention of mfc-live.js is inside
// a comment, so it has no <script src> to version. Caught by the live check,
// which found neither token in the served dashboard bytes once comments were
// stripped; the stale version has been taken out of that comment rather than
// kept in lockstep for a file the page never fetches.
// index.html is a PRECACHED document with no ?v of its own, and
// carrying that new token is a change to its bytes, so an installed app opening
// cold on v57 would keep serving the shell that points at 2910. Same reason as
// the V31.5 entry above; the rest of this release is page-local CSS/JS on
// calculator, dashboard and the three legal pages, which are network-first and
// owe no bump.
// V31.8 -> mfc-v59. assets/mfc-live.js 2920 -> 2930: the stat-card live value's
// size ladder gained a step under 300px, where 25px was 2.4px wider than the box
// it centres in. FIVE pages carry the token — index, strategies and the three
// strategy pages — and index.html is a PRECACHED document with no ?v of its own,
// so its new bytes are the reason this constant moves at all. The rest of the
// release is page-local: a pinned header and a scroll-edge cue on the Scanner, a
// frozen identity pair and the same cue on the Integrity Score, and 24 rewritten
// weight values on strategies.html. All of those are network-first HTML.
// V32.8 -> mfc-v67. index.html is the offline navigation fallback, carries no ?v
// of its own, and this release cuts two blocks out of it: the verified-P&L item
// leaves the proof bar (the broker-verified strip below already carries both
// links in full) and the after-tax band leaves the page entirely for
// strategies.html. An offline shell still serving the old copy would show a
// duplicated claim and a band that no longer exists anywhere on this page.
// No shared asset changed — every rule removed was page-local — so no ?v token
// steps. One dead selector is knowingly left behind in assets/mfc-finish.css
// (`.sp-wt-fill`, in its print-colour block): removing it would cost a ?v bump on
// all 49 pages to delete a print rule with no element to apply to.
// V32.7 -> mfc-v66. index.html is the offline navigation fallback, carries no ?v
// of its own, and this release rewrites it again: the after-tax bar gained a
// caption that names both shares of the split and now grows when the card is seen
// rather than at load. Online visitors get the new page anyway (HTML is
// network-first); what goes stale without this constant is the offline shell.
// No shared asset changed — the caption, the comparison-row emphasis and the
// dashboard's weight gauge are all page-local — so no ?v token steps.
// V32.6 -> mfc-v65. index.html is the offline navigation fallback, carries no ?v
// of its own, and this release rewrites every backtest figure on it: the site now
// publishes POST-TAX returns, so the homepage's hero card, strategy cards, FAQ and
// the new after-tax band all changed bytes. Online visitors get the new page
// anyway (HTML is network-first); what goes stale without this constant is the
// offline shell, which would keep serving GROSS figures under labels that no
// longer exist elsewhere on the site — the worst possible thing for it to cache.
// No shared asset changed again this release: the after-tax band and the rebuilt
// comparison blocks carry page-local CSS, so no ?v token steps.
// V32.3 -> mfc-v64. index.html is the offline navigation fallback and carries no
// ?v of its own, and this release rewrites it: the broker-verified strip moves
// from under the pricing grid to the top of the page and grows a backtest row.
// HTML is network-first, so an ONLINE visitor already gets the new bytes without
// this constant moving — what goes stale without it is the offline shell, which
// would keep serving a V32.3 homepage (verified P&L 3,000px down, no backtest row)
// to an installed app with no connection. No shared asset changed this release —
// the strip's CSS is page-local on both pages that use it — so no ?v token steps
// and strategies.html, which is not precached, needs nothing at all.
// V32.1 -> mfc-v63. THIS ONE MUST MOVE. The release adds a print block to the
// shared assets/mfc-finish.css — the one that stops nine pages printing their
// proportion bars as empty grey tracks — so its ?v token steps 3090 -> 3100 on
// all 50 pages that link it. BOTH precached documents are in that set:
// index.html is the offline navigation fallback and login.html is the manifest
// start_url, and neither carries a ?v of its own, so an installed app would
// keep serving the old bytes (and therefore the old stylesheet URL) until this
// constant moves. The stylesheet itself needs no help — a new ?v is a new URL
// and cache-first fetches it — but the DOCUMENTS pointing at it do.
// Everything else this release is page-local network-first HTML: the dark-mode
// symbol ink on the per-stock not-found panel, filter-select focus parity on
// the Scanner, slider press feedback on the calculator, and the 404 page's
// strategy links rebuilt as route cards.
// V32.9 -> mfc-v68. THIS ONE MUST MOVE. index.html is precached as the offline
// navigation fallback and carries no ?v of its own, and this release rewrites its
// text: the &nbsp; bindings that stop "after tax", a number and its unit, or a
// fund name being torn across a line, plus the page-local mf-v329-linebreak style
// block. An installed app would keep printing the old breaks until this constant
// moves. login.html is untouched this release but rides the same bump — the
// precache is written whole, not per-file. Everything else changed here is
// network-first HTML (strategies, the three strategy pages, Scanner, Integrity
// Score, FII/DII, factor report, calculator, recover, dashboard) and needs no bump.
// V33.3 -> mfc-v71. THIS ONE MUST MOVE, for the reason the V33.1 note above
// spells out: mfc-finish.css goes 3310 -> 3320 on all 49 pages, and both
// PRECACHED documents point at it while carrying no ?v of their own. index.html
// is the offline navigation fallback and also changed in its own right (the hero
// alpha chip may now wrap instead of being clipped at 320); login.html is
// untouched but rides the bump because the precache is written whole.
// Everything else this release is network-first HTML — the three strategy pages
// (dark-theme charts, zoom-pill layout), Integrity Score (card-mode specificity,
// the fifth lens, the SVG icons), the Scanner, FII/DII (the rebuilt trend chart)
// and the three legal pages.
// V33.7 -> mfc-v74. THIS ONE MUST MOVE, same mechanic as V33.3 above, and this
// time for TWO cache-first assets rather than one: mfc-finish.css goes
// 3350 -> 3370 on all 49 pages (it gains the line-breaking block) and
// mfc-chrome.js goes 7 -> 3370 on all 45 that load it (it gains the footer
// clearance that keeps the injected back-to-top button off the page's last
// line). Both PRECACHED documents link mfc-finish.css and login.html links
// mfc-chrome.js too — index.html registers the SW inline and does NOT load that
// script, only mentions it in a comment — and neither document carries a ?v of
// its own, so a returning installed-app user would otherwise keep the old
// assets indefinitely. login.html is otherwise untouched but rides the bump
// because the precache is written whole, not per-file.
// mfc-dir.css also moved (2920 -> 3370), but none of its 28 generated pages is
// precached, so that one alone would not have required a bump.
// Everything else this release is network-first HTML — the Integrity Score
// table (its rows now carry a full aria-label), the per-stock company template
// (the two financial columns are rebalanced) and the three auth pages.
// V33.8 -> mfc-v75. THIS ONE MUST MOVE for the PRECACHED DOCUMENT itself, not
// for an asset it links: index.html is in ASSET_PATHS as the offline navigation
// fallback, and this release rewrites its body text. The whole "25 stocks /
// 3-per-industry" vocabulary is retired across the site — the two equity books
// now hold 10 and 15 names capped at 2 per industry — and index.html carries
// that copy in its hero pipeline heading, both strategy cards, the funnel rail
// and the FAQ (plus its FAQPage JSON-LD twin). Every published figure moved too
// (the fresh Aug-2026 backtest: SmallMicro 30.6% -> 39.6% post-tax, LargeMidcap
// 24.0% -> 29.8%). A returning installed-app user opening offline would
// otherwise be served a shell still promising 25 equal-weighted picks and last
// month's CAGRs. login.html is unchanged this release but shares the cache, so
// it is simply re-installed alongside.
// V34.1 -> mfc-v76. THIS ONE MUST MOVE on both counts at once. (1) The
// PRECACHED DOCUMENT itself: index.html gains the drawer-sizing measurement in
// its own nav IIFE (it does not load mfc-chrome.js), so an installed-app user
// opening the offline shell would otherwise keep the drawer that runs past the
// bottom of the screen. (2) Two cache-first ASSETS both go 3370 -> 3380 —
// mfc-finish.css on all 50 pages (the drawer's max-height becomes a custom
// property, and the sticky CTA bar gains its short-viewport rule) and
// mfc-chrome.js on all 46 that load it (it publishes the measured drawer top).
// Both precached documents link the stylesheet and login.html links the script,
// and neither document carries a ?v of its own. login.html is otherwise
// untouched but rides the bump because the precache is written whole.
// mfc-dir.css did NOT change and deliberately stays at 3370; its 28 generated
// pages did (they gain the "Recover Access" nav link every other page has), but
// they are network-first HTML and none of them is precached.
// V34.5 -> mfc-v77. THIS ONE MUST MOVE for a PRECACHED DOCUMENT: login.html is
// in ASSET_PATHS as the manifest start_url — the installed app's entry point —
// and this release changes it. Its first field loses the `autofocus` attribute
// (re-applied by script only where there is a real mouse, so an Android visitor
// no longer has the keyboard opened for them and the <h1> scrolled away), the
// email and one-time-code fields gain enterkeyhint, and both gain a keydown
// binding so the phone keyboard's Go key activates the page's own button instead
// of doing nothing. The precache is only rewritten when the cache NAME changes —
// the service worker runs addAll on install, not on activation — so without this
// bump an installed-app user would keep the old login shell indefinitely and
// never get any of it. index.html is unchanged this release but shares the cache
// and is simply re-installed alongside.
// No shared asset moved, so the ?v tokens stay put: mfc-finish.css and
// mfc-chrome.js at 3380, mfc-dir.css at 3370. signup.html, recover.html and
// scores/company.html also changed but none of them is precached — they are
// network-first HTML and need nothing here.
// V34.6 -> mfc-v78. index.html — the PRECACHED offline navigation fallback —
// gains a <script src> for mfc-chrome.js, which it had never loaded. That file
// carries this release's nav-drawer focus management, and the page was one of
// exactly three where opening the mobile menu and pressing Tab walked out of the
// drawer into the content behind it. addAll runs on INSTALL and not on
// activation, so the precache is only rewritten when this NAME changes: left at
// v77, an installed-app user opening offline would keep an index.html with no
// such script tag indefinitely and never receive the fix. login.html is
// unchanged this release but shares the cache and is re-installed alongside.
// The cache-first ASSET is handled by its own token rather than by this name —
// mfc-chrome.js goes 3380 -> 3390 on all 49 pages that now load it (46 before,
// plus index, strategies and screener), and caches.match() keys on the full URL
// including the query, so the new token is simply a miss and fetches fresh.
// mfc-finish.css stays at 3380 and mfc-dir.css at 3370: neither file changed.
// The other seven edited pages — calculator, strategies, smallmicro,
// largemidcap, fii-dii, disclosures, screener — are network-first HTML and need
// nothing here.
// V34.7 -> mfc-v79. Routine on its face and REQUIRED underneath: this release
// moves mfc-finish.css 3380 -> 3400 on all 50 pages, and two of those pages —
// login.html (the manifest start_url) and index.html (the offline navigation
// fallback) — are PRECACHED DOCUMENTS. Their bytes therefore change, because the
// ?v in their <link> changes, and addAll runs on INSTALL and not on activation:
// left at v78 an installed-app user opening offline would keep a shell asking
// for mfc-finish.css?v=3380 forever, which offline is a cache hit on the OLD
// stylesheet and so never receives this release's overscroll containment.
// The stylesheet itself is a cache-first ASSET and is handled by its own token
// rather than by this name — caches.match() keys on the full URL including the
// query, so ?v=3400 is simply a miss and fetches fresh.
// mfc-chrome.js stays at 3390 and mfc-dir.css at 3370: neither file changed.
// The other four edited pages — scores/index, scores/company, screener/index and
// signup — are network-first HTML and need nothing here beyond the token they
// already carry.
// V34.8 -> mfc-v80. index.html is a PRECACHED DOCUMENT — the offline navigation
// fallback — and this release rewrites a large part of it: a new free-tools
// section ahead of the pricing, the pricing ladder reordered to descend from
// ₹1,499, a fee-anchor panel above the cards, a ten-year cost line inside each
// card, the first `?strategy=` links this site has ever shipped, and the
// "Honest pricing" card reframed. addAll runs on INSTALL and not on activation,
// so the precache is only rewritten when this NAME changes: left at v79 an
// installed-app user opening offline would keep a shell with the old ascending
// ladder, no free-tools section, and CTAs that cannot pre-select a strategy —
// which is also the state that makes signup's 33% step unreachable.
// login.html is unchanged this release but shares the cache and is simply
// re-installed alongside.
// No shared asset moved, so the ?v tokens stay put: mfc-finish.css and
// mfc-chrome.js at 3400/3390, mfc-dir.css at 3370. calculator.html and
// signup.html also changed and are network-first HTML — they need nothing here.
// V34.9 -> mfc-v81. index.html is the PRECACHED offline navigation fallback and
// changes again this release: the fee-anchor panel gains two proportional bars,
// a count-up and the aurora hairline; the free-tools cards gain the page's own
// reveal-stagger and the magnetic shine; the section rejoins the site's padding
// ladder; and .strat-card's radius is unified at 18px. addAll runs on INSTALL
// and not on activation, so left at v80 an installed-app user opening offline
// would keep a shell with none of it.
// No shared asset moved: mfc-finish.css stays at 3400, mfc-chrome.js at 3390,
// mfc-dir.css at 3370. calculator.html, signup.html, dashboard.html and
// screener/index.html also changed and are network-first HTML — they need
// nothing here.
// V35.0 -> mfc-v82. index.html is the PRECACHED offline navigation fallback and
// its bytes change again this release — two internal comments that quoted the
// SmallMicro card's meta as "25 stocks" now read "15 stocks" (the card itself
// always rendered 15; the comments were stale and had propagated the count the
// strategy pages were corrected for this release). No rendered pixel of the
// offline shell moves, but the precache must match the served bytes, and addAll
// runs on INSTALL not activation — so left at v81 an installed-app user would
// keep the older copy. The release's real work — the strategy pages' holdings
// count/cap corrected to 10 & 15 / cap 2, and the equal-weight pip strip added
// to their hero tiles — is on network-first HTML and needs nothing here. No
// shared asset moved.
// V35.1 -> mfc-v83. index.html's mfc-finish.css token moved (3400 -> 3410).
// V35.2 -> mfc-v84. BOTH precached documents change this release, and both change
// visibly: index.html gains the "Pricing" nav item (a 10th link, on every page)
// and login.html gains the standalone-launch redirect plus the resume-state
// heading — i.e. the very file the installed app opens. Their shared
// mfc-finish.css token also moves 3410 -> 3420 for the nav-fit band that keeps
// ten links on one row between 1025 and 1099px. addAll() runs on INSTALL, not on
// activation, so left at v83 an installed member would keep the old shell and,
// worse, keep the login page WITHOUT the redirect this release exists to add.
const CACHE = 'mfc-v84';
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

  // V29.8 — NEVER cache the member dashboard, under any query string.
  // The HTML branch below is network-first, but it still PUTs every navigation
  // response into the cache keyed by the full request url. dashboard.html is
  // reached with ?token=<access token> — from every emailed access link, and
  // (V29.7 only) from every strategy switch — so that put wrote entries literally
  // named `/dashboard.html?token=MFC…` into CacheStorage on disk, along with the
  // member's rendered dashboard. Three were found in one live session.
  // Nothing is lost by excluding it: the page is token-gated, so an offline copy
  // is useless to anyone who should see it and a liability to everyone else.
  // A failed fetch falls back to the offline shell rather than to a stale book.
  if (url.pathname === '/dashboard.html' || url.pathname.endsWith('/dashboard.html')) {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }

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

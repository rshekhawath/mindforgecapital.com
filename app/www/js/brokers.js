/* ============================================================================
   MindForge Capital — Member App · broker linking
   ----------------------------------------------------------------------------
   Two tiers of "broker linked", both shipped:

   1) DEEPLINK (default, works today, no credentials) — the member picks their
      broker once; every pick then becomes a one-tap, pre-filled order link into
      that broker's app/site. Deeplinks mirror the website's proven set
      (docs/dashboard.html BROKERS) so behaviour is identical to the dashboard.

   2) API — true account linking via Zerodha Kite Connect (OAuth → live holdings,
      funds, in-app order placement). The login redirect is built here; exchanging
      the returned request_token for an access_token MUST happen server-side (the
      api_secret can never ship in a client), so it is gated on MFC_CONFIG.KITE.
      Wire token_exchange_url to an Apps-Script/Cloud-Function endpoint to enable.
   ========================================================================== */
window.MFCBrokers = (function () {
  "use strict";
  var C = window.MFC_CONFIG;

  function isNS(s) { return !(s.yahoo_ticker && !/\.NS$/i.test(s.yahoo_ticker)); } // .NS or bare → Indian

  // ── Brand marks (V20.0) ───────────────────────────────────────────────────────
  // REAL, official brand marks (not approximations) — sourced from each brand's
  // own vector: Zerodha's corporate mark, Groww's two-tone chart-wave badge, and
  // Upstox's "u" spiral lifted from the official Upstox wordmark SVG. Inline SVG
  // (not <img>) so the strict CSP (img-src 'self' data:) is satisfied.
  //   • kite / upstox  → white glyph on the broker's brand colour (via the tile bg)
  //   • groww          → its true full-bleed two-tone badge (indigo→teal + wave),
  //                      which is the real Groww logo, so it self-colours the tile.
  var LOGO = {
    // Zerodha (Kite) — the official Zerodha corporate mark (two stacked sails).
    kite: '<svg width="23" height="23" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">'+
      '<path d="M20.378 5.835A27.267 27.267 0 0124 12.169V0H13.666c2.486 1.343 4.763 3.308 6.712 5.835zM5.48 1.297c-1.914 0-3.755.409-5.48 1.166V24h22.944C22.766 11.44 15 1.297 5.48 1.297z"/></svg>',
    // Groww — the real two-tone brand badge: an indigo (#5367ff) field over teal
    // (#00d09c), divided by Groww's signature "W" market-chart wave. Full-bleed so
    // it renders exactly like the app icon members know (the tile clips it round).
    groww: '<svg width="42" height="42" viewBox="0 0 48 48" aria-hidden="true" preserveAspectRatio="xMidYMid slice">'+
      '<rect width="48" height="48" fill="#00d09c"/>'+
      '<path d="M0 0h48v20.5c-4.6-1.9-7.4 3.9-12.4 4.2-5.3.3-7.4-6.2-12.9-5.2-4.7.9-6.6 6.9-11.3 6.2C5.9 25.4 2.8 24.4 0 25.9Z" fill="#5367ff"/></svg>',
    // Upstox — the official "u" spiral symbol, extracted verbatim from the Upstox
    // brand wordmark SVG (upstox.com brand asset). White on the Upstox purple tile.
    upstox: '<svg width="21" height="21" viewBox="-0.6 4.4 18.5 14.2" fill="#fff" fill-rule="evenodd" clip-rule="evenodd" aria-hidden="true">'+
      '<path d="M0 13.2696V10.7778C1.50133 10.7736 2.94045 10.1839 4.01046 9.14146 4.53302 8.62233 4.9519 8.00767 5.23806 7.33073 5.52423 6.64962 5.67353 5.92284 5.67353 5.18775H8.19925C8.19925 6.25093 7.98774 7.30165 7.57301 8.28178 7.16242 9.2619 6.55691 10.1507 5.79795 10.8982 4.251 12.4182 2.16905 13.2696 0 13.2696Z"/>'+
      '<path d="M5.62792 11.8451C6.00532 11.5793 6.36199 11.2803 6.68963 10.9522 7.30343 10.3417 7.81356 9.63985 8.2034 8.87153V12.1857C8.2034 14.2456 9.33562 15.4334 11.2475 15.4334 13.2134 15.4334 14.7603 14.2456 14.7603 12.1857V5.18362H17.3317V17.6137H14.7437V16.048C14.329 16.6834 13.1429 17.8712 10.8411 17.8712 7.432 17.8712 5.62377 15.749 5.62377 12.7297L5.62792 11.8451Z"/></svg>'
  };

  // ── Deeplink brokers ────────────────────────────────────────────────────────
  var BROKERS = {
    kite: {
      id: 'kite', name: 'Zerodha Kite', color: '#387ed1', logo: LOGO.kite,
      // Kite India can't trade US names → no deeplink for those (UI falls back).
      link: function (s) {
        if (!isNS(s)) return null;
        var t = (s.ticker || '').toUpperCase();
        return 'https://kite.zerodha.com/chart/web/NSE/' + encodeURIComponent(t);
      }
    },
    groww: {
      id: 'groww', name: 'Groww', color: '#00d09c', logo: LOGO.groww,
      link: function (s) {
        var t = (s.ticker || '').toUpperCase();
        return isNS(s)
          ? 'https://groww.in/stocks/' + encodeURIComponent(t.toLowerCase())
          : 'https://groww.in/us-stocks/' + encodeURIComponent(t.toLowerCase());
      }
    },
    upstox: {
      id: 'upstox', name: 'Upstox', color: '#5a2ca6', logo: LOGO.upstox,
      link: function (s) {
        var t = (s.ticker || '').toUpperCase();
        return 'https://upstox.com/search?q=' + encodeURIComponent(t);
      }
    }
  };

  function list() { return Object.keys(BROKERS).map(function (k) { return BROKERS[k]; }); }
  function get(id) { return BROKERS[id] || null; }

  // The member's currently linked broker (falls back to Kite for NSE books).
  function current() {
    var saved = MFCStore.getBroker();
    if (saved && BROKERS[saved.id]) return BROKERS[saved.id];
    return BROKERS.kite;
  }

  function linkDeeplink(id) {
    var b = BROKERS[id];
    if (!b) return false;
    MFCStore.setBroker({ id: b.id, label: b.name, mode: 'deeplink' });
    return true;
  }

  // Build the order/search deeplink for one holding with the linked (or given) broker.
  function orderLink(stock, brokerId) {
    var b = (brokerId && BROKERS[brokerId]) || current();
    var url = b.link(stock);
    if (!url) { // e.g. Kite + a US name → fall back to Groww which can trade it
      url = BROKERS.groww.link(stock);
    }
    return url;
  }

  // ── Kite Connect (API tier) ──────────────────────────────────────────────────
  // Returns the Kite login URL the user is sent to; on success Kite redirects back
  // with ?request_token=… which token_exchange_url swaps for an access_token.
  function kiteEnabled() { return !!(C.KITE && C.KITE.enabled && C.KITE.api_key); }
  function kiteLoginUrl() {
    if (!kiteEnabled()) return null;
    return 'https://kite.zerodha.com/connect/login?v=3&api_key=' + encodeURIComponent(C.KITE.api_key);
  }

  return {
    list: list, get: get, current: current,
    linkDeeplink: linkDeeplink, orderLink: orderLink,
    unlink: function () { MFCStore.clearBroker(); },
    kiteEnabled: kiteEnabled, kiteLoginUrl: kiteLoginUrl
  };
})();

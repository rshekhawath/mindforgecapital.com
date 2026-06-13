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

  // ── Deeplink brokers ────────────────────────────────────────────────────────
  var BROKERS = {
    kite: {
      id: 'kite', name: 'Zerodha Kite', color: '#387ed1', logo: 'Z',
      // Kite India can't trade US names → no deeplink for those (UI falls back).
      link: function (s) {
        if (!isNS(s)) return null;
        var t = (s.ticker || '').toUpperCase();
        return 'https://kite.zerodha.com/chart/web/NSE/' + encodeURIComponent(t);
      }
    },
    groww: {
      id: 'groww', name: 'Groww', color: '#00b386', logo: 'G',
      link: function (s) {
        var t = (s.ticker || '').toUpperCase();
        return isNS(s)
          ? 'https://groww.in/stocks/' + encodeURIComponent(t.toLowerCase())
          : 'https://groww.in/us-stocks/' + encodeURIComponent(t.toLowerCase());
      }
    },
    upstox: {
      id: 'upstox', name: 'Upstox', color: '#5a32a3', logo: 'U',
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

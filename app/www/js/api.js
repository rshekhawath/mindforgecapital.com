/* ============================================================================
   MindForge Capital — Member App · API client
   ----------------------------------------------------------------------------
   Thin wrapper over the existing Apps Script backend. All calls are simple GETs
   (no CORS preflight) returning JSON {status:'ok'|'error', ...}. Each method
   resolves with the payload or throws an Error with a user-readable message.
   ========================================================================== */
window.MFCApi = (function () {
  "use strict";
  var BASE = window.MFC_CONFIG.APPS_SCRIPT_URL;

  function qs(params) {
    return Object.keys(params)
      .filter(function (k) { return params[k] != null && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
      .join('&');
  }

  // GET the backend with an action + params. Adds a cache-buster. Times out so a
  // flaky network surfaces as a friendly error instead of a hung spinner.
  function call(action, params, timeoutMs) {
    params = params || {};
    params.action = action;
    params._ = Date.now();
    var url = BASE + '?' + qs(params);
    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 20000) : null;

    return fetch(url, { method: 'GET', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        if (timer) clearTimeout(timer);
        if (!r.ok) throw new Error('Network error (' + r.status + '). Please try again.');
        return r.json();
      })
      .then(function (data) {
        if (!data || data.status === 'error') {
          throw new Error((data && data.error) || 'Something went wrong. Please try again.');
        }
        return data;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        if (err.name === 'AbortError') throw new Error('The request timed out. Check your connection and try again.');
        // A bare "Failed to fetch" is almost always offline / CORS — make it human.
        if (/failed to fetch/i.test(err.message)) throw new Error('Can’t reach the server. Check your connection and try again.');
        throw err;
      });
  }

  return {
    // Email OTP login
    requestOtp: function (email) { return call('request_otp', { email: email }); },
    verifyOtp:  function (email, otp) { return call('verify_otp', { email: email, otp: otp }); },
    // Holdings for one subscription token → { subscription, stocks:[...] }
    stocks:     function (token) { return call('stocks', { token: token }); },
    // Live quotes for a comma-joined ticker list → { prices: {...} } (best-effort)
    prices:     function (tickers) { return call('prices', { tickers: tickers }, 25000); },
    // "Email me my dashboard links" fallback
    recover:    function (email, phone) { return call('recover', { email: email, phone: phone }); }
  };
})();

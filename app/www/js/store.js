/* ============================================================================
   MindForge Capital — Member App · session + local state
   ----------------------------------------------------------------------------
   Persists the signed-in person (email + their subscriptions/tokens) and the
   chosen broker. The bearer tokens live in localStorage on-device only — they
   are NEVER placed in the URL (same hardening as the V11.4 website dashboard).
   All access is guarded so private-mode / disabled storage degrades gracefully.
   ========================================================================== */
window.MFCStore = (function () {
  "use strict";
  var C = window.MFC_CONFIG;

  function read(key) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
    catch (e) { return null; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }
  function remove(key) { try { localStorage.removeItem(key); } catch (e) {} }

  return {
    // ── Session ──────────────────────────────────────────────────────────────
    // { email, name, subscriptions:[{token,strategy,status,expires_at,name}], createdAt }
    getSession: function () { return read(C.SESSION_KEY); },
    isSignedIn: function () { var s = read(C.SESSION_KEY); return !!(s && s.subscriptions && s.subscriptions.length); },
    setSession: function (email, subscriptions) {
      var name = '';
      (subscriptions || []).some(function (s) { if (s.name) { name = s.name; return true; } return false; });
      return write(C.SESSION_KEY, {
        email: email,
        name: name,
        subscriptions: subscriptions || [],
        createdAt: Date.now()
      });
    },
    signOut: function () { remove(C.SESSION_KEY); /* keep broker pref across sign-outs */ },

    activeSubscriptions: function () {
      var s = read(C.SESSION_KEY);
      if (!s) return [];
      return (s.subscriptions || []).filter(function (x) { return String(x.status).toLowerCase() === 'active'; });
    },
    subscriptionByToken: function (token) {
      var s = read(C.SESSION_KEY);
      if (!s) return null;
      return (s.subscriptions || []).filter(function (x) { return x.token === token; })[0] || null;
    },

    // ── Broker preference ────────────────────────────────────────────────────
    // { id, label, linkedAt, mode:'deeplink'|'api', account? }
    getBroker: function () { return read(C.BROKER_KEY); },
    setBroker: function (broker) { return write(C.BROKER_KEY, Object.assign({ linkedAt: Date.now() }, broker)); },
    clearBroker: function () { remove(C.BROKER_KEY); }
  };
})();

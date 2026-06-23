/* ============================================================================
   MindForge Capital — Member App · appearance (Auto / Light / Dark)
   ----------------------------------------------------------------------------
   Loaded SYNCHRONOUSLY in <head> *before* the stylesheet so the resolved theme
   is on <html data-theme> before first paint — zero flash, even for users who
   pinned Light or Dark. The *preference* (auto|light|dark) is persisted; 'auto'
   follows the OS appearance live via matchMedia (the iOS/Android default).

   The CSS only needs a single `:root[data-theme="dark"]` block because we resolve
   'auto' → a concrete 'dark'/'light' attribute here (no @media duplication).
   CSP-safe: external 'self' script, no inline. Storage-guarded for private mode.
   ========================================================================== */
(function () {
  "use strict";
  var KEY = 'mfc_app_theme_v1';
  // theme-color drives the iOS status bar / Android toolbar tint when installed.
  var META = { dark: '#0a1020', light: '#1a50d8' };
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function pref() { try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; } }
  function resolve(p) {
    p = p || pref();
    if (p === 'dark' || p === 'light') return p;
    return (mq && mq.matches) ? 'dark' : 'light';
  }
  function setMeta(scheme) {
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', scheme === 'dark' ? META.dark : META.light);
  }
  function apply() {
    var scheme = resolve();
    root.setAttribute('data-theme', scheme);
    setMeta(scheme);
  }
  function set(p) {
    if (p !== 'auto' && p !== 'light' && p !== 'dark') p = 'auto';
    try { localStorage.setItem(KEY, p); } catch (e) {}
    apply();
  }
  // Live-follow the OS appearance while the preference is 'auto'.
  if (mq) {
    var onChange = function () { if (pref() === 'auto') apply(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
  apply();

  window.MFCTheme = { get: pref, resolved: resolve, set: set, apply: apply, OPTIONS: ['auto', 'light', 'dark'] };
})();

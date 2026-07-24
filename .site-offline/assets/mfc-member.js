/*! mfc-member.js — V21.3. Member-aware homepage personalisation (additive, guest-safe).

   When a signed-in member (mfc_dash_token present) has a known strategy registry
   (the mfc_dash_strats cookie the dashboard writes as they open each access link),
   the matching strategy card(s) on the homepage gain a subtle "Your strategy" marker
   and a direct "Open dashboard" shortcut. It reuses the exact same cookie data that
   powers the dashboard's strategy switcher, so the marketing page reflects the member's
   session too.

   Guest-safe by design: with no session token, or an empty/blocked registry, this does
   NOTHING — signed-out and first-time visitors see the page byte-for-byte unchanged.
   Purely additive (injects its own pill + a footnote CTA, never restructures a card).
   Idempotent and reduced-motion-agnostic (no animation of its own). */
(function () {
  "use strict";

  function cookieGet(k) {
    try { var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + k + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; }
    catch (e) { return ''; }
  }
  // Mirror the dashboard's session contract: cookie first, then localStorage.
  function signedIn() {
    if (cookieGet('mfc_dash_token')) return true;
    try { return !!localStorage.getItem('mfc_dash_token'); } catch (e) { return false; }
  }
  function registry() {
    var raw = cookieGet('mfc_dash_strats');
    if (!raw) { try { raw = localStorage.getItem('mfc_dash_strats') || ''; } catch (e) {} }
    if (!raw) return {};
    try { var o = JSON.parse(raw); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
  }
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  ready(function () {
    try {
      if (!signedIn()) return;
      var reg = registry();
      var names = Object.keys(reg);
      if (!names.length) return;

      var mine = {};
      names.forEach(function (n) { mine[norm(n)] = true; });

      var cards = document.querySelectorAll('.strat-card');
      if (!cards.length) return;

      var matched = 0;
      Array.prototype.forEach.call(cards, function (card) {
        var nameEl = card.querySelector('.strat-name');
        if (!nameEl) return;
        if (!mine[norm(nameEl.textContent)]) return;
        if (card.querySelector('.strat-mine')) return;   // idempotent

        card.classList.add('is-mine');

        // "Your strategy" marker — brand-blue to echo the dashboard switcher's active item.
        var pill = document.createElement('span');
        pill.className = 'strat-mine';
        pill.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" ' +
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>' +
          '<span>Your strategy</span>';
        nameEl.insertAdjacentElement('afterend', pill);

        // Footer shortcut straight to the member dashboard (below the existing CTA).
        var footer = card.querySelector('.strat-footer');
        if (footer && !footer.querySelector('.strat-mine-cta')) {
          var link = document.createElement('a');
          link.className = 'strat-mine-cta';
          link.href = 'dashboard.html';
          link.innerHTML = 'Open your dashboard <span aria-hidden="true">&rarr;</span>';
          footer.appendChild(link);
        }
        matched++;
      });

      if (!matched) return;

      // Inject styles once, only when something actually matched.
      if (!document.getElementById('mfc-member-css')) {
        var css =
          '.strat-mine{display:inline-flex;align-items:center;gap:6px;margin:10px 0 2px;' +
            'padding:4px 11px;border-radius:999px;font-size:11.5px;font-weight:700;letter-spacing:.02em;' +
            'color:var(--accent2,#2563eb);background:rgba(37,99,235,.10);border:0.5px solid rgba(37,99,235,.30);}' +
          '.strat-mine svg{width:13px;height:13px;flex:0 0 auto;}' +
          '.strat-card.is-mine{border-color:rgba(37,99,235,.34);}' +
          '.strat-mine-cta{display:inline-flex;align-items:center;gap:6px;margin-top:10px;' +
            'font-size:13px;font-weight:600;color:var(--accent2,#2563eb);text-decoration:none;' +
            'transition:gap .2s ease,color .2s ease;}' +
          '.strat-mine-cta:hover{gap:9px;color:var(--accent,#1a50d8);}' +
          'html[data-theme="dark"] .strat-mine{color:var(--accent3,#83aaff);background:rgba(120,160,240,.14);border-color:rgba(120,160,240,.32);}' +
          'html[data-theme="dark"] .strat-card.is-mine{border-color:rgba(120,160,240,.4);}' +
          'html[data-theme="dark"] .strat-mine-cta{color:var(--accent3,#83aaff);}' +
          '@media(prefers-reduced-motion:reduce){.strat-mine-cta{transition:none;}}';
        var st = document.createElement('style');
        st.id = 'mfc-member-css';
        st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
      }
    } catch (e) { /* never break the page over a personalisation */ }
  });
})();

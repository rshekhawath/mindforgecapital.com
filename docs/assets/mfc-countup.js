/* ============================================================================
   MFC count-up — hero stat tiles roll from 0 to their value on first view.
   ----------------------------------------------------------------------------
   V9.6, shared + additive. Used by the three strategy pages, whose hero
   .stat-card .sv values are static text (the homepage proof strip and the
   dashboard already animate their own numbers — this fills the gap with the
   same easing/duration so the whole site feels uniform).

   Safety rules:
     • Only animates a value whose text is a bare number like "37.0%",
       "+21.68%", "-25.4%", "1.55" or "25" — anything else ("Medium",
       "₹2,499", "17,47,042") is left untouched.
     • Rewrites ONLY the first non-empty text node inside the element, so
       <!--MFSTAT:...--> comment markers around the value survive intact
       (the publish pipeline depends on them).
     • Runs once per element, when it scrolls into view.
     • prefers-reduced-motion → no animation.
   ========================================================================== */
(function () {
  "use strict";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var NUM_RE = /^([+\-]?)(\d{1,3}(?:\.\d+)?)(%?)$/;
  var DUR = 950;

  function findTextNode(el) {
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && n.nodeValue.trim() !== "") return n;
    }
    return null;
  }

  function animate(node, sign, target, suffix, decimals) {
    var start = performance.now();
    function step(now) {
      var t = Math.min(1, (now - start) / DUR);
      var eased = 1 - Math.pow(1 - t, 3);
      node.nodeValue = sign + (target * eased).toFixed(decimals) + suffix;
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    var els = document.querySelectorAll(".stat-card .sv, [data-mfc-countup]");
    if (!els.length) return;

    var targets = [];
    els.forEach(function (el) {
      if (el.dataset.mfcCounted) return;
      var node = findTextNode(el);
      if (!node) return;
      var m = node.nodeValue.trim().match(NUM_RE);
      if (!m) return;
      var dec = (m[2].split(".")[1] || "").length;
      targets.push({ el: el, node: node, sign: m[1], val: parseFloat(m[2]), suffix: m[3], dec: dec });
    });
    if (!targets.length) return;

    if (!("IntersectionObserver" in window)) return; // leave static values

    var byEl = new Map();
    targets.forEach(function (t) { byEl.set(t.el, t); });

    var fired = 0;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var t = byEl.get(entry.target);
        if (!t || entry.target.dataset.mfcCounted) return;
        entry.target.dataset.mfcCounted = "1";
        fired++;
        io.unobserve(entry.target);
        animate(t.node, t.sign, t.val, t.suffix, t.dec);
      });
    }, { threshold: 0.4 });

    targets.forEach(function (t) {
      t.orig = t.node.nodeValue;                   // V36.6 — keep the real text
      t.node.nodeValue = t.sign + (0).toFixed(t.dec) + t.suffix; // pre-zero to avoid flash
      io.observe(t.el);
    });

    /* ── V36.6 — TWO SAFETY NETS, BECAUSE PRE-ZEROING WITHOUT ONE PUBLISHES A
       WRONG NUMBER ─────────────────────────────────────────────────────────
       Until now this module zeroed every hero stat tile on smallmicro.html,
       largemidcap.html and multiasset.html and handed restoration entirely to
       the observer above — no timeout, no fallback, no second chance. Where the
       observer does not fire (a hidden or zero-size viewport, a browser that
       throttles it, an offscreen render), the tiles stay at "0.0%" for as long
       as the page is open. These are CAGR and alpha figures. A zero there is
       not a missing value, it is a claim of no return.

       Net 1 fires only if the observer has never reported an intersection —
       one real callback proves it is alive, so a working observer is never
       preempted. Net 2 is the hard release copied from mfc-reveal.js: restore
       the ORIGINAL text verbatim rather than animating, because if the observer
       is not working then neither is the animation, and the MFSTAT-injected
       string must come back exactly as the publish pipeline wrote it.

       Net 2's condition holds the invariant "nothing the reader can see may be
       showing zero", NOT "everything must resolve by 7s". A dead observer means
       restore all of them; a live one means restore only what is on screen and
       still zero, so a tile the reader has not scrolled to keeps its roll-up. */
    function inView(el) {
      var r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < (window.innerHeight || 0);
    }
    setTimeout(function () {
      if (fired) return;
      targets.forEach(function (t) {
        if (t.el.dataset.mfcCounted || !inView(t.el)) return;
        t.el.dataset.mfcCounted = "1";
        io.unobserve(t.el);
        animate(t.node, t.sign, t.val, t.suffix, t.dec);
      });
    }, 2500);
    setTimeout(function () {
      targets.forEach(function (t) {
        if (t.el.dataset.mfcCounted) return;
        if (fired && !inView(t.el)) return;
        t.el.dataset.mfcCounted = "1";
        io.unobserve(t.el);
        t.node.nodeValue = t.orig;
      });
    }, 7000);
  });
})();

/* ============================================================================
   MFC count-up — hero stat tiles roll from 0 to their value on first view.
   ----------------------------------------------------------------------------
   V9.6, shared + additive. Used by the five strategy pages, whose hero
   .stat-card .sv values are static text (the homepage proof strip and the
   dashboard already animate their own numbers — this fills the gap with the
   same easing/duration so the whole site feels uniform).

   Safety rules:
     • Only animates a value whose text is a bare number like "37.0%",
       "+21.68%", "-25.4%", "1.55" or "25" — anything else ("Medium",
       "₹3,499", "17,47,042") is left untouched.
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

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var t = byEl.get(entry.target);
        if (!t || entry.target.dataset.mfcCounted) return;
        entry.target.dataset.mfcCounted = "1";
        io.unobserve(entry.target);
        animate(t.node, t.sign, t.val, t.suffix, t.dec);
      });
    }, { threshold: 0.4 });

    targets.forEach(function (t) {
      t.node.nodeValue = t.sign + (0).toFixed(t.dec) + t.suffix; // pre-zero to avoid flash
      io.observe(t.el);
    });
  });
})();

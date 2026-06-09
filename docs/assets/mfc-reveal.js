/* ============================================================================
   MindForge Capital — gentle on-scroll reveal (V9.2)
   ----------------------------------------------------------------------------
   Brings the homepage's premium fade-up motion to the strategy pages, which were
   static. Self-contained (injects its own CSS) and BULLETPROOF: the hidden state
   is gated behind html.mfrv, which is only added once JS has run *and* motion is
   allowed — so if JS fails or the user prefers reduced motion, every element stays
   fully visible. Reveal fires as each section enters the viewport.
   ========================================================================== */
(function () {
  "use strict";
  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }
  ready(function () {
    try {
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      if (!("IntersectionObserver" in window)) return;

      var SEL = ".stats-bar, .highlight-box, .pillar, .bt-chart-full, .bt-chart-wrap, .context-comparison";
      var els = document.querySelectorAll(SEL);
      if (!els.length) return;

      var st = document.createElement("style");
      st.id = "mfc-reveal-css";
      st.textContent =
        "html.mfrv [data-mfrv]{opacity:0;transform:translateY(22px);" +
        "transition:opacity .6s cubic-bezier(.22,.8,.2,1),transform .6s cubic-bezier(.22,.8,.2,1);}" +
        "html.mfrv [data-mfrv].mfrv-in{opacity:1;transform:none;}";
      (document.head || document.documentElement).appendChild(st);
      document.documentElement.classList.add("mfrv");

      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add("mfrv-in"); io.unobserve(e.target); }
        });
      }, { rootMargin: "0px 0px -6% 0px", threshold: 0.04 });

      Array.prototype.forEach.call(els, function (el, i) {
        el.setAttribute("data-mfrv", "");
        // light stagger for grouped items (chart grid, pillars)
        var prev = el.previousElementSibling;
        if (prev && prev.hasAttribute && prev.hasAttribute("data-mfrv")) {
          el.style.transitionDelay = Math.min(i % 4, 3) * 60 + "ms";
        }
        io.observe(el);
      });

      // Safety net 1: reveal anything in-view but not yet revealed after 2.5s
      // (e.g. the observer was slow to fire for an above-the-fold element).
      setTimeout(function () {
        Array.prototype.forEach.call(document.querySelectorAll("[data-mfrv]:not(.mfrv-in)"), function (el) {
          var r = el.getBoundingClientRect();
          if (r.top < window.innerHeight && r.bottom > 0) el.classList.add("mfrv-in");
        });
      }, 2500);

      // Safety net 2 (belt-and-suspenders): after 7s, reveal EVERYTHING still
      // hidden regardless of position. By then a scrolling reader has triggered
      // the normal on-scroll reveals; this guarantees content can never be left
      // permanently invisible even if IntersectionObserver fails outright.
      setTimeout(function () {
        document.documentElement.classList.remove("mfrv");
      }, 7000);
    } catch (e) {}
  });
})();

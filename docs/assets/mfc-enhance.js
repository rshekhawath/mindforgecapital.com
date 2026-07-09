/* ============================================================================
   MFC site polish — shared, additive, low-risk visual enhancements.
   ----------------------------------------------------------------------------
   Brings the homepage's premium touches to the rest of the site for visual
   consistency. Purely additive: injects its own elements and only adjusts
   decorative styles — it never hides or restructures page content.
     1) Top scroll-progress bar (brand gradient)
     2) Subtle nav elevation that deepens as you scroll
   ========================================================================== */
(function () {
  "use strict";
  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    // ---- 1) scroll progress bar -------------------------------------------
    var bar = null;
    try {
      if (!document.getElementById("mfcScrollProg") &&
          !document.getElementById("scrollProg") &&
          !document.querySelector(".mf-scroll-prog")) {
        bar = document.createElement("div");
        bar.id = "mfcScrollProg";
        bar.setAttribute("aria-hidden", "true");
        bar.style.cssText =
          "position:fixed;top:0;left:0;height:3px;width:0;z-index:9999;" +
          "pointer-events:none;border-radius:0 2px 2px 0;" +
          "background:linear-gradient(90deg,#1a50d8,#2563eb,#0891b2,#2dd4bf)";
        document.body.appendChild(bar);
      }
    } catch (e) {}

    // ---- 2) nav elevation on scroll ---------------------------------------
    var nav = document.querySelector("nav");

    function onScroll() {
      try {
        var de = document.documentElement;
        var st = de.scrollTop || document.body.scrollTop || 0;
        if (bar) {
          var h = de.scrollHeight - de.clientHeight;
          bar.style.width = (h > 0 ? (st / h * 100) : 0) + "%";
        }
        if (nav) {
          nav.style.transition = "box-shadow .25s ease";
          nav.style.boxShadow = st > 6
            ? "0 8px 28px -12px rgba(26,80,216,.30)"
            : "";
        }
      } catch (e) {}
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    onScroll();
  });
})();

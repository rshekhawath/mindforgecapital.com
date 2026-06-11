/* ============================================================================
   MindForge Capital — site-wide "1st month FREE" launch offer (V9.0, upd V10.0)
   ----------------------------------------------------------------------------
   Injects a slim, branded, dismissible announcement strip at the very top of the
   page (above the sticky nav, so it scrolls away while the nav stays pinned).
   Purely additive; reduced-motion safe; remembers dismissal for the session.
   New members get their first month free — communicated here + on the signup flow.
   V10.0: the offer does NOT apply to the All-Access bundle. The strip's
   sub-copy says so, and the strip is suppressed entirely on
   signup.html?strategy=allaccess (where the headline would directly
   contradict the bundle the visitor came to buy).
   ========================================================================== */
(function () {
  "use strict";
  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }
  ready(function () {
    try {
      if (document.getElementById("mfc-offer-bar")) return;
      if (sessionStorage.getItem("mfc-offer-dismissed") === "1") return;
    } catch (e) {}

    var onSignup = /signup\.html$/i.test(location.pathname);

    // V10.0: All-Access is excluded from the offer — never show the strip to
    // a visitor deep-linked into the bundle signup.
    try {
      if (onSignup && /(^|[?&])strategy=allaccess(&|$)/i.test(location.search)) return;
    } catch (e) {}

    var bar = document.createElement("div");
    bar.id = "mfc-offer-bar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Launch offer");
    bar.innerHTML =
      '<div class="mfc-offer-inner">' +
        '<span class="mfc-offer-gift" aria-hidden="true">🎁</span>' +
        '<span class="mfc-offer-text"><strong>1st month FREE</strong> for all new members' +
          '<span class="mfc-offer-sub"> · only pay from month two · not applicable on All-Access</span></span>' +
        (onSignup ? "" : '<a class="mfc-offer-cta" href="signup.html">Get started →</a>') +
        '<button class="mfc-offer-x" type="button" aria-label="Dismiss offer">×</button>' +
      "</div>";

    var css = document.createElement("style");
    css.id = "mfc-offer-css";
    css.textContent =
      "#mfc-offer-bar{position:relative;z-index:120;background:linear-gradient(90deg,#1a50d8 0%,#2563eb 48%,#0891b2 100%);color:#fff;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;box-shadow:0 1px 0 rgba(255,255,255,.12) inset,0 6px 18px -10px rgba(26,80,216,.5);}" +
      "#mfc-offer-bar .mfc-offer-inner{max-width:1200px;margin:0 auto;display:flex;align-items:center;gap:10px;padding:8px 44px 8px 16px;position:relative;font-size:13.5px;line-height:1.3;}" +
      "#mfc-offer-bar .mfc-offer-gift{font-size:15px;flex-shrink:0;}" +
      "#mfc-offer-bar .mfc-offer-text{font-weight:500;color:rgba(255,255,255,.96);}" +
      "#mfc-offer-bar .mfc-offer-text strong{font-weight:800;letter-spacing:.01em;}" +
      "#mfc-offer-bar .mfc-offer-sub{opacity:.85;font-weight:500;}" +
      "#mfc-offer-bar .mfc-offer-cta{margin-left:auto;flex-shrink:0;background:#fff;color:#1a50d8;font-weight:700;font-size:12.5px;text-decoration:none;padding:6px 14px;border-radius:8px;white-space:nowrap;transition:transform .2s ease,box-shadow .2s ease;box-shadow:0 4px 12px -6px rgba(0,0,0,.4);}" +
      "#mfc-offer-bar .mfc-offer-cta:hover{transform:translateY(-1px);box-shadow:0 8px 18px -6px rgba(0,0,0,.5);}" +
      "#mfc-offer-bar .mfc-offer-x{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:rgba(255,255,255,.85);font-size:20px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:6px;transition:background .2s,color .2s;}" +
      "#mfc-offer-bar .mfc-offer-x:hover{background:rgba(255,255,255,.18);color:#fff;}" +
      "#mfc-offer-bar .mfc-offer-x:focus-visible{outline:2px solid #fff;outline-offset:1px;}" +
      "@media(max-width:560px){#mfc-offer-bar .mfc-offer-sub{display:none;}#mfc-offer-bar .mfc-offer-inner{font-size:12.5px;gap:8px;padding-left:12px;}#mfc-offer-bar .mfc-offer-cta{padding:5px 11px;font-size:12px;}}" +
      "@media(prefers-reduced-motion:reduce){#mfc-offer-bar .mfc-offer-cta{transition:none;}}";

    (document.head || document.documentElement).appendChild(css);
    document.body.insertBefore(bar, document.body.firstChild);

    var x = bar.querySelector(".mfc-offer-x");
    if (x) x.addEventListener("click", function () {
      bar.parentNode && bar.parentNode.removeChild(bar);
      try { sessionStorage.setItem("mfc-offer-dismissed", "1"); } catch (e) {}
    });
  });
})();

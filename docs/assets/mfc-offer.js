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
   V22.5: the strip gained a slow, infrequent "living glint" (a soft light band
   drifts across once every ~9s, then rests) — behind the copy, reduced-motion
   safe. Tasteful life on the site's topmost chrome without touching the copy.
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
        '<span class="mfc-offer-text"><strong>1st month FREE</strong><span class="mfc-offer-tail"> for all new members</span>' +
          '<span class="mfc-offer-sub"> · only pay from month two · not applicable on All-Access</span></span>' +
        (onSignup ? "" : '<a class="mfc-offer-cta" href="signup.html">Get started →</a>') +
        '<button class="mfc-offer-x" type="button" aria-label="Dismiss offer">×</button>' +
      "</div>";

    var css = document.createElement("style");
    css.id = "mfc-offer-css";
    css.textContent =
      "#mfc-offer-bar{position:relative;z-index:120;background:linear-gradient(90deg,#1a50d8 0%,#2563eb 48%,#0891b2 100%);color:#fff;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;box-shadow:0 1px 0 rgba(255,255,255,.12) inset,0 6px 18px -10px rgba(26,80,216,.5);}" +
      /* V22.5: a slow, infrequent "living glint" — a soft light band drifts across
         the strip once every ~9s, then rests. Sits BEHIND the copy (inner is z:1)
         so text/CTA stay crisp and the CTA's drop-shadow is never clipped (no
         overflow:hidden on the bar). Purely decorative; paused for reduced-motion. */
      "#mfc-offer-bar::after{content:'';position:absolute;inset:0;z-index:0;pointer-events:none;background:linear-gradient(100deg,transparent 42%,rgba(255,255,255,.14) 50%,transparent 58%);background-size:220% 100%;background-position:135% 0;animation:mfc-offer-glint 9s ease-in-out infinite;}" +
      "@keyframes mfc-offer-glint{0%{background-position:135% 0;}34%{background-position:-35% 0;}100%{background-position:-35% 0;}}" +
      "#mfc-offer-bar .mfc-offer-inner{max-width:1200px;margin:0 auto;display:flex;align-items:center;gap:10px;padding:8px 44px 8px 16px;position:relative;z-index:1;font-size:13.5px;line-height:1.3;}" +
      "#mfc-offer-bar .mfc-offer-gift{font-size:15px;flex-shrink:0;}" +
      "#mfc-offer-bar .mfc-offer-text{font-weight:500;color:rgba(255,255,255,.96);}" +
      "#mfc-offer-bar .mfc-offer-text strong{font-weight:800;letter-spacing:.01em;}" +
      "#mfc-offer-bar .mfc-offer-sub{opacity:.85;font-weight:500;}" +
      "#mfc-offer-bar .mfc-offer-cta{margin-left:auto;flex-shrink:0;background:#fff;color:#1a50d8;font-weight:700;font-size:12.5px;text-decoration:none;padding:6px 14px;border-radius:8px;white-space:nowrap;transition:transform .2s ease,box-shadow .2s ease;box-shadow:0 4px 12px -6px rgba(0,0,0,.4);}" +
      "#mfc-offer-bar .mfc-offer-cta:hover{transform:translateY(-1px);box-shadow:0 8px 18px -6px rgba(0,0,0,.5);}" +
      // V23.7: padding:2px 6px left the dismiss button 23.7px wide — a hair under
      // the 24×24 WCAG 2.2 SC 2.5.8 floor, on every page of the site. Centring on
      // a 26px min box clears it and squares up the previously 23.7×24 hit area.
      "#mfc-offer-bar .mfc-offer-x{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:rgba(255,255,255,.85);font-size:20px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:6px;transition:background .2s,color .2s;display:inline-flex;align-items:center;justify-content:center;min-width:26px;min-height:26px;}" +
      "#mfc-offer-bar .mfc-offer-x:hover{background:rgba(255,255,255,.18);color:#fff;}" +
      "#mfc-offer-bar .mfc-offer-x:focus-visible{outline:2px solid #fff;outline-offset:1px;}" +
      "@media(max-width:560px){#mfc-offer-bar .mfc-offer-sub,#mfc-offer-bar .mfc-offer-tail{display:none;}#mfc-offer-bar .mfc-offer-text{white-space:nowrap;}#mfc-offer-bar .mfc-offer-inner{font-size:12.5px;gap:8px;padding-left:12px;}#mfc-offer-bar .mfc-offer-cta{padding:5px 11px;font-size:12px;}}" +
      "@media(prefers-reduced-motion:reduce){#mfc-offer-bar .mfc-offer-cta{transition:none;}#mfc-offer-bar::after{animation:none;}}";

    (document.head || document.documentElement).appendChild(css);
    document.body.insertBefore(bar, document.body.firstChild);

    var x = bar.querySelector(".mfc-offer-x");
    if (x) x.addEventListener("click", function () {
      bar.parentNode && bar.parentNode.removeChild(bar);
      try { sessionStorage.setItem("mfc-offer-dismissed", "1"); } catch (e) {}
    });
  });

  // V21.0: reflect an active member session in the nav. When a dashboard token is
  // stored on this device, the public "Sign In" link becomes a direct "Portfolio"
  // link (→ dashboard.html) so a signed-in member is never bounced back through the
  // login page while browsing the marketing / tool pages. Runs independently of the
  // offer strip above. Text-scoped to the "Sign In" link only (the dashboard's own
  // nav has "My Account"/"Sign out" and never loads this script). Path-safe: it
  // rewrites only the "login.html" segment, preserving the href's prefix/domain, so
  // it works from both root pages (login.html) and the absolute-URL subdir tool
  // pages. Self-healing: a stale token is cleared by the dashboard on Access Denied,
  // so the label reverts to "Sign In" on the next load. Label is "Portfolio" (not
  // "Dashboard") — measured to render at the SAME width as "Sign In", so the tuned
  // one-line nav (V19.6) never overflows at its tightest desktop width (~1025px);
  // it also ties to the hero's "engineers your portfolio".
  ready(function () {
    // V21.2: check the cookie (the dashboard's primary session store) first, then
    // localStorage — so the nav reflects the session even when localStorage is blocked.
    var signedIn = false;
    try { signedIn = /(?:^|;\s*)mfc_dash_token=[^;]/.test(document.cookie); } catch (e) {}
    if (!signedIn) { try { signedIn = !!localStorage.getItem("mfc_dash_token"); } catch (e) {} }
    if (!signedIn) return;
    var links = document.querySelectorAll('nav a[href*="login.html"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if ((a.textContent || "").trim() === "Sign In") {
        a.setAttribute("href", (a.getAttribute("href") || "login.html").replace(/login\.html/, "dashboard.html"));
        a.textContent = "Portfolio";
      }
    }
  });
})();

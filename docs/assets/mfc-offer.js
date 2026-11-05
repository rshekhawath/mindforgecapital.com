/* ============================================================================
   MindForge Capital — site-wide "1st month FREE" launch offer (V9.0, upd V10.0)
   ----------------------------------------------------------------------------
   Injects a slim, branded, dismissible announcement strip at the very top of the
   page (above the sticky nav, so it scrolls away while the nav stays pinned).
   Purely additive; reduced-motion safe; remembers dismissal for the session.
   New members get their first month free — communicated here + on the signup flow.
   V24.4: the All-Access bundle is retired, so the exclusion it required is
   gone from the sub-copy and the strip no longer suppresses itself for it.
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
    /* V44.3 — the bar is now in the page's own markup, styled by mfc-finish.css, and its ×
       carries its own onclick, so it works before this deferred file has arrived. A small
       inline script ahead of it hides it for a session that has dismissed it. All that is
       left to do here is remove it for good in that case, and build it on a page that has
       not been given the markup. */
    var existing = document.getElementById("mfc-offer-bar"), dismissed = false;
    try { dismissed = sessionStorage.getItem("mfc-offer-dismissed") === "1"; } catch (e) {}
    if (dismissed) { if (existing && existing.parentNode) existing.parentNode.removeChild(existing); return; }
    if (existing) return;

    var onSignup = /signup\.html$/i.test(location.pathname);
    /* V37.7 — THE CTA WAS RELATIVE, AND FIVE SURFACES ARE NOT AT THE ROOT.
       `href="signup.html"` resolves against the CURRENT directory, so on every
       subdirectory page that carries this strip — /scores/, /screener/,
       /fii-dii/, /factor-report/ and the 28 stock-directory pages — the site's
       primary conversion CTA pointed at /<dir>/signup.html and returned 404.
       Verified against production before the change: /scores/signup.html and
       /screener/signup.html both 404. Root-absolute is the only form that is
       correct from every depth, and it is what the shared code already uses for
       /disclosures.html. */

    var bar = document.createElement("div");
    bar.id = "mfc-offer-bar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Launch offer");
    bar.innerHTML =
      '<div class="mfc-offer-inner">' +
        '<span class="mfc-offer-gift" aria-hidden="true">🎁</span>' +
        '<span class="mfc-offer-text"><strong>1st month FREE</strong><span class="mfc-offer-tail"> for all new members</span>' +
          '<span class="mfc-offer-sub"> · only pay from month two</span></span>' +
        (onSignup ? "" : '<a class="mfc-offer-cta" href="/signup.html">Get started →</a>') +
        '<button class="mfc-offer-x" type="button" aria-label="Dismiss offer">×</button>' +
      "</div>";

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

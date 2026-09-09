/*! ============================================================================
    mfc-track.js — MindForge Capital first-party analytics. V36.6.
    ----------------------------------------------------------------------------
    WHY THIS FILE EXISTS
    Sixty-two releases of UX work had shipped with no measurement of any kind:
    no GA, no Plausible, no Umami, no sendBeacon, no dataLayer, nothing. The
    homepage is 12,753px tall — around 14 desktop screens, 30 phone screens,
    2,988 words, with pricing 43% of the way down — and there was no way to know
    how far anyone got, or which of the three strategies people actually chose.

    WHY IT IS FIRST-PARTY
    Every event goes to the Apps Script backend this site already talks to. The
    Content-Security-Policy on all 25 pages already reads
      connect-src 'self' https://script.google.com https://*.googleusercontent.com
    so nothing had to be loosened, and no third party ever sees a visitor. That
    matches what the privacy page already claims rather than contradicting it.

    WHAT IT DELIBERATELY DOES NOT COLLECT
    * NO QUERY STRING, EVER. `page` is location.pathname only. The member
      dashboard is reached as dashboard.html?token=<the member's secret>, and
      V29.8 already had to purge tokens out of the service-worker cache for
      exactly this reason. A tracker that logged location.href would write every
      member's token into a spreadsheet, so this one cannot see it: the query
      and the hash are dropped at the single point where `page` is computed.
    * No IP, no user-agent string, no cookies, no localStorage.
    * The session id is random, lives in sessionStorage, and dies with the tab,
      so it cannot join one visit to another.
    * Viewport width is bucketed, not exact — an exact width is a fingerprint.
    * Referrer is reduced to its HOST and only when it is off-site.

    OPT-OUTS ARE HONOURED BEFORE ANYTHING ELSE RUNS
    Do Not Track and Global Privacy Control both disable the module completely.

    HOW IT IS SAFE FOR THE MEMBER-CRITICAL BACKEND
    The Apps Script deployment that serves this also serves `stocks`, `prices`
    and `activate`, and shares one execution quota with them. So events are
    QUEUED and sent in batches — on pagehide, on a 12s timer, or when ten pile
    up — which turns a browsing session into one or two requests rather than
    dozens. Payloads are capped at 25 events. Everything is fire-and-forget and
    every failure is swallowed: analytics must never be able to affect a page.

    The backend also honours a Script Property kill switch (ANALYTICS_OFF=1),
    so tracking can be turned off without redeploying anything to the site.
    ========================================================================== */
(function () {
  "use strict";

  /* ── Opt-outs first, before any state is created ───────────────────────── */
  try {
    var nav = navigator || {};
    if (nav.globalPrivacyControl === true) return;
    var dnt = nav.doNotTrack || window.doNotTrack || nav.msDoNotTrack;
    if (dnt === "1" || dnt === "yes") return;
  } catch (e) { return; }

  /* The Apps Script deployment. Same URL as signup/login/dashboard/recover/
     admin/scores-company — a redeploy that changes the /macros/s/<id>/ segment
     has to update all seven. */
  var ENDPOINT = window.APPS_SCRIPT_URL ||
    "https://script.google.com/macros/s/AKfycbxOAkgF6naSDlx8q4mt1n3vJvd1gywpYT_iiYvt94ddYeqaniNI4ggM7idJTJHhA6RH8w/exec";

  var MAX_BATCH = 25, FLUSH_AT = 10, FLUSH_MS = 12000;
  var queue = [], timer = null, sent = 0;

  function sid() {
    try {
      var k = "mfc_sid", v = sessionStorage.getItem(k);
      if (!v) {
        v = (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
        sessionStorage.setItem(k, v);
      }
      return v;
    } catch (e) { return "nostore"; }
  }

  /* THE ONE PLACE `page` IS COMPUTED. pathname only — see the header. */
  function page() {
    try { return String(location.pathname || "/").slice(0, 120); }
    catch (e) { return "/"; }
  }

  function vwBucket() {
    var w = window.innerWidth || 0;
    if (w < 380) return "xs";
    if (w < 600) return "sm";
    if (w < 900) return "md";
    if (w < 1280) return "lg";
    return "xl";
  }

  function refHost() {
    try {
      if (!document.referrer) return "";
      var u = new URL(document.referrer);
      return u.host === location.host ? "" : u.host.slice(0, 80);
    } catch (e) { return ""; }
  }

  function flush(sync) {
    if (!queue.length) return;
    var batch = queue.splice(0, MAX_BATCH);
    if (timer) { clearTimeout(timer); timer = null; }
    var body = JSON.stringify({ action: "track", events: batch });
    try {
      // text/plain keeps this a CORS "simple request" — no preflight, which is
      // the same reason every other POST on this site uses it. Apps Script
      // ignores the declared type and reads e.postData.contents regardless.
      if (sync && navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" }));
      } else {
        fetch(ENDPOINT, {
          method: "POST", headers: { "Content-Type": "text/plain" },
          body: body, keepalive: true, mode: "cors"
        })["catch"](function () {});
      }
    } catch (e) { /* analytics never surfaces an error to the page */ }
  }

  function track(event, label, value) {
    try {
      if (!event || sent > 60) return;          // a hard per-page ceiling
      sent++;
      queue.push({
        t: new Date().toISOString(),
        e: String(event).slice(0, 40),
        p: page(),
        l: label == null ? "" : String(label).slice(0, 80),
        v: (typeof value === "number" && isFinite(value)) ? value : "",
        s: sid(), r: refHost(), w: vwBucket()
      });
      if (queue.length >= FLUSH_AT) flush(false);
      else if (!timer) timer = setTimeout(function () { flush(false); }, FLUSH_MS);
    } catch (e) {}
  }

  // Public, so an inline handler on any page can record its own event without
  // this file needing to know that page's markup.
  window.mfcTrack = track;

  /* ── 1 · page view ──────────────────────────────────────────────────────── */
  track("page_view");

  /* ── 2 · scroll depth ───────────────────────────────────────────────────── */
  /* Milestones, not a continuous stream: four events per visit answers "how far
     down does anyone get" and nothing beyond that is worth a request. Measured
     against scrollable height, so a short page reports 100 immediately and does
     not pretend to be unread. */
  (function () {
    var marks = [25, 50, 75, 100], hit = {}, raf = 0;
    function check() {
      raf = 0;
      var doc = document.documentElement;
      var scrollable = (doc.scrollHeight - window.innerHeight);
      var pct = scrollable > 40
        ? Math.min(100, Math.round((window.scrollY || doc.scrollTop || 0) / scrollable * 100))
        : 100;
      for (var i = 0; i < marks.length; i++) {
        if (pct >= marks[i] && !hit[marks[i]]) {
          hit[marks[i]] = 1;
          track("scroll_depth", String(marks[i]), marks[i]);
        }
      }
    }
    window.addEventListener("scroll", function () {
      if (!raf) raf = requestAnimationFrame(check);
    }, { passive: true });
    // Fire once at rest so a page that fits the viewport is not reported as 0%.
    setTimeout(check, 1200);
  })();

  /* ── 3 · plan choice, signup, free-tool use ─────────────────────────────── */
  /* One delegated listener on the document rather than per-element binding, so
     it works for controls that render after load (the Scanner's result rows,
     the dashboard's switcher) and cannot go stale when markup moves. */
  document.addEventListener("click", function (ev) {
    try {
      var t = ev.target;
      var a = t && t.closest ? t.closest("a,button") : null;
      if (!a) return;

      // "Choose this plan →" on index.html / strategies.html. The strategy is
      // read from the href the link already carries, never from the label.
      if (a.matches && a.matches("a.strat-pick, a[href*='signup.html?strategy=']")) {
        var m = /strategy=([a-z0-9_-]+)/i.exec(a.getAttribute("href") || "");
        track("plan_click", m ? m[1] : "unknown");
        flush(true);                       // this click navigates away
        return;
      }
      // Free-tool actions, identified by the ids the tools already use.
      var id = a.id || "";
      if (id === "runBtn" || id === "applyBtn" || id === "searchBtn" ||
          id === "calcBtn" || id === "scoreBtn") {
        track("tool_use", (page() + "#" + id).slice(0, 80));
      }
    } catch (e) {}
  }, true);

  /* signup_start — the first real interaction with the signup form, once. */
  (function () {
    if (page().indexOf("signup") === -1) return;
    var armed = true;
    document.addEventListener("input", function (ev) {
      if (!armed) return;
      var el = ev.target;
      if (!el || !el.matches || !el.matches("input,select,textarea")) return;
      armed = false;
      track("signup_start");
    }, true);
  })();

  /* ── 4 · flush on the way out ───────────────────────────────────────────── */
  /* pagehide is the reliable one on iOS Safari, where unload never fires;
     visibilitychange covers a tab switch that never comes back. */
  window.addEventListener("pagehide", function () { flush(true); });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flush(true);
  });
})();

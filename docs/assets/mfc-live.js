/* ============================================================================
   MFC Live-Cycle Performance — shared loader (V24.2)
   ----------------------------------------------------------------------------
   Fetches /live-perf.json (aggregate model-portfolio movement since the last
   rebalance — % only, never holdings) and fills any element that declares a
   data-live slot. One implementation for the homepage hero, the five strategy
   pages and the strategies index.

   Slots:
     data-live="mc:live"        → the strategy's cycle % (signed, 2dp)
     data-live="mc:bench"       → its benchmark's cycle % (signed, 2dp)
     data-live="mc:benchname"   → benchmark display name
     data-live="rebal"          → rebalance date, "19 Jul 2026"
     data-live="asof"           → data-through date, "17 Jul 2026"
   Containers with data-live-wrap stay hidden (CSS) until data lands, so a
   failed fetch degrades to the page exactly as it was before the pivot.
   Value elements get an up / down / flat class for tinting.

   Fail-soft by design: any error leaves the page untouched. The JSON is tiny,
   same-origin, and outside the SW's cache-first asset list (network always).
   ========================================================================== */
(function () {
  "use strict";

  function fmtPct(v) {
    if (v == null || !isFinite(v)) return null;
    var sign = v > 0 ? "+" : v < 0 ? "−" : "+";
    return sign + Math.abs(v).toFixed(2) + "%";
  }
  function cls(v) { return v > 0.05 ? "up" : v < -0.05 ? "down" : "flat"; }
  function fmtDate(iso) {
    try {
      var d = new Date(iso + "T00:00:00");
      return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    } catch (e) { return iso; }
  }

  function fill(data) {
    var els = document.querySelectorAll("[data-live]");
    if (!els.length) return;
    var any = false;
    els.forEach(function (el) {
      var spec = (el.getAttribute("data-live") || "").split(":");
      var val = null, isPct = false, num = null;
      if (spec[0] === "rebal") val = fmtDate(data.rebalance_date);
      else if (spec[0] === "asof") val = fmtDate(data.data_through);
      else {
        var s = (data.strategies || {})[spec[0]];
        if (!s) return;
        if (spec[1] === "live")  { num = s.live_pct;  val = fmtPct(s.live_pct);  isPct = true; }
        if (spec[1] === "bench") { num = s.bench_pct; val = fmtPct(s.bench_pct); isPct = true; }
        if (spec[1] === "benchname") val = s.bench_name;
      }
      if (val == null) return;
      el.textContent = val;
      if (isPct) { el.classList.remove("up", "down", "flat"); el.classList.add(cls(num)); }
      any = true;
    });
    if (!any) return;
    document.querySelectorAll("[data-live-wrap]").forEach(function (w) {
      w.classList.add("live-ready");
    });
    try {
      document.dispatchEvent(new CustomEvent("mfc-live-ready", { detail: data }));
    } catch (e) {}
  }

  // Shared CSS for the .live-strip (strategy pages) and .live-chip
  // (strategies index cards) — injected here so seven pages share one
  // implementation, same pattern as mfc-offer.js. The homepage hero's bespoke
  // .hv-live rules stay inline in index.html.
  function injectStyle() {
    if (document.getElementById("mfc-live-css")) return;
    var st = document.createElement("style");
    st.id = "mfc-live-css";
    st.textContent =
      ".live-strip{display:none;}" +
      ".live-strip.live-ready{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin:18px 0 6px;padding:11px 15px;border:1px solid rgba(5,150,105,.28);border-radius:12px;background:linear-gradient(135deg,rgba(5,150,105,.07),rgba(45,212,191,.05));font-size:13px;color:var(--text2,#1e3a5f);}" +
      ".live-strip .ls-badge{display:inline-flex;align-items:center;gap:5px;font-size:9.5px;font-weight:800;letter-spacing:.14em;color:var(--green,#059669);border:1px solid rgba(5,150,105,.35);border-radius:999px;padding:2.5px 8px;}" +
      ".live-strip .ls-dot{width:6px;height:6px;border-radius:50%;background:var(--green,#059669);animation:mfc-live-pulse 1.8s ease-in-out infinite;}" +
      "@keyframes mfc-live-pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.45;transform:scale(.8);}}" +
      ".live-strip b{font-weight:800;font-variant-numeric:tabular-nums;}" +
      ".live-strip .up{color:var(--green,#059669);}" +
      ".live-strip .down{color:#dc2626;}" +
      ".live-strip .flat{color:var(--text2,#1e3a5f);}" +
      ".live-strip .ls-meta{font-size:11.5px;color:var(--text3,#475569);}" +
      ".live-strip .ls-cta{margin-left:auto;font-size:12px;font-weight:700;color:var(--accent,#1a50d8);text-decoration:none;white-space:nowrap;}" +
      ".live-strip .ls-cta:hover{text-decoration:underline;}" +
      "@media (max-width:640px){.live-strip .ls-cta{margin-left:0;}}" +
      ".live-chip{display:none;}" +
      ".live-chip.live-ready{display:inline-flex;align-items:center;gap:6px;margin-top:7px;font-size:11.5px;color:var(--text3,#475569);}" +
      ".live-chip .ls-dot{width:5px;height:5px;border-radius:50%;background:var(--green,#059669);animation:mfc-live-pulse 1.8s ease-in-out infinite;}" +
      ".live-chip b{font-weight:800;font-variant-numeric:tabular-nums;}" +
      ".live-chip .up{color:var(--green,#059669);}" +
      ".live-chip .down{color:#dc2626;}" +
      ".live-chip .flat{color:var(--text2,#1e3a5f);}" +
      "@media (prefers-reduced-motion:reduce){.live-strip .ls-dot,.live-chip .ls-dot{animation:none;}}";
    document.head.appendChild(st);
  }

  function boot() {
    injectStyle();
    // cache-bust hourly — fresh enough for a twice-daily data pipeline without
    // defeating the CDN entirely
    var bust = Math.floor(Date.now() / 3600000);
    fetch("/live-perf.json?t=" + bust, { credentials: "omit" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        if (!d || !d.strategies) return;
        window.MFCLive = d;
        fill(d);
      })
      .catch(function () { /* fail-soft: page stays in its pre-pivot state */ });
  }

  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();

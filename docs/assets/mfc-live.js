/* ============================================================================
   MFC Live-Cycle Performance — shared loader (V24.2)
   ----------------------------------------------------------------------------
   Fetches /live-perf.json (aggregate model-portfolio movement since the last
   rebalance — % only, never holdings) and fills any element that declares a
   data-live slot. One implementation for the homepage hero, the three strategy
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

  /* V24.8: the live figures used to HARD-SET while the backtest figures beside
     them counted up — on a strategy page's KPI row the backtest and benchmark
     cards animate (mfc-countup.js targets ".stat-card .sv") and the LIVE card,
     which the V24.2 pivot made the lead metric, snapped. This completes that
     idiom rather than adding a new one.

     Contract: the tween always LANDS on `finalText` verbatim — the caller's
     fmtPct() output, including its U+2212 minus — so no rounding path can ever
     publish a figure that differs from the JSON. Reduced-motion snaps; a frozen
     rAF clock is caught by a setTimeout backstop that also snaps. */
  var REDUCED = false;
  try { REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  function countTo(el, target, finalText) {
    if (REDUCED || typeof requestAnimationFrame !== "function" || !isFinite(target)) {
      el.textContent = finalText; return;
    }
    var DUR = 750, done = false;
    function land() { if (done) return; done = true; el.textContent = finalText; }
    // backstop: if rAF never runs (background tab / throttled harness), snap.
    setTimeout(land, DUR + 400);
    var t0 = null;
    requestAnimationFrame(function step(ts) {
      if (done) return;
      if (t0 === null) t0 = ts;
      var t = Math.min(1, (ts - t0) / DUR);
      var e = 1 - Math.pow(1 - t, 3);              // easeOutCubic, as elsewhere
      if (t < 1) {
        var v = target * e;
        var sign = v > 0 ? "+" : v < 0 ? "−" : "+";
        el.textContent = sign + Math.abs(v).toFixed(2) + "%";
        requestAnimationFrame(step);
      } else { land(); }
    });
  }
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
      if (isPct) {
        // tint first so the number counts up already wearing its final colour
        el.classList.remove("up", "down", "flat");
        el.classList.add(cls(num));
        countTo(el, num, val);
      } else {
        el.textContent = val;
      }
      any = true;
    });
    if (!any) return;
    document.querySelectorAll("[data-live-wrap]").forEach(function (w) {
      w.classList.add("live-ready");
    });
    // V24.3: hosts are containers whose layout shifts once live data is in —
    // strategy cards demote their backtest metrics, the strategy-page KPI grid
    // grows a 6th column. Like the wraps, nothing happens on a failed fetch.
    document.querySelectorAll("[data-live-host]").forEach(function (h) {
      h.classList.add("has-live");
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
      "@media (prefers-reduced-motion:reduce){.live-strip .ls-dot,.live-chip .ls-dot{animation:none;}}" +
      /* ── V24.3: deeper pivot surfaces ─────────────────────────────────────
         Homepage strategy cards: the live metric is appended LAST in the DOM
         (so the hero's DATA harvest of .strat-metric .val[0]/[1] and the
         :first-child divider rule keep working) and flex-ordered to render
         FIRST. It carries .live-val, deliberately NOT .val, so nothing that
         indexes .val ever sees it. */
      ".strat-metric-live{display:none;order:-1;}" +
      /* the live metric is a FULL-WIDTH headline row above the backtest pair —
         five cards share one desktop row, so a third side-by-side metric gets
         flex-squeezed (min-width:0) into text overlap. Wrapping instead keeps
         the original two-metric geometry intact underneath. */
      ".strat-card.has-live .strat-metrics{flex-wrap:wrap;}" +
      /* card-scoped (0,3,0): the homepage's late body <style> re-declares
         .strat-grid .strat-metric{flex:1 1 0;min-width:0} at (0,2,0), which
         TIES a bare .strat-metric-live.live-ready and wins on source order —
         the extra .strat-card class settles the cascade without !important. */
      /* column like the card's other metrics (value over label) — a row form
         overflows the ~160px five-across cards, and the page's inherited
         justify-content:flex-end packs that overflow off the LEFT edge. */
      ".strat-card .strat-metric-live.live-ready{display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start;gap:4px;flex:1 1 100%;min-width:100%;padding:0 0 10px;margin:0 0 10px;border-right:none;border-bottom:0.5px solid var(--border2,rgba(37,99,235,.2));}" +
      ".strat-metric-live .live-val{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Arial,sans-serif;font-size:26px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;}" +
      ".strat-metric-live .live-val.up{color:var(--green,#059669);}" +
      ".strat-metric-live .live-val.down{color:#dc2626;}" +
      ".strat-metric-live .live-val.flat{color:var(--text2,#1e3a5f);}" +
      ".strat-metric-live .lbl{display:flex;align-items:center;gap:5px;white-space:nowrap;}" +
      /* with live present, the card's backtest metrics step back */
      ".strat-card.has-live .strat-metric .val{font-size:19px;}" +
      ".strat-card.has-live .strat-metric:last-child .val{font-size:15px;}" +
      ".strat-card.has-live .strat-metric:first-child{padding-right:14px;margin-right:14px;}" +
      /* Strategy-page KPI row: a LIVE card leads the grid; the 5-col template
         becomes 6-col only when the card is actually shown. */
      ".stat-card.stat-live{display:none;}" +
      ".stats-bar.has-live{grid-template-columns:repeat(6,1fr);}" +
      "@media(max-width:960px){.stats-bar.has-live{grid-template-columns:1fr 1fr;}}" +
      ".stat-card.stat-live.live-ready{display:block;border:1px solid rgba(5,150,105,.35);background:linear-gradient(135deg,rgba(5,150,105,.06),rgba(45,212,191,.04));}" +
      ".stat-card.stat-live .live-val{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Arial,sans-serif;font-size:30px;font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums;}" +
      ".stat-card.stat-live .live-val.up{color:var(--green,#059669);}" +
      ".stat-card.stat-live .live-val.down{color:#dc2626;}" +
      ".stat-card.stat-live .live-val.flat{color:var(--text2,#1e3a5f);}" +
      ".stat-card.stat-live .sl .ls-dot{display:inline-block;vertical-align:middle;margin-right:4px;margin-top:-2px;}" +
      ".stats-bar.has-live .stat-card .sv{font-size:24px;}" +
      /* strategies.html cards: the live chip becomes the emphatic line and the
         backtest summary steps back (sibling/:has — no JS reflow). */
      ".live-chip.live-ready{font-size:13px;font-weight:600;color:var(--text2,#1e3a5f);}" +
      ".live-chip.live-ready b{font-size:15px;}" +
      ".ps-perf-cagr:has(+ .live-chip.live-ready){font-size:11.5px;color:var(--text3,#475569);}" +
      ".ps-perf:has(.live-chip.live-ready) .ps-perf-val{font-size:16px;}" +
      /* the pulsing dot in the two V24.3 contexts (strip/chip rules are scoped) */
      ".strat-metric-live .ls-dot,.stat-card.stat-live .ls-dot{width:6px;height:6px;border-radius:50%;background:var(--green,#059669);display:inline-block;animation:mfc-live-pulse 1.8s ease-in-out infinite;}" +
      "@media (prefers-reduced-motion:reduce){.strat-metric-live .ls-dot,.stat-card.stat-live .ls-dot{animation:none;}}" +
      /* ── V24.6: strategy-page SIDEBAR live card ───────────────────────────
         The sticky sidebar previously showed only the backtest snapshot, so a
         reader scrolling the page had the simulated figure pinned beside them
         and the live one far above. This mirrors it: same fail-soft contract
         (display:none until .live-ready), same data-live slots. */
      ".sidebar-live{display:none;}" +
      ".sidebar-live.live-ready{display:block;border:1px solid rgba(5,150,105,.35);background:linear-gradient(135deg,rgba(5,150,105,.06),rgba(45,212,191,.04));}" +
      ".sidebar-live h3{display:flex;align-items:center;gap:7px;}" +
      ".sidebar-live .ls-dot{width:6px;height:6px;border-radius:50%;background:var(--green,#059669);display:inline-block;animation:mfc-live-pulse 1.8s ease-in-out infinite;}" +
      ".sidebar-live .sl-live-val{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Arial,sans-serif;font-size:32px;font-weight:800;line-height:1.05;font-variant-numeric:tabular-nums;}" +
      ".sidebar-live .sl-live-val.up{color:var(--green,#059669);}" +
      ".sidebar-live .sl-live-val.down{color:#dc2626;}" +
      ".sidebar-live .sl-live-val.flat{color:var(--text2,#1e3a5f);}" +
      ".sidebar-live .sl-live-cyc{font-size:11px;color:var(--text3,#475569);margin:4px 0 12px;}" +
      ".sidebar-live .sl-live-note{font-size:10.5px;color:var(--text3,#475569);margin-top:12px;line-height:1.5;}" +
      "@media (prefers-reduced-motion:reduce){.sidebar-live .ls-dot{animation:none;}}" +
      /* ── V24.8: the live surfaces used to POP into existence — the wrappers go
         display:none → shown the instant the fetch lands, while every other
         reveal on the site rises in. One shared entrance for all six live
         containers; `both` so the from-state never flashes before it runs. */
      "@keyframes mfc-live-in{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}" +
      ".live-strip.live-ready,.live-chip.live-ready,.hv-live.live-ready," +
      ".stat-card.stat-live.live-ready,.strat-metric-live.live-ready," +
      /* NO fill-mode, deliberately. `both` would HOLD the from-state (opacity:0)
         whenever the animation cannot run — e.g. these chips also live inside
         strategies.html's hidden .ps-panel tabs — so a figure could render
         permanently invisible. Without a fill the worst case is simply "no
         animation, fully visible", which is the correct failure mode for a
         page whose whole point is showing a number. */
      ".sidebar-live.live-ready{animation:mfc-live-in .5s cubic-bezier(.22,1,.36,1);}" +
      "@media (prefers-reduced-motion:reduce){.live-strip.live-ready,.live-chip.live-ready," +
      ".hv-live.live-ready,.stat-card.stat-live.live-ready,.strat-metric-live.live-ready," +
      ".sidebar-live.live-ready{animation:none;}}";
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

/* ============================================================================
   MFC Company Deep-Dive — shared enrichment (V23.5)
   ----------------------------------------------------------------------------
   Both stock detail pages — /screener/company.html (Scanner) and
   /scores/company.html (Integrity Score) — are thin: an Overview / Ratios /
   Shareholding / About set of tabs where "About" was one description paragraph
   plus a 7-row fact grid. This module turns the detail page into a proper
   company profile without duplicating logic across the two big HTML files.

   It renders, purely client-side from the SAME snapshot both pages already load
   (screener/stocks.json, ~98 fields/stock, full universe in memory):

     1. an always-visible "what this company does" business strip under the KPIs
     2. a rebuilt Company tab:
          • full business description
          • V23.5 "business by the numbers" — scale & footprint tiles
          • expanded key-facts grid (incl. a market-cap category)
          • dividend + ownership + volatility snapshot
          • V23.5 "how the money flows" — a revenue→net-profit waterfall
          • V23.5 balance-sheet & solvency panel (cash vs debt, coverage)
          • V23.5 cash conversion cycle (working-capital days)
          • V23.5 "what the numbers show" — derived strengths / watch-outs
          • PEER comparison table (largest names in the same industry)
          • "how it compares within its sector" percentile context

   Design rules:
     • Reuse the pages' existing CSS variables + card/grid classes so light &
       dark themes (var-flip via mfc-finish.css) are handled automatically.
     • Everything is wrapped in try/catch and degrades gracefully — if the
       universe can't be read, the description + facts + dividend still render.
     • Page-agnostic: reads the universe from whichever global is present
       (window.MFCScores on the scores page, window.MFCScreenerData on the
       scanner page).
     • SANITY GUARDS matter (V23.5): the upstream snapshot carries genuine junk
       for a minority of names — negative revenue, gross_margin 0 on banks whose
       gross profit equals revenue, |operating_margin| of 186%, 21,250-day cash
       cycles. Every derived panel validates its inputs and hides itself rather
       than render a nonsense number. Panels are computed from the values they
       actually display, so a card never contradicts its own bars.
     • Observations are factual read-outs of the snapshot, never advice.

   Entry point: window.MFCCompany.render(D)  — call it once, after the page has
   its stock object D (i.e. right after renderAbout()).
   ========================================================================== */
(function () {
  "use strict";

  // ── tiny helpers ──────────────────────────────────────────────────────────
  function num(v) { if (v === null || v === undefined || v === "") return null; var n = Number(v); return isFinite(n) ? n : null; }
  // Treat "N/A" / blank as genuinely absent — the snapshot uses "N/A" as a
  // placeholder sector/industry (screener-data.js already filters it out).
  function clean(v) { if (v == null) return null; v = String(v).trim(); return (!v || v.toUpperCase() === "N/A" || v === "—") ? null : v; }
  function fx(v, dp) { v = num(v); return v == null ? "—" : v.toFixed(dp == null ? 2 : dp); }
  function pctS(v, dp) { v = num(v); return v == null ? "—" : v.toFixed(dp == null ? 1 : dp) + "%"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  // Negative amounts (net cash, negative working capital, a loss at some line of
  // the waterfall) carry the sign OUTSIDE the currency — "−₹96 Cr", never
  // "₹-96 Cr" — and a value that rounds to zero never prints as "−₹0 Cr".
  function crStr(cr) {
    cr = num(cr); if (cr == null) return "—";
    var sign = cr < 0 ? "−" : "", a = Math.abs(cr);
    if (a >= 100000) return sign + "₹" + (a / 100000).toFixed(2) + " L Cr";
    var r = Math.round(a);
    if (r === 0) sign = "";
    return sign + "₹" + r.toLocaleString("en-IN") + " Cr";
  }
  function el(id) { return document.getElementById(id); }

  // ── V23.7: grow-on-reveal ──────────────────────────────────────────────────
  //    The V23.5 panels declared `transition:width .8s` on their bars but painted
  //    each bar at its FINAL width in the same frame it was inserted — a CSS
  //    transition only fires on a *change*, so nothing ever animated and the
  //    newest surfaces were the only bars on the site that snapped into place
  //    (the dashboard's .alloc-bar and the factor-report's .fr-bar both grow).
  //    Panels render their bars at the zero state carrying a data-grow-* target;
  //    this wires them to animate to it as each card scrolls into view — which
  //    also covers the Company tab being hidden at load, since an element inside
  //    display:none never intersects and so grows the moment the tab is opened.
  var REDUCED = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  function applyGrow(node) {
    var w = node.getAttribute("data-grow-w"), l = node.getAttribute("data-grow-left");
    if (w != null) node.style.width = w;
    if (l != null) node.style.left = l;
    node.removeAttribute("data-grow-w");
    node.removeAttribute("data-grow-left");
  }
  function growOnReveal(root) {
    if (!root) return;
    var nodes = root.querySelectorAll("[data-grow-w],[data-grow-left]");
    if (!nodes.length) return;
    // No IO (or motion is unwelcome) → land on the final value immediately, so
    // a panel is never left stuck at its zero state.
    if (REDUCED || !("IntersectionObserver" in window)) {
      Array.prototype.forEach.call(nodes, applyGrow);
      return;
    }
    // Observe each bar's CARD, never the bar: at the zero state a bar is 0px
    // wide, and a zero-area target is exactly the case where intersection
    // ratios are least dependable. The card always has real area, and watching
    // it lets one card's bars cascade together in document order.
    var groups = [], byCard = [];
    Array.prototype.forEach.call(nodes, function (n) {
      var card = (n.closest && n.closest(".card")) || root;
      var i = byCard.indexOf(card);
      if (i < 0) { byCard.push(card); groups.push([n]); } else { groups[i].push(n); }
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        var members = groups[byCard.indexOf(en.target)] || [];
        // Next frame: the zero state has to be painted once before the change,
        // or the browser coalesces both values and skips the transition.
        requestAnimationFrame(function () {
          members.forEach(function (n, i) {
            if (i === 0) return applyGrow(n);
            setTimeout(function () { applyGrow(n); }, i * 70); // cascade in order
          });
        });
      });
    // threshold 0 + a negative bottom margin, deliberately: a ratio-based
    // threshold is unreachable for any card taller than ~5x the viewport, and
    // these cards grow with the data. This fires once the card's top edge
    // crosses ~88% of the viewport, whatever its height.
    }, { threshold: 0, rootMargin: "0px 0px -12% 0px" });
    byCard.forEach(function (c) { io.observe(c); });
  }

  function quantile(sorted, q) {
    if (!sorted.length) return null;
    var pos = (sorted.length - 1) * q, base = Math.floor(pos), rest = pos - base;
    return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
  }

  // ── read the full universe from whichever data layer the page loaded ──────
  function universe() {
    // Never rejects: a failed universe fetch must still leave the universe-
    // independent panels (scale tiles, facts) rendering off the stock itself.
    try {
      if (window.MFCScores && typeof window.MFCScores.all === "function") {
        var a = window.MFCScores.all();
        if (a && a.length) return Promise.resolve(a);
        if (typeof window.MFCScores.load === "function")
          return Promise.resolve(window.MFCScores.load())
            .then(function () { return window.MFCScores.all() || []; })
            .catch(function () { return []; });
      }
      if (window.MFCScreenerData && typeof window.MFCScreenerData.load === "function")
        return window.MFCScreenerData.load()
          .then(function (b) { return (b && b.stocks) || []; })
          .catch(function () { return []; });
    } catch (e) {}
    return Promise.resolve([]);
  }

  // ── one-time scoped stylesheet (all colours via the page's theme vars) ────
  function injectStyle() {
    if (el("mfx-style")) return;
    var css = `
    .mfx-strip{margin-bottom:16px}
    .mfx-strip .card-body{padding:16px 20px 18px}
    .mfx-eyebrow{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent2);display:flex;align-items:center;gap:7px;margin-bottom:9px}
    .mfx-eyebrow::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--accent2)}
    .mfx-desc{font-size:14px;line-height:1.75;color:var(--text2);margin:0}
    .mfx-clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .mfx-more{appearance:none;-webkit-appearance:none;border:none;background:none;cursor:pointer;font:inherit;font-size:12.5px;font-weight:700;color:var(--accent2);padding:6px 0 0;display:inline-block}
    .mfx-more:hover{color:var(--accent3);text-decoration:underline}
    .mfx-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:13px}
    .mfx-chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--text2);background:var(--ink);border:0.5px solid var(--border2);border-radius:999px;padding:5px 12px;line-height:1.3}
    .mfx-chip b{color:var(--white);font-weight:700}
    .mfx-chip.accent{color:var(--accent2);background:rgba(37,99,235,.07);border-color:var(--border2)}
    .mfx-chip a{color:inherit;text-decoration:none}
    .mfx-chip a:hover{text-decoration:underline}
    .mfx-src{font-size:11px;color:var(--text3);font-weight:500}
    .mfx-facts .ii-value a{color:var(--accent2);text-decoration:none;word-break:break-word}
    .mfx-facts .ii-value a:hover{text-decoration:underline}
    /* dividend / ownership snapshot */
    .mfx-snap{display:flex;flex-direction:column;gap:14px}
    .mfx-line{font-size:12.5px;color:var(--text2);line-height:1.6}
    .mfx-line b{color:var(--white)}
    .mfx-own-bar{display:flex;height:12px;border-radius:6px;overflow:hidden;border:0.5px solid var(--border);margin:4px 0 6px}
    .mfx-own-seg{height:100%;transition:width .8s cubic-bezier(.22,1,.36,1)}
    .mfx-own-key{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:var(--text3)}
    .mfx-own-key span{display:inline-flex;align-items:center;gap:5px}
    .mfx-sw{width:10px;height:10px;border-radius:2px;display:inline-block}
    .mfx-tag{display:inline-block;font-size:11px;font-weight:700;padding:2px 9px;border-radius:6px}
    .mfx-tag.good{color:var(--green);background:rgba(5,150,105,.12)}
    .mfx-tag.warn{color:var(--gold);background:rgba(217,119,6,.12)}
    .mfx-tag.mut{color:var(--text3);background:var(--ink)}
    /* peer table */
    .mfx-note{font-size:12px;color:var(--text3);margin:0 0 12px;line-height:1.6}
    .mfx-tablewrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -4px}
    .mfx-table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:540px}
    .mfx-table th{text-align:right;font-size:10.5px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;padding:0 12px 9px;border-bottom:0.5px solid var(--border2);white-space:nowrap}
    .mfx-table th:first-child,.mfx-table td:first-child{text-align:left}
    .mfx-table td{padding:10px 12px;border-bottom:0.5px solid var(--border);white-space:nowrap;color:var(--text2);font-variant-numeric:tabular-nums}
    .mfx-table tbody tr:last-child td{border-bottom:none}
    .mfx-table tbody tr{transition:background .15s}
    .mfx-table tbody tr:hover{background:rgba(37,99,235,.05)}
    .mfx-table a{color:var(--accent2);text-decoration:none;font-weight:600}
    .mfx-table a:hover{text-decoration:underline}
    .mfx-pname{color:var(--white);font-weight:600}
    .mfx-psym{color:var(--text3);font-size:11px;font-weight:500}
    .mfx-row-self{background:rgba(37,99,235,.07)!important}
    .mfx-row-self td:first-child{box-shadow:inset 3px 0 0 var(--accent)}
    .mfx-selftag{font-size:9.5px;font-weight:800;color:var(--accent2);background:rgba(37,99,235,.14);padding:1px 6px;border-radius:4px;margin-left:7px;vertical-align:middle;letter-spacing:.03em}
    .mfx-score{display:inline-block;min-width:30px;text-align:center;font-weight:800;padding:2px 7px;border-radius:6px;color:#fff}
    /* sector-percentile context */
    .mfx-ctx{display:flex;flex-direction:column;gap:17px}
    .mfx-ctx-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:8px}
    .mfx-ctx-label{font-size:12.5px;color:var(--text2);font-weight:600}
    .mfx-ctx-label small{color:var(--text3);font-weight:500}
    .mfx-ctx-val{font-size:13px;font-weight:800;color:var(--white);font-variant-numeric:tabular-nums;white-space:nowrap}
    .mfx-track{position:relative;height:8px;border-radius:6px;background:linear-gradient(90deg,var(--ink) 0%,var(--ink3) 100%);border:0.5px solid var(--border)}
    .mfx-median{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--text3);border-radius:2px;opacity:.7}
    .mfx-dot{position:absolute;top:50%;width:14px;height:14px;border-radius:50%;transform:translate(-50%,-50%);border:2px solid var(--ink2);box-shadow:0 1px 4px rgba(8,15,30,.3);z-index:2;transition:left .9s cubic-bezier(.22,1,.36,1)}
    .mfx-ctx-foot{display:flex;justify-content:space-between;font-size:10.5px;color:var(--text3);margin-top:6px;font-variant-numeric:tabular-nums}
    .mfx-legend{display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:var(--text3);margin-top:2px}
    .mfx-legend span{display:inline-flex;align-items:center;gap:6px}
    /* ── V23.5: scale & footprint tiles ──
       Fixed column counts, not auto-fit: the card renders up to 8 tiles and
       auto-fit packed 7 across at desktop width, orphaning the 8th on its own
       row. 4/3/2 columns keep the grid balanced at every breakpoint. */
    .mfx-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
    .mfx-tile{background:var(--ink);border:0.5px solid var(--border);border-radius:var(--r-sm,10px);padding:13px 14px}
    .mfx-tile-l{font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);margin-bottom:6px}
    .mfx-tile-v{font-size:17px;font-weight:800;color:var(--white);font-variant-numeric:tabular-nums;line-height:1.25}
    .mfx-tile-s{font-size:11px;color:var(--text3);margin-top:4px;line-height:1.45}
    /* ── V23.5: money-flow waterfall ── */
    .mfx-flow{display:flex;flex-direction:column;gap:13px}
    .mfx-fl-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:5px}
    .mfx-fl-label{font-size:12.5px;font-weight:600;color:var(--text2)}
    .mfx-fl-label small{display:block;font-weight:500;color:var(--text3);font-size:11px;margin-top:2px}
    .mfx-fl-val{font-size:13px;font-weight:800;color:var(--white);font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
    .mfx-fl-val small{display:block;font-weight:600;font-size:11px;margin-top:2px}
    .mfx-fl-track{height:10px;border-radius:6px;background:var(--ink);border:0.5px solid var(--border);overflow:hidden}
    .mfx-fl-bar{height:100%;border-radius:6px;transition:width .8s cubic-bezier(.22,1,.36,1)}
    .mfx-fl-neg{font-size:11px;font-weight:700;color:var(--red)}
    .mfx-foot{font-size:12.5px;color:var(--text2);line-height:1.65;margin:15px 0 0;padding-top:14px;border-top:0.5px solid var(--border)}
    .mfx-foot b{color:var(--white)}
    /* ── V23.5: balance sheet ── */
    .mfx-bs-bars{display:flex;flex-direction:column;gap:9px;margin-bottom:4px}
    .mfx-bs-row{display:grid;grid-template-columns:64px 1fr auto;align-items:center;gap:10px;font-size:12px}
    .mfx-bs-k{color:var(--text3);font-weight:600}
    .mfx-bs-t{height:9px;border-radius:5px;background:var(--ink);border:0.5px solid var(--border);overflow:hidden}
    .mfx-bs-b{height:100%;border-radius:5px;transition:width .8s cubic-bezier(.22,1,.36,1)}
    .mfx-bs-v{font-weight:700;color:var(--white);font-variant-numeric:tabular-nums;white-space:nowrap}
    .mfx-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px;margin-top:14px;padding-top:14px;border-top:0.5px solid var(--border)}
    .mfx-m{background:var(--ink);border:0.5px solid var(--border);border-radius:8px;padding:10px 11px}
    .mfx-m-l{font-size:10.5px;color:var(--text3);font-weight:600;margin-bottom:5px;line-height:1.35}
    .mfx-m-v{font-size:14px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.2}
    .mfx-m-s{font-size:10.5px;color:var(--text3);margin-top:3px}
    /* ── V23.5: cash conversion cycle ── */
    .mfx-cc{display:flex;flex-direction:column;gap:11px}
    .mfx-cc-row{display:grid;grid-template-columns:132px 1fr 64px;align-items:center;gap:11px;font-size:12px}
    .mfx-cc-k{color:var(--text2);font-weight:600;line-height:1.35}
    .mfx-cc-k small{display:block;color:var(--text3);font-weight:500;font-size:10.5px}
    .mfx-cc-t{height:9px;border-radius:5px;background:var(--ink);border:0.5px solid var(--border);overflow:hidden}
    .mfx-cc-b{height:100%;border-radius:5px;transition:width .8s cubic-bezier(.22,1,.36,1)}
    .mfx-cc-v{text-align:right;font-weight:700;color:var(--white);font-variant-numeric:tabular-nums}
    /* ── V23.5: strengths / watch-outs ── */
    .mfx-sig{display:grid;grid-template-columns:1fr 1fr;gap:22px}
    .mfx-sig-h{font-size:11.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;display:flex;align-items:center;gap:7px;margin-bottom:12px}
    .mfx-sig-h.up{color:var(--green)}
    .mfx-sig-h.dn{color:var(--gold)}
    .mfx-sig-c{font-size:10px;font-weight:800;padding:1px 7px;border-radius:999px;background:var(--ink);border:0.5px solid var(--border2);color:var(--text3)}
    .mfx-sig-l{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
    .mfx-sig-i{display:flex;gap:9px;font-size:12.5px;line-height:1.55;color:var(--text2)}
    .mfx-sig-i b{color:var(--white)}
    .mfx-sig-d{flex:0 0 auto;width:6px;height:6px;border-radius:50%;margin-top:6px}
    .mfx-sig-i.up .mfx-sig-d{background:var(--green)}
    .mfx-sig-i.dn .mfx-sig-d{background:var(--gold)}
    .mfx-sig-none{font-size:12.5px;color:var(--text3);line-height:1.6;font-style:italic}
    @media (prefers-reduced-motion: reduce){.mfx-table tbody tr,.mfx-fl-bar,.mfx-bs-b,.mfx-cc-b,.mfx-own-seg,.mfx-dot{transition:none}}
    @media (max-width:1024px){.mfx-tiles{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media (max-width:860px){.mfx-sig{grid-template-columns:1fr;gap:20px}}
    @media (max-width:640px){
      .mfx-strip .card-body{padding:15px 16px 16px}
      .mfx-cc-row{grid-template-columns:108px 1fr 54px;gap:8px}
      .mfx-bs-row{grid-template-columns:56px 1fr auto;gap:8px}
      .mfx-tiles{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .mfx-tile-v{font-size:15.5px}
    }
    `;
    var s = document.createElement("style");
    s.id = "mfx-style";
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ── market-cap category (SEBI-style: top 100 Large / next 150 Mid / rest
  //    Small; sub-₹500 Cr flagged Micro) computed against the live universe ──
  function capCategory(D, all) {
    var mc = num(D.market_cap_cr);
    if (mc == null) return null;
    var ranked = all.filter(function (s) { return s && !s.error && num(s.market_cap_cr) != null; });
    if (!ranked.length) return null;
    var rank = 1;
    for (var i = 0; i < ranked.length; i++) { if (num(ranked[i].market_cap_cr) > mc) rank++; }
    var cat;
    if (mc < 500) cat = "Micro-cap";
    else if (rank <= 100) cat = "Large-cap";
    else if (rank <= 250) cat = "Mid-cap";
    else cat = "Small-cap";
    return { cat: cat, rank: rank, total: ranked.length };
  }

  function scoreColor(v) { // 0..100 → red→amber→green
    v = num(v); if (v == null) return "var(--text3)";
    if (v >= 75) return "var(--green)";
    if (v >= 60) return "#16a34a";
    if (v >= 45) return "var(--gold)";
    if (v >= 30) return "#ea7317";
    return "var(--red)";
  }

  // ── the always-visible business strip (under the KPI grid) ────────────────
  function renderStrip(D) {
    if (el("mfx-strip")) return;
    var kpi = el("kpiGrid"); if (!kpi || !kpi.parentNode) return;
    var name = D.name || D.symbol || "This company";
    var strip = document.createElement("div");
    strip.className = "card mfx-strip";
    strip.id = "mfx-strip";
    var desc = D.description ? esc(D.description) : "A detailed business description isn't available for this company in the current snapshot.";
    strip.innerHTML =
      '<div class="card-body">' +
        '<div class="mfx-eyebrow">What ' + esc(name) + ' does</div>' +
        '<p class="mfx-desc mfx-clamp" id="mfxStripDesc">' + desc + "</p>" +
        (D.description ? '<button class="mfx-more" id="mfxStripMore" type="button">Read full profile →</button>' : "") +
        '<div class="mfx-chips" id="mfxStripChips"></div>' +
      "</div>";
    kpi.parentNode.insertBefore(strip, kpi.nextSibling);

    var chips = [];
    var sector = clean(D.sector), industry = clean(D.industry);
    if (sector) chips.push('<span class="mfx-chip">🏢 <b>' + esc(sector) + "</b></span>");
    if (industry && industry !== sector) chips.push('<span class="mfx-chip">📦 ' + esc(industry) + "</span>");
    chips.push('<span class="mfx-chip" id="mfxCapChip" style="display:none"></span>');
    if (num(D.employees) != null) chips.push('<span class="mfx-chip">👥 <b>' + num(D.employees).toLocaleString("en-IN") + "</b> employees</span>");
    if (D.website) chips.push('<span class="mfx-chip accent">🔗 <a href="' + esc(D.website) + '" target="_blank" rel="noopener">Website</a></span>');
    el("mfxStripChips").innerHTML = chips.join("");

    var more = el("mfxStripMore");
    if (more) more.addEventListener("click", function () {
      try {
        var tab = Array.prototype.filter.call(document.querySelectorAll(".tab"), function (t) { return /['"]about['"]/.test(t.getAttribute("onclick") || ""); })[0];
        if (tab && typeof window.switchTab === "function") { window.switchTab("about", tab); tab.scrollIntoView({ behavior: "smooth", block: "start" }); }
      } catch (e) {}
    });
  }

  // ── rebuild the About tab shell (description + facts + snapshot) ──────────
  function renderTabBase(D) {
    var tab = el("tab-about"); if (!tab) return;
    var name = D.name || D.symbol || "the company";
    var exch = D.exchange === "NSI" ? "NSE" : (D.exchange || "NSE");

    // facts (canonical) — cap category filled in async
    var facts = [
      ["Sector", esc(clean(D.sector) || "—")],
      ["Industry", esc(clean(D.industry) || "—")],
      ["Market-cap class", '<span id="mfxCapFact">—</span>'],
      ["Head office", esc(D.country || "India")],
      ["Employees", num(D.employees) != null ? num(D.employees).toLocaleString("en-IN") : "—"],
      ["Listed on", esc(exch) + (D.symbol ? " · " + esc(D.symbol) : "")],
      ["Reporting currency", esc(D.currency || "INR")],
      ["Website", D.website ? '<a href="' + esc(D.website) + '" target="_blank" rel="noopener">' + esc(D.website.replace(/^https?:\/\//, "")) + "</a>" : "—"],
    ];

    tab.innerHTML =
      '<div class="card">' +
        '<div class="card-header"><span class="card-title">Business — what ' + esc(name) + " does</span><span class=\"mfx-src\">Public filings · Yahoo Finance</span></div>" +
        '<div class="card-body"><p class="mfx-desc" id="mfxFullDesc">' + (D.description ? esc(D.description) : "No business description is available for this company in the current snapshot.") + "</p></div>" +
      "</div>" +
      '<div class="card" id="mfxScaleCard" style="display:none">' +
        '<div class="card-header"><span class="card-title">The business by the numbers</span><span class="mfx-src">trailing twelve months</span></div>' +
        '<div class="card-body"><div class="mfx-tiles" id="mfxScaleBody"></div></div>' +
      "</div>" +
      '<div class="two-col">' +
        '<div class="card">' +
          '<div class="card-header"><span class="card-title">Company at a glance</span></div>' +
          '<div class="card-body"><div class="info-grid mfx-facts">' +
            facts.map(function (f) { return '<div class="info-item"><div class="ii-label">' + f[0] + '</div><div class="ii-value">' + f[1] + "</div></div>"; }).join("") +
          "</div></div>" +
        "</div>" +
        '<div class="card">' +
          '<div class="card-header"><span class="card-title">Dividend, ownership &amp; risk</span></div>' +
          '<div class="card-body"><div class="mfx-snap">' + snapshotHTML(D) + "</div></div>" +
        "</div>" +
      "</div>" +
      '<div class="two-col">' +
        '<div class="card" id="mfxFlowCard" style="display:none">' +
          '<div class="card-header"><span class="card-title">How the money flows</span><span class="mfx-src">% of revenue</span></div>' +
          '<div class="card-body"><div class="mfx-flow" id="mfxFlowBody"></div><p class="mfx-foot" id="mfxFlowFoot"></p></div>' +
        "</div>" +
        '<div class="card" id="mfxBsCard" style="display:none">' +
          '<div class="card-header"><span class="card-title">Balance sheet &amp; solvency</span><span class="mfx-src">latest reported</span></div>' +
          '<div class="card-body"><div class="mfx-bs-bars" id="mfxBsBars"></div><div class="mfx-metrics" id="mfxBsMetrics"></div><p class="mfx-foot" id="mfxBsFoot"></p></div>' +
        "</div>" +
      "</div>" +
      '<div class="card" id="mfxCcCard" style="display:none">' +
        '<div class="card-header"><span class="card-title">Cash conversion cycle</span><span class="mfx-src">working-capital days</span></div>' +
        '<div class="card-body"><div class="mfx-cc" id="mfxCcBody"></div><p class="mfx-foot" id="mfxCcFoot"></p></div>' +
      "</div>" +
      '<div class="card" id="mfxSigCard" style="display:none">' +
        '<div class="card-header"><span class="card-title">What the numbers show</span><span class="mfx-src">auto-derived from this snapshot</span></div>' +
        '<div class="card-body"><div class="mfx-sig" id="mfxSigBody"></div>' +
          '<p class="mfx-foot">These are <b>automated observations</b> computed from the latest snapshot against fixed thresholds — data points to research further, not recommendations or investment advice.</p>' +
        "</div>" +
      "</div>" +
      '<div class="card" id="mfxPeersCard" style="display:none">' +
        '<div class="card-header"><span class="card-title" id="mfxPeersTitle">Peers</span><span class="mfx-src">by market cap</span></div>' +
        '<div class="card-body"><p class="mfx-note" id="mfxPeersNote"></p><div class="mfx-tablewrap"><table class="mfx-table" id="mfxPeersTable"></table></div></div>' +
      "</div>" +
      '<div class="card" id="mfxSectorCard" style="display:none">' +
        '<div class="card-header"><span class="card-title" id="mfxSectorTitle">Sector context</span><span class="mfx-src">percentile vs sector</span></div>' +
        '<div class="card-body"><div class="mfx-ctx" id="mfxSectorBody"></div>' +
          '<div class="mfx-legend"><span><span class="mfx-dot" style="position:static;width:11px;height:11px;background:var(--accent)"></span>This company</span><span><span style="width:2px;height:12px;background:var(--text3);display:inline-block;border-radius:2px"></span>Sector median</span></div>' +
        "</div>" +
      "</div>";

    growOnReveal(tab); // ownership split bar (the later panels wire their own)
  }

  function snapshotHTML(D) {
    var out = [];

    // dividend
    var dy = num(D.dividend_yield), dr = num(D.dividend_rate), pr = num(D.payout_ratio);
    if (dy != null && dy > 0) {
      var dtag = pr != null && pr > 70 ? '<span class="mfx-tag warn">High payout</span>' : '<span class="mfx-tag good">Dividend payer</span>';
      out.push('<div><div class="mfx-line"><b>Dividend</b> &nbsp;' + dtag + "</div>" +
        '<div class="mfx-line" style="color:var(--text3);margin-top:4px">Yield <b>' + pctS(dy, 2) + "</b>" +
        (dr != null ? " · ₹<b>" + fx(dr, 2) + "</b>/share" : "") +
        (pr != null ? " · payout <b>" + pctS(pr, 0) + "</b> of earnings" : "") + "</div></div>");
    } else {
      out.push('<div><div class="mfx-line"><b>Dividend</b> &nbsp;<span class="mfx-tag mut">None currently</span></div>' +
        '<div class="mfx-line" style="color:var(--text3);margin-top:4px">Returns are reinvested rather than paid out.</div></div>');
    }

    // ownership
    var promo = num(D.promoter_holding), inst = num(D.institutional_holding);
    if (promo != null || inst != null) {
      var p = promo || 0, i = inst || 0, pub = Math.max(0, 100 - p - i);
      out.push('<div><div class="mfx-line" style="margin-bottom:2px"><b>Ownership</b></div>' +
        '<div class="mfx-own-bar">' +
          (p > 0 ? '<div class="mfx-own-seg" data-grow-w="' + p + '%" style="width:0;background:#1a50d8"></div>' : "") +
          (i > 0 ? '<div class="mfx-own-seg" data-grow-w="' + i + '%" style="width:0;background:#0891b2"></div>' : "") +
          '<div class="mfx-own-seg" data-grow-w="' + pub + '%" style="width:0;background:var(--ink3)"></div>' +
        "</div>" +
        '<div class="mfx-own-key">' +
          '<span><span class="mfx-sw" style="background:#1a50d8"></span>Promoter <b style="color:var(--white)">' + (promo != null ? fx(promo, 1) + "%" : "N/A") + "</b></span>" +
          '<span><span class="mfx-sw" style="background:#0891b2"></span>Institutions <b style="color:var(--white)">' + (inst != null ? fx(inst, 1) + "%" : "N/A") + "</b></span>" +
          '<span><span class="mfx-sw" style="background:var(--ink3);border:0.5px solid var(--border2)"></span>Public ~<b style="color:var(--white)">' + fx(pub, 1) + "%</b></span>" +
        "</div></div>");
    }

    // volatility (beta)
    var beta = num(D.beta);
    if (beta != null) {
      var band = beta < 0.8 ? ["Lower volatility than the market", "good"] : beta <= 1.2 ? ["Moves roughly with the market", "mut"] : ["More volatile than the market", "warn"];
      out.push('<div><div class="mfx-line"><b>Volatility</b> &nbsp;<span class="mfx-tag ' + band[1] + '">β ' + fx(beta, 2) + "</span></div>" +
        '<div class="mfx-line" style="color:var(--text3);margin-top:4px">' + band[0] + ".</div></div>");
    }

    // 52-week performance context
    var fh = num(D["52w_from_high_pct"]), fl = num(D["52w_from_low_pct"]);
    if (fh != null || fl != null) {
      out.push('<div><div class="mfx-line"><b>52-week position</b></div>' +
        '<div class="mfx-line" style="color:var(--text3);margin-top:4px">' +
        (fh != null ? "<b style='color:var(--" + (fh < -0.01 ? "red" : "green") + ")'>" + (fh >= 0 ? "+" : "") + fx(fh, 1) + "%</b> from its 52-week high" : "") +
        (fh != null && fl != null ? " · " : "") +
        (fl != null ? "<b style='color:var(--green)'>+" + fx(fl, 1) + "%</b> from its low" : "") +
        "</div></div>");
    }
    return out.join("");
  }

  // ── fill cap category into the strip chip + the facts row ─────────────────
  function fillCap(D, all) {
    var cc = capCategory(D, all);
    if (!cc) return;
    var chip = el("mfxCapChip");
    if (chip) { chip.style.display = ""; chip.innerHTML = "📊 <b>" + cc.cat + "</b>"; }
    var fact = el("mfxCapFact");
    if (fact) fact.innerHTML = '<b style="color:var(--white)">' + cc.cat + "</b> <span style='color:var(--text3);font-weight:500'>· #" + cc.rank + " of " + cc.total.toLocaleString("en-IN") + " by market cap</span>";
  }

  // ── peer comparison table (largest names in the same industry / sector) ───
  function renderPeers(D, all) {
    var card = el("mfxPeersCard"), table = el("mfxPeersTable"), note = el("mfxPeersNote"), title = el("mfxPeersTitle");
    if (!card || !table) return;
    var sym = String(D.symbol || "").toUpperCase();
    var indClean = clean(D.industry), secClean = clean(D.sector);

    function pool(keyName, want) {
      if (!want) return [];
      return all.filter(function (s) {
        return s && !s.error && clean(s[keyName]) === want && num(s.market_cap_cr) != null;
      });
    }
    var basis = "industry", peers = pool("industry", indClean);
    if (peers.length < 5) { basis = "sector"; peers = pool("sector", secClean); }
    if (peers.length < 2) { card.style.display = "none"; return; }

    peers.sort(function (a, b) { return num(b.market_cap_cr) - num(a.market_cap_cr); });
    var top = peers.slice(0, 10);
    var hasSelf = top.some(function (s) { return String(s.symbol || "").toUpperCase() === sym; });
    if (!hasSelf) { var self = peers.filter(function (s) { return String(s.symbol || "").toUpperCase() === sym; })[0]; if (self) { top = top.slice(0, 9).concat([self]); } }
    top.sort(function (a, b) { return num(b.market_cap_cr) - num(a.market_cap_cr); });

    var showScore = num(D._overall) != null && top.some(function (s) { return num(s._overall) != null; });
    var groupName = basis === "industry" ? (indClean || "the industry") : (secClean || "the sector");
    title.textContent = "Peers in " + groupName;
    note.innerHTML = "Largest listed companies in the same " + basis + ", ranked by market capitalisation. This gives quick context on where <b style='color:var(--white)'>" + esc(D.name || sym) + "</b> sits among comparable businesses. Click any peer to open its full report.";

    var head = "<thead><tr><th>Company</th><th>Mkt Cap</th><th>P/E</th><th>P/B</th><th>ROE</th><th>Net margin</th>" + (showScore ? "<th>MFC Score</th>" : "") + "</tr></thead>";
    var rows = top.map(function (s) {
      var isSelf = String(s.symbol || "").toUpperCase() === sym;
      var nameCell = isSelf
        ? '<span class="mfx-pname">' + esc(s.name || s.symbol) + '</span><span class="mfx-selftag">THIS</span><div class="mfx-psym">' + esc(s.symbol) + "</div>"
        : '<a href="company.html?symbol=' + encodeURIComponent(s.symbol) + '">' + esc(s.name || s.symbol) + '</a><div class="mfx-psym">' + esc(s.symbol) + "</div>";
      var scoreCell = "";
      if (showScore) {
        var sc = num(s._overall);
        scoreCell = "<td>" + (sc != null ? '<span class="mfx-score" style="background:' + scoreColor(sc) + '">' + Math.round(sc) + "</span>" : "—") + "</td>";
      }
      return '<tr class="' + (isSelf ? "mfx-row-self" : "") + '">' +
        "<td>" + nameCell + "</td>" +
        "<td>" + crStr(s.market_cap_cr) + "</td>" +
        "<td>" + fx(s.pe_ratio, 1) + "</td>" +
        "<td>" + fx(s.pb_ratio, 2) + "</td>" +
        "<td>" + pctS(s.roe, 1) + "</td>" +
        "<td>" + pctS(s.net_margin, 1) + "</td>" +
        scoreCell +
        "</tr>";
    }).join("");
    table.innerHTML = head + "<tbody>" + rows + "</tbody>";
    card.style.display = "";
  }

  // ── sector-percentile context bars ────────────────────────────────────────
  function renderSectorContext(D, all) {
    var card = el("mfxSectorCard"), body = el("mfxSectorBody"), title = el("mfxSectorTitle");
    var secClean = clean(D.sector);
    if (!card || !body || !secClean) { if (card) card.style.display = "none"; return; }
    var sectorPeers = all.filter(function (s) { return s && !s.error && clean(s.sector) === secClean; });
    if (sectorPeers.length < 8) { card.style.display = "none"; return; }

    // metric specs: better = direction that is "good"
    var specs = [
      { key: "pe_ratio", label: "P/E ratio", sub: "valuation", better: "low", fmt: function (v) { return fx(v, 1) + "×"; } },
      { key: "pb_ratio", label: "Price / Book", sub: "valuation", better: "low", fmt: function (v) { return fx(v, 2) + "×"; } },
      { key: "roe", label: "Return on equity", sub: "quality", better: "high", fmt: function (v) { return pctS(v, 1); } },
      { key: "net_margin", label: "Net margin", sub: "profitability", better: "high", fmt: function (v) { return pctS(v, 1); } },
      { key: "revenue_growth", label: "Revenue growth", sub: "YoY", better: "high", fmt: function (v) { return pctS(v, 1); } },
      { key: "dividend_yield", label: "Dividend yield", sub: "income", better: "high", fmt: function (v) { return pctS(v, 2); } },
    ];

    var out = [];
    specs.forEach(function (m) {
      var self = num(D[m.key]); if (self == null) return;
      var vals = sectorPeers.map(function (s) { return num(s[m.key]); }).filter(function (v) { return v != null; }).sort(function (a, b) { return a - b; });
      if (vals.length < 8) return;
      var p10 = quantile(vals, 0.1), p50 = quantile(vals, 0.5), p90 = quantile(vals, 0.9);
      var lo = Math.min(p10, self), hi = Math.max(p90, self);
      if (hi - lo < 1e-9) return;
      function posOf(v) { return Math.max(2, Math.min(98, (v - lo) / (hi - lo) * 100)); }
      var better = m.better === "high" ? self >= p50 : self <= p50;
      var dotColor = better ? "var(--green)" : "var(--gold)";
      var rank = vals.filter(function (v) { return v < self; }).length;
      var pctile = Math.round(rank / vals.length * 100);
      var verdict = m.better === "high"
        ? (pctile >= 50 ? "Top " + (100 - pctile) + "% of the sector" : "Below the sector median")
        : (pctile <= 50 ? "Cheaper than " + (100 - pctile) + "% of the sector" : "Pricier than the sector median");
      out.push(
        '<div class="mfx-ctx-row">' +
          '<div class="mfx-ctx-head"><div class="mfx-ctx-label">' + m.label + " <small>· " + m.sub + '</small></div><div class="mfx-ctx-val" style="color:' + dotColor + '">' + m.fmt(self) + "</div></div>" +
          // The dot departs FROM the sector median and travels to where this
          // company actually sits — the distance it covers is the story.
          '<div class="mfx-track"><div class="mfx-median" style="left:' + posOf(p50) + '%"></div><div class="mfx-dot" data-grow-left="' + posOf(self) + '%" style="left:' + posOf(p50) + "%;background:" + dotColor + '"></div></div>' +
          '<div class="mfx-ctx-foot"><span>' + m.fmt(p10) + "</span><span style='color:" + dotColor + ";font-weight:600'>" + verdict + "</span><span>" + m.fmt(p90) + "</span></div>" +
        "</div>"
      );
    });

    if (!out.length) { card.style.display = "none"; return; }
    title.textContent = "How " + (D.symbol || "it") + " compares within " + secClean;
    body.innerHTML = out.join("");
    card.style.display = "";
    growOnReveal(card);
  }

  // ══ V23.5 ═════════════════════════════════════════════════════════════════
  // "The business by the numbers" — scale & footprint tiles. Every tile is
  // conditional: `employees` is present for only ~22% of the universe, so
  // headcount-derived tiles simply don't appear for the rest.
  function renderScale(D, all) {
    var card = el("mfxScaleCard"), body = el("mfxScaleBody");
    if (!card || !body) return;
    var t = [];
    function tile(label, value, sub) { t.push('<div class="mfx-tile"><div class="mfx-tile-l">' + label + '</div><div class="mfx-tile-v">' + value + "</div>" + (sub ? '<div class="mfx-tile-s">' + sub + "</div>" : "") + "</div>"); }

    var rev = num(D.revenue_cr), np = num(D.net_profit_cr), emp = num(D.employees);
    // A handful of names report negative/zero revenue in the snapshot — "₹-17 Cr
    // of revenue" is meaningless, so skip the tile rather than print nonsense
    // (the money-flow waterfall hides itself on the same condition).
    if (rev != null && rev > 0) tile("Revenue", crStr(rev), "Total sales over the last 12 months");
    if (np != null) tile("Net profit", '<span style="color:' + (np >= 0 ? "var(--green)" : "var(--red)") + '">' + crStr(Math.abs(np)) + (np < 0 ? " loss" : "") + "</span>",
      num(D.net_margin) != null && rev != null && rev > 0 ? fx(np / rev * 100, 1) + "% of revenue" : "");

    var cc = capCategory(D, all);
    tile("Market cap", crStr(D.market_cap_cr), cc ? cc.cat + " · #" + cc.rank + " of " + cc.total.toLocaleString("en-IN") : "");
    if (num(D.enterprise_value_cr) != null) tile("Enterprise value", crStr(D.enterprise_value_cr), "Market cap plus net debt");

    if (emp != null && emp > 0) {
      tile("Employees", emp.toLocaleString("en-IN"), "Reported headcount");
      // Revenue per employee is only meaningful when both sides are real.
      if (rev != null && rev > 0) {
        var rpe = rev * 1e7 / emp; // ₹ Cr → ₹
        tile("Revenue / employee", "₹" + (rpe >= 1e7 ? (rpe / 1e7).toFixed(2) + " Cr" : (rpe / 1e5).toFixed(1) + " L"), "Output per head");
      }
    }
    var so = num(D.shares_outstanding);
    if (so != null && so > 0) tile("Shares outstanding", (so / 1e7).toFixed(2) + " Cr", "Total shares issued");
    var fl = num(D.float_pct), mc = num(D.market_cap_cr);
    if (fl != null && mc != null && fl > 0) tile("Free-float market cap", crStr(mc * fl / 100), fx(fl, 1) + "% of shares trade freely");

    if (t.length < 3) { card.style.display = "none"; return; }
    body.innerHTML = t.join("");
    card.style.display = "";
  }

  // ── "How the money flows" — a revenue → net-profit waterfall ──────────────
  //    Margins are recomputed from the values actually plotted, so the bars and
  //    their labels can never disagree (the snapshot's own gross_margin is 0 on
  //    banks whose gross_profit equals revenue — we skip that degenerate step).
  function flowSteps(D) {
    var rev = num(D.revenue_cr);
    if (rev == null || rev <= 0) return null;          // negative/zero revenue → meaningless
    var steps = [{ label: "Revenue", sub: "Everything the company billed", v: rev, color: "var(--accent)" }];
    var gp = num(D.gross_profit_cr);
    if (gp != null && Math.abs(gp - rev) > rev * 0.005)
      steps.push({ label: "Gross profit", sub: "After the direct cost of goods &amp; services", v: gp, color: "#0891b2" });
    var eb = num(D.ebitda_cr);
    if (eb != null) steps.push({ label: "EBITDA", sub: "Before interest, tax &amp; depreciation", v: eb, color: "#0ea5e9" });
    var om = num(D.operating_margin);
    if (om != null && Math.abs(om) <= 100)             // |om| of 132% / −186% is junk
      steps.push({ label: "Operating profit", sub: "After running costs &amp; depreciation", v: rev * om / 100, color: "#6366f1" });
    var np = num(D.net_profit_cr);
    if (np != null) steps.push({ label: "Net profit", sub: "What is left for shareholders", v: np, color: np >= 0 ? "var(--green)" : "var(--red)" });
    return steps.length >= 3 ? { rev: rev, steps: steps } : null;
  }

  function renderMoneyFlow(D) {
    var card = el("mfxFlowCard"), body = el("mfxFlowBody"), foot = el("mfxFlowFoot");
    if (!card || !body) return;
    var f = flowSteps(D);
    if (!f) { card.style.display = "none"; return; }

    body.innerHTML = f.steps.map(function (s) {
      var pct = s.v / f.rev * 100;
      var w = Math.max(0, Math.min(100, pct));
      var neg = s.v < 0;
      return '<div class="mfx-fl-row">' +
        '<div class="mfx-fl-head">' +
          '<div class="mfx-fl-label">' + s.label + "<small>" + s.sub + "</small></div>" +
          '<div class="mfx-fl-val">' + (neg ? '<span style="color:var(--red)">' + crStr(s.v) + "</span>" : crStr(s.v)) +
            '<small style="color:' + (neg ? "var(--red)" : "var(--text3)") + '">' + fx(pct, 1) + "% of revenue</small></div>" +
        "</div>" +
        '<div class="mfx-fl-track">' + (neg ? "" : '<div class="mfx-fl-bar" data-grow-w="' + w.toFixed(1) + '%" style="width:0;background:' + s.color + '"></div>') + "</div>" +
        (neg ? '<div class="mfx-fl-neg">Negative — nothing remains at this line</div>' : "") +
      "</div>";
    }).join("");

    if (foot) {
      var np = num(D.net_profit_cr);
      foot.innerHTML = np == null ? "" : (np >= 0
        ? "For every <b>₹100</b> of revenue, <b>₹" + fx(np / f.rev * 100, 2) + "</b> is left as net profit after every cost, interest and tax."
        : "For every <b>₹100</b> of revenue, the company currently <b>loses ₹" + fx(Math.abs(np) / f.rev * 100, 2) + "</b> once every cost, interest and tax is counted.");
    }
    card.style.display = "";
    growOnReveal(card);
  }

  // ── Balance sheet & solvency ──────────────────────────────────────────────
  function renderBalanceSheet(D) {
    var card = el("mfxBsCard"), bars = el("mfxBsBars"), mets = el("mfxBsMetrics"), foot = el("mfxBsFoot");
    if (!card || !bars) return;
    var cash = num(D.total_cash_cr), debt = num(D.total_debt_cr), nd = num(D.net_debt_cr);
    if (cash == null && debt == null) { card.style.display = "none"; return; }

    var mx = Math.max(cash || 0, debt || 0);
    function bar(k, v, color) {
      if (v == null) return "";
      var w = mx > 0 ? Math.max(1.5, v / mx * 100) : 0;
      return '<div class="mfx-bs-row"><div class="mfx-bs-k">' + k + '</div>' +
        '<div class="mfx-bs-t"><div class="mfx-bs-b" data-grow-w="' + w.toFixed(1) + '%" style="width:0;background:' + color + '"></div></div>' +
        '<div class="mfx-bs-v">' + crStr(v) + "</div></div>";
    }
    bars.innerHTML = bar("Cash", cash, "linear-gradient(90deg,#0891b2,#22d3ee)") + bar("Debt", debt, "linear-gradient(90deg,#b45309,#f59e0b)");

    var m = [];
    function met(label, val, color, sub) { m.push('<div class="mfx-m"><div class="mfx-m-l">' + label + '</div><div class="mfx-m-v" style="color:' + (color || "var(--white)") + '">' + val + "</div>" + (sub ? '<div class="mfx-m-s">' + sub + "</div>" : "") + "</div>"); }

    if (nd != null) met("Net debt", nd < 0 ? crStr(Math.abs(nd)) + " net cash" : crStr(nd),
      nd < 0 ? "var(--green)" : "var(--white)", nd < 0 ? "More cash than debt" : "Debt minus cash");
    var nde = num(D.net_debt_ebitda);
    if (nde != null && Math.abs(nde) < 50) met("Net debt / EBITDA", fx(nde, 2) + "×",
      nde <= 1 ? "var(--green)" : nde <= 3 ? "var(--white)" : "var(--gold)",
      nde <= 1 ? "Comfortable" : nde <= 3 ? "Manageable" : "Elevated leverage");
    var ic = num(D.interest_coverage);
    if (ic != null && Math.abs(ic) < 1000) met("Interest coverage", fx(ic, 1) + "×",
      ic >= 5 ? "var(--green)" : ic >= 2 ? "var(--white)" : "var(--gold)",
      ic >= 5 ? "Interest easily covered" : ic >= 2 ? "Interest covered" : "Thin cushion");
    var cr = num(D.current_ratio);
    if (cr != null && cr < 100) met("Current ratio", fx(cr, 2),
      cr >= 1.5 ? "var(--green)" : cr >= 1 ? "var(--white)" : "var(--gold)",
      cr >= 1 ? "Short-term bills covered" : "Current liabilities exceed assets");
    var de = num(D.debt_to_equity);
    if (de != null) { var der = de / 100; met("Debt / equity", fx(der, 2) + "×", der <= 0.5 ? "var(--green)" : der <= 1 ? "var(--white)" : "var(--gold)", der <= 0.5 ? "Lightly geared" : der <= 1 ? "Moderately geared" : "Highly geared"); }
    var wc = num(D.working_capital_cr);
    if (wc != null) met("Working capital", crStr(wc), wc >= 0 ? "var(--white)" : "var(--gold)", "Current assets − liabilities");
    if (mets) mets.innerHTML = m.join("");

    if (foot) {
      foot.innerHTML = nd == null ? "" : (nd < 0
        ? "<b>" + esc(D.name || D.symbol || "The company") + "</b> holds <b>" + crStr(Math.abs(nd)) + "</b> more cash than total debt — a net-cash balance sheet."
        : "Total debt exceeds cash by <b>" + crStr(nd) + "</b>" + (nde != null && Math.abs(nde) < 50 ? ", or about <b>" + fx(nde, 1) + " years</b> of EBITDA." : "."));
    }
    card.style.display = "";
    growOnReveal(card);
  }

  // ── Cash conversion cycle ─────────────────────────────────────────────────
  //    days = receivable + inventory − payable. Inventory days are derived as
  //    365 / inventory_turnover (reconciles with the snapshot's stored
  //    cash_conv_cycle for ~93% of names). Skipped entirely for lenders, where a
  //    working-capital cycle is not a meaningful concept, and for the handful of
  //    names carrying absurd inputs (e.g. 1,350 payable days → a 21,250-day CCC).
  function renderCashCycle(D) {
    var card = el("mfxCcCard"), body = el("mfxCcBody"), foot = el("mfxCcFoot");
    if (!card || !body) return;
    function hide() { card.style.display = "none"; }
    if (clean(D.sector) === "Financial Services") return hide();

    var rd = num(D.receivable_days), pd = num(D.payable_days), it = num(D.inventory_turnover);
    var invd = (it != null && it > 0) ? 365 / it : null;
    if (rd == null || pd == null || invd == null) return hide();
    var sane = function (v) { return v != null && v >= 0 && v <= 730; };
    if (!sane(rd) || !sane(pd) || !sane(invd)) return hide();

    var ccc = rd + invd - pd;
    var mx = Math.max(rd, invd, pd, 1);
    var rows = [
      ["Receivable days", "Time customers take to pay", rd, "linear-gradient(90deg,#1a50d8,#3b82f6)"],
      ["Inventory days", "Time stock sits before selling", invd, "linear-gradient(90deg,#0891b2,#22d3ee)"],
      ["Payable days", "Time taken to pay suppliers", pd, "linear-gradient(90deg,#059669,#34d399)"],
    ];
    body.innerHTML = rows.map(function (r) {
      return '<div class="mfx-cc-row"><div class="mfx-cc-k">' + r[0] + "<small>" + r[1] + "</small></div>" +
        '<div class="mfx-cc-t"><div class="mfx-cc-b" data-grow-w="' + (r[2] / mx * 100).toFixed(1) + '%" style="width:0;background:' + r[3] + '"></div></div>' +
        '<div class="mfx-cc-v">' + Math.round(r[2]) + "d</div></div>";
    }).join("");

    if (foot) {
      foot.innerHTML = ccc >= 0
        ? "Cash is tied up for roughly <b>" + Math.round(ccc) + " days</b> between paying suppliers and collecting from customers (receivable + inventory − payable). Shorter cycles free up working capital."
        : "The cycle is <b>negative (" + Math.round(ccc) + " days)</b> — suppliers are paid after customers pay, so the business is effectively funded by its own supply chain.";
    }
    card.style.display = "";
    growOnReveal(card);
  }

  // ── "What the numbers show" — derived strengths & watch-outs ──────────────
  //    Plain threshold read-outs of the snapshot. Deliberately factual: each
  //    line states the measured value, never a verdict on the stock itself.
  function renderSignals(D) {
    var card = el("mfxSigCard"), body = el("mfxSigBody");
    if (!card || !body) return;
    var up = [], dn = [];
    function U(t) { up.push(t); } function W(t) { dn.push(t); }

    var roe = num(D.roe), roce = num(D.roce), nm = num(D.net_margin), gm = num(D.gross_margin),
        rg = num(D.revenue_growth), eg = num(D.earnings_growth), de = num(D.debt_to_equity),
        nd = num(D.net_debt_cr), ic = num(D.interest_coverage), fcf = num(D.fcf_cr),
        fy = num(D.fcf_yield), dy = num(D.dividend_yield), gmos = num(D.graham_mos),
        ph = num(D.promoter_holding), cr = num(D.current_ratio), pe = num(D.pe_ratio),
        pr = num(D.payout_ratio), nde = num(D.net_debt_ebitda), beta = num(D.beta),
        fh = num(D["52w_from_high_pct"]), np = num(D.net_profit_cr);

    // strengths
    if (roe != null && roe >= 15) U("<b>Strong return on equity</b> — " + fx(roe, 1) + "% earned on shareholder capital.");
    if (roce != null && roce >= 15) U("<b>High return on capital employed</b> at " + fx(roce, 1) + "%.");
    if (nm != null && nm >= 10 && np != null && np > 0) U("<b>Healthy net margin</b> — " + fx(nm, 1) + "% of revenue converts to profit.");
    if (gm != null && gm >= 40) U("<b>Wide gross margin</b> of " + fx(gm, 1) + "%, pointing to pricing power.");
    if (rg != null && rg >= 10) U("<b>Revenue growing</b> " + fx(rg, 1) + "% year on year.");
    if (eg != null && eg >= 15) U("<b>Earnings growing</b> " + fx(eg, 1) + "% year on year.");
    if (nd != null && nd < 0) U("<b>Net cash</b> — " + crStr(Math.abs(nd)) + " more cash than debt.");
    else if (de != null && de / 100 <= 0.5) U("<b>Low debt</b> — debt/equity of just " + fx(de / 100, 2) + "×.");
    if (ic != null && ic >= 5 && ic < 1000) U("<b>Interest comfortably covered</b> " + fx(ic, 1) + "× by earnings.");
    if (fcf != null && fcf > 0 && fy != null && fy >= 5) U("<b>Strong free cash flow</b> — " + fx(fy, 1) + "% FCF yield.");
    else if (fcf != null && fcf > 0) U("<b>Free cash flow positive</b> at " + crStr(fcf) + ".");
    if (dy != null && dy >= 2) U("<b>Meaningful dividend</b> — " + fx(dy, 2) + "% yield.");
    if (gmos != null && gmos >= 20) U("<b>Below Graham fair value</b> — " + fx(gmos, 0) + "% margin of safety on that formula.");
    if (ph != null && ph >= 50) U("<b>High promoter holding</b> at " + fx(ph, 1) + "% — founders retain a large stake.");
    if (cr != null && cr >= 1.5 && cr < 100) U("<b>Comfortable liquidity</b> — current ratio of " + fx(cr, 2) + ".");
    if (pe != null && pe > 0 && pe <= 15) U("<b>Modest earnings multiple</b> — P/E of " + fx(pe, 1) + "×.");
    if (D.above_sma50 && D.above_sma200) U("<b>Above both moving averages</b> — trading over its 50- and 200-day lines.");

    // watch-outs
    if (np != null && np < 0) W("<b>Loss-making</b> — " + crStr(Math.abs(np)) + " net loss over the last twelve months.");
    else if (nm != null && nm < 3 && nm >= 0) W("<b>Thin net margin</b> of " + fx(nm, 1) + "% leaves little room for error.");
    if (roe != null && roe < 8) W("<b>Low return on equity</b> — " + fx(roe, 1) + "% on shareholder capital.");
    if (rg != null && rg < 0) W("<b>Revenue shrinking</b> " + fx(Math.abs(rg), 1) + "% year on year.");
    if (eg != null && eg < 0) W("<b>Earnings falling</b> " + fx(Math.abs(eg), 1) + "% year on year.");
    if (de != null && de / 100 > 1.5) W("<b>High leverage</b> — debt/equity of " + fx(de / 100, 2) + "×.");
    if (nde != null && nde > 3 && nde < 50) W("<b>Debt is " + fx(nde, 1) + "× EBITDA</b> — it would take years of earnings to repay.");
    if (ic != null && ic < 2) W("<b>Interest barely covered</b> — earnings cover interest just " + fx(ic, 1) + "×.");
    if (cr != null && cr < 1) W("<b>Current liabilities exceed current assets</b> — ratio of " + fx(cr, 2) + ".");
    if (fcf != null && fcf < 0) W("<b>Negative free cash flow</b> — " + crStr(Math.abs(fcf)) + " burned after capex.");
    if (pr != null && pr > 80 && dy != null && dy > 0) W("<b>Payout ratio of " + fx(pr, 0) + "%</b> — most earnings are paid out, limiting reinvestment.");
    if (pe != null && pe > 60) W("<b>Rich earnings multiple</b> — P/E of " + fx(pe, 1) + "× prices in strong growth.");
    if (beta != null && beta > 1.5) W("<b>High volatility</b> — beta of " + fx(beta, 2) + " swings more than the market.");
    if (fh != null && fh < -40) W("<b>Well off its highs</b> — " + fx(fh, 1) + "% from the 52-week peak.");
    if (ph != null && ph < 25) W("<b>Low promoter holding</b> at " + fx(ph, 1) + "%.");

    if (!up.length && !dn.length) { card.style.display = "none"; return; }
    up = up.slice(0, 7); dn = dn.slice(0, 7);

    function col(items, cls, head, empty) {
      return "<div><div class='mfx-sig-h " + cls + "'>" + head +
        "<span class='mfx-sig-c'>" + items.length + "</span></div>" +
        (items.length
          ? "<ul class='mfx-sig-l'>" + items.map(function (t) { return "<li class='mfx-sig-i " + cls + "'><span class='mfx-sig-d'></span><span>" + t + "</span></li>"; }).join("") + "</ul>"
          : "<p class='mfx-sig-none'>" + empty + "</p>") + "</div>";
    }
    body.innerHTML =
      col(up, "up", "✓ Strengths", "No threshold-beating strengths in this snapshot.") +
      col(dn, "dn", "⚠ Watch-outs", "Nothing tripped the watch-out thresholds in this snapshot.");
    card.style.display = "";
  }

  // ── entry point ───────────────────────────────────────────────────────────
  function render(D) {
    if (!D) return;
    try { injectStyle(); } catch (e) {}
    try { renderStrip(D); } catch (e) {}
    try { renderTabBase(D); } catch (e) {}
    // These five need only the stock itself — render them immediately so the
    // tab is complete even if the universe fetch is slow or fails outright.
    try { renderMoneyFlow(D); } catch (e) {}
    try { renderBalanceSheet(D); } catch (e) {}
    try { renderCashCycle(D); } catch (e) {}
    try { renderSignals(D); } catch (e) {}
    universe().then(function (all) {
      all = all || [];
      try { fillCap(D, all); } catch (e) {}
      try { renderScale(D, all); } catch (e) {}
      try { renderPeers(D, all); } catch (e) {}
      try { renderSectorContext(D, all); } catch (e) {}
    }).catch(function () {});
  }

  window.MFCCompany = { render: render };
})();

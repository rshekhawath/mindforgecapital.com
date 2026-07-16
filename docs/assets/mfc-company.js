/* ============================================================================
   MFC Company Deep-Dive — shared enrichment (V23.4)
   ----------------------------------------------------------------------------
   Both stock detail pages — /screener/company.html (Scanner) and
   /scores/company.html (Integrity Score) — are thin: an Overview / Ratios /
   Shareholding / About set of tabs where "About" was one description paragraph
   plus a 7-row fact grid. This module turns the detail page into a proper
   company profile without duplicating logic across the two big HTML files.

   It renders, purely client-side from the SAME snapshot both pages already load
   (screener/stocks.json, ~90 fields/stock, full universe in memory):

     1. an always-visible "what this company does" business strip under the KPIs
     2. a rebuilt About tab — full business description, an expanded key-facts
        grid (incl. a market-cap category), a dividend + ownership + volatility
        snapshot, a PEER comparison table (largest names in the same industry,
        each linked to its own detail page), and a "how it compares within its
        sector" percentile-context panel.

   Design rules:
     • Reuse the pages' existing CSS variables + card/grid classes so light &
       dark themes (var-flip via mfc-finish.css) are handled automatically.
     • Everything is wrapped in try/catch and degrades gracefully — if the
       universe can't be read, the description + facts + dividend still render.
     • Page-agnostic: reads the universe from whichever global is present
       (window.MFCScores on the scores page, window.MFCScreenerData on the
       scanner page).

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
  function crStr(cr) {
    cr = num(cr); if (cr == null) return "—";
    if (cr >= 100000) return "₹" + (cr / 100000).toFixed(2) + " L Cr";
    return "₹" + Math.round(cr).toLocaleString("en-IN") + " Cr";
  }
  function el(id) { return document.getElementById(id); }
  function quantile(sorted, q) {
    if (!sorted.length) return null;
    var pos = (sorted.length - 1) * q, base = Math.floor(pos), rest = pos - base;
    return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
  }

  // ── read the full universe from whichever data layer the page loaded ──────
  function universe() {
    try {
      if (window.MFCScores && typeof window.MFCScores.all === "function") {
        var a = window.MFCScores.all();
        if (a && a.length) return Promise.resolve(a);
        if (typeof window.MFCScores.load === "function")
          return Promise.resolve(window.MFCScores.load()).then(function () { return window.MFCScores.all() || []; });
      }
      if (window.MFCScreenerData && typeof window.MFCScreenerData.load === "function")
        return window.MFCScreenerData.load().then(function (b) { return (b && b.stocks) || []; });
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
    .mfx-own-seg{height:100%}
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
    .mfx-dot{position:absolute;top:50%;width:14px;height:14px;border-radius:50%;transform:translate(-50%,-50%);border:2px solid var(--ink2);box-shadow:0 1px 4px rgba(8,15,30,.3);z-index:2}
    .mfx-ctx-foot{display:flex;justify-content:space-between;font-size:10.5px;color:var(--text3);margin-top:6px;font-variant-numeric:tabular-nums}
    .mfx-legend{display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:var(--text3);margin-top:2px}
    .mfx-legend span{display:inline-flex;align-items:center;gap:6px}
    @media (prefers-reduced-motion: reduce){.mfx-table tbody tr{transition:none}}
    @media (max-width:640px){.mfx-strip .card-body{padding:15px 16px 16px}}
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
          (p > 0 ? '<div class="mfx-own-seg" style="width:' + p + "%;background:#1a50d8\"></div>" : "") +
          (i > 0 ? '<div class="mfx-own-seg" style="width:' + i + "%;background:#0891b2\"></div>" : "") +
          '<div class="mfx-own-seg" style="width:' + pub + '%;background:var(--ink3)"></div>' +
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
          '<div class="mfx-track"><div class="mfx-median" style="left:' + posOf(p50) + '%"></div><div class="mfx-dot" style="left:' + posOf(self) + "%;background:" + dotColor + '"></div></div>' +
          '<div class="mfx-ctx-foot"><span>' + m.fmt(p10) + "</span><span style='color:" + dotColor + ";font-weight:600'>" + verdict + "</span><span>" + m.fmt(p90) + "</span></div>" +
        "</div>"
      );
    });

    if (!out.length) { card.style.display = "none"; return; }
    title.textContent = "How " + (D.symbol || "it") + " compares within " + secClean;
    body.innerHTML = out.join("");
    card.style.display = "";
  }

  // ── entry point ───────────────────────────────────────────────────────────
  function render(D) {
    if (!D) return;
    try { injectStyle(); } catch (e) {}
    try { renderStrip(D); } catch (e) {}
    try { renderTabBase(D); } catch (e) {}
    universe().then(function (all) {
      all = all || [];
      try { fillCap(D, all); } catch (e) {}
      try { renderPeers(D, all); } catch (e) {}
      try { renderSectorContext(D, all); } catch (e) {}
    }).catch(function () {});
  }

  window.MFCCompany = { render: render };
})();

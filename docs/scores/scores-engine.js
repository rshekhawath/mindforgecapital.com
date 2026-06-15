/* ============================================================================
   MFC Stock Scores — factor scoring engine
   ----------------------------------------------------------------------------
   Powers the "Scores" tool (mindforgecapital.com/scores) — a StockXray-style
   scorecard that grades every NSE stock on two pillars:

       QUALITY  — how good, profitable and financially sound the business is
                  (returns, margins, balance-sheet health)
       VALUE    — how cheaply the stock is currently priced
                  (earnings/FCF yield, P/B, EV/EBITDA, Graham MoS, dividend)

   Each pillar is a 0–100 percentile score: a stock's factor value is ranked
   against the whole NSE universe, the ranks are averaged within the pillar,
   and Quality + Value are averaged into an Overall score. Percentile ranking
   is self-calibrating (immune to outliers, no hand-tuned thresholds) and
   recomputes automatically whenever the monthly stocks.json snapshot refreshes
   — so the data pipeline (server.py → export_static.py → stocks.json) needs no
   changes. Everything below runs fully client-side from that single bundle.

   Public API (window.MFCScores):
     load()        -> Promise<meta>   load + score the whole universe (memoised)
     all()         -> Array<stock>    every scored stock (with _q/_v/_overall…)
     bySym(sym)    -> stock | null
     meta          -> {count, generated_at, data_through, scored}
     grade(score)  -> {label, cls}    label + CSS tone class for a 0–100 score
     color(score)  -> "#rrggbb"       solid colour for a 0–100 score (bars)
     FACTORS       -> factor metadata (for the detail-page breakdown)
   ========================================================================== */
(function () {
  "use strict";

  // stocks.json lives with the screener; reuse it rather than shipping a 2nd
  // 6 MB copy. Relative to docs/scores/  ->  docs/screener/stocks.json
  var DATA_URL = "../screener/stocks.json";

  // ── Factor model ──────────────────────────────────────────────────────────
  // dir:   "high" = bigger is better · "low" = smaller is better
  // posOnly: a non-positive raw value is meaningless/bad → forced to worst (0)
  //          (e.g. a negative P/E means losses, not "cheap"; negative book
  //           value makes P/B nonsensical).
  // For VALUE, we deliberately use earnings_yield / fcf_yield (which already
  // express P/E and P/FCF as "higher = cheaper" and handle losses gracefully)
  // instead of the raw ratios, so the pillar isn't double-counting the same
  // signal.
  var QUALITY = [
    { key: "roe",              label: "Return on Equity",  dir: "high", unit: "%", d: 1 },
    { key: "roce",             label: "Return on Capital", dir: "high", unit: "%", d: 1 },
    { key: "roa",              label: "Return on Assets",  dir: "high", unit: "%", d: 1 },
    { key: "net_margin",       label: "Net Margin",        dir: "high", unit: "%", d: 1 },
    { key: "operating_margin", label: "Operating Margin",  dir: "high", unit: "%", d: 1 },
    { key: "interest_coverage",label: "Interest Coverage", dir: "high", unit: "x", d: 1 },
    { key: "current_ratio",    label: "Current Ratio",     dir: "high", unit: "x", d: 2 },
    { key: "debt_to_equity",   label: "Debt / Equity",     dir: "low",  unit: "",  d: 2, posBest: true },
  ];
  var VALUE = [
    { key: "earnings_yield",   label: "Earnings Yield",    dir: "high", unit: "%", d: 1, hint: "Inverse of P/E" },
    { key: "fcf_yield",        label: "Free-Cash-Flow Yield", dir: "high", unit: "%", d: 1 },
    { key: "pb_ratio",         label: "Price / Book",      dir: "low",  unit: "",  d: 2, posOnly: true },
    { key: "ev_ebitda",        label: "EV / EBITDA",       dir: "low",  unit: "x", d: 1, posOnly: true },
    { key: "graham_mos",       label: "Graham Margin of Safety", dir: "high", unit: "%", d: 0 },
    { key: "dividend_yield",   label: "Dividend Yield",    dir: "high", unit: "%", d: 2, zeroFill: true },
  ];
  // V12.1 — GROWTH pillar: a third complementary lens (how fast the business is
  // compounding) built from the revenue/earnings growth fields already in the
  // snapshot. Shown alongside Quality & Value; the headline Integrity Score stays
  // Quality × Value so existing rankings/scatter are unchanged.
  var GROWTH = [
    { key: "revenue_growth",    label: "Revenue Growth",   dir: "high", unit: "%", d: 1 },
    { key: "earnings_growth",   label: "Earnings Growth",  dir: "high", unit: "%", d: 1 },
    { key: "earnings_q_growth", label: "Quarterly Earnings Growth", dir: "high", unit: "%", d: 1, hint: "Latest quarter, YoY" },
  ];
  // V12.2 — MOMENTUM pillar: a fourth factor lens (is the stock in an uptrend)
  // built from price-trend fields already in the snapshot — distance above the
  // 50/200-day averages and proximity to the 52-week high. Computed factors use
  // a fn(); raw price/SMA ratios are expressed as "% above the average". Like
  // Growth, it sits ALONGSIDE the headline Integrity Score (Quality × Value),
  // which is unchanged — momentum is a trading lens, not a measure of integrity.
  var MOMENTUM = [
    { key: "_p2s200", label: "Price vs 200-DMA", dir: "high", unit: "%", d: 1, hint: "% above the 200-day average",
      fn: function (d) { return (isNum(d.current_price) && isNum(d.sma_200) && d.sma_200 > 0) ? (d.current_price / d.sma_200 - 1) * 100 : null; } },
    { key: "_p2s50",  label: "Price vs 50-DMA",  dir: "high", unit: "%", d: 1, hint: "% above the 50-day average",
      fn: function (d) { return (isNum(d.current_price) && isNum(d.sma_50) && d.sma_50 > 0) ? (d.current_price / d.sma_50 - 1) * 100 : null; } },
    { key: "52w_from_high_pct", label: "Proximity to 52W High", dir: "high", unit: "%", d: 1, hint: "Closer to 0 = nearer the year's high" },
  ];
  var FACTORS = { quality: QUALITY, value: VALUE, growth: GROWTH, momentum: MOMENTUM };

  // Minimum factors that must have data before we report a pillar score —
  // guards against grading a stock off one or two stray numbers.
  var MIN_Q = 4, MIN_V = 3, MIN_G = 2, MIN_M = 2;

  // ── State ─────────────────────────────────────────────────────────────────
  var BUNDLE = null, BY_SYM = Object.create(null), STOCKS = [];
  var loadPromise = null;
  var META = { count: 0, generated_at: "", data_through: "", scored: 0 };

  // ── Percentile machinery ──────────────────────────────────────────────────
  // For each factor we sort its non-null values once, then a midrank percentile
  // (countLess + ½·countEqual)/N is read off via binary search — O(N log N) to
  // build, O(log N) per lookup. Midrank shares credit fairly across ties.
  function lowerBound(arr, x) { // first index with arr[i] >= x
    var lo = 0, hi = arr.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; }
    return lo;
  }
  function upperBound(arr, x) { // first index with arr[i] > x
    var lo = 0, hi = arr.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; }
    return lo;
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }

  // Build sorted value pools for one factor across the universe.
  function buildPool(stocks, f) {
    var vals = [];
    for (var i = 0; i < stocks.length; i++) {
      var v = rawFor(stocks[i], f);
      if (v === null) continue;
      vals.push(v);
    }
    vals.sort(function (a, b) { return a - b; });
    return vals;
  }

  // Pull a factor's raw value from a stock, applying per-factor normalisation
  // (dividend_yield: missing means "pays nothing" → 0).
  function rawFor(d, f) {
    var v = f.fn ? f.fn(d) : d[f.key];   // computed factors (e.g. price vs SMA) supply a fn()
    if (!isNum(v)) return f.zeroFill ? 0 : null;
    return v;
  }

  // Score one raw value 0–100 given the factor's sorted pool.
  function scoreValue(v, f, pool) {
    if (v === null) return null;
    // posOnly / posBest guards: a non-positive value can't be "cheap"/"healthy".
    if ((f.posOnly && v <= 0) || (f.posBest && v < 0)) return 0;
    var N = pool.length;
    if (!N) return null;
    var lt = lowerBound(pool, v);              // # strictly less
    var le = upperBound(pool, v);              // # ≤
    var eq = le - lt;                          // # equal
    var pct = (lt + 0.5 * eq) / N * 100;       // midrank percentile (higher value → higher pct)
    return f.dir === "low" ? (100 - pct) : pct;
  }

  function mean(xs) {
    if (!xs.length) return null;
    var s = 0; for (var i = 0; i < xs.length; i++) s += xs[i];
    return s / xs.length;
  }

  // ── Grade / colour mapping (reuses the site's value-heatmap palette) ───────
  function grade(s) {
    if (s == null) return { label: "No score", cls: "na" };
    if (s >= 80) return { label: "Excellent", cls: "v-strong" };
    if (s >= 65) return { label: "Good",      cls: "v-good" };
    if (s >= 50) return { label: "Fair",      cls: "" };
    if (s >= 35) return { label: "Weak",      cls: "v-weak" };
    return { label: "Poor", cls: "v-bad" };
  }
  function color(s) {
    if (s == null) return "#94a3b8";
    if (s >= 80) return "#047857";
    if (s >= 65) return "#059669";
    if (s >= 50) return "#1a50d8";
    if (s >= 35) return "#b45309";
    return "#dc2626";
  }

  // ── Scoring pass over the whole universe ──────────────────────────────────
  function scoreAll(stocks) {
    var pools = {};
    QUALITY.concat(VALUE).concat(GROWTH).concat(MOMENTUM).forEach(function (f) { pools[f.key] = buildPool(stocks, f); });

    var scored = 0;
    for (var i = 0; i < stocks.length; i++) {
      var d = stocks[i];
      d._qf = breakdown(d, QUALITY, pools);
      d._vf = breakdown(d, VALUE, pools);
      d._gf = breakdown(d, GROWTH, pools);
      d._mf = breakdown(d, MOMENTUM, pools);
      var qScores = d._qf.filter(function (x) { return x.score != null; }).map(function (x) { return x.score; });
      var vScores = d._vf.filter(function (x) { return x.score != null; }).map(function (x) { return x.score; });
      var gScores = d._gf.filter(function (x) { return x.score != null; }).map(function (x) { return x.score; });
      var mScores = d._mf.filter(function (x) { return x.score != null; }).map(function (x) { return x.score; });
      d._q = qScores.length >= MIN_Q ? round1(mean(qScores)) : null;
      d._v = vScores.length >= MIN_V ? round1(mean(vScores)) : null;
      d._g = gScores.length >= MIN_G ? round1(mean(gScores)) : null;
      d._m = mScores.length >= MIN_M ? round1(mean(mScores)) : null;
      // Headline Integrity Score stays Quality × Value (Growth & Momentum are separate lenses).
      d._overall = (d._q != null && d._v != null) ? round1((d._q + d._v) / 2) : null;
      d._qn = qScores.length; d._vn = vScores.length; d._gn = gScores.length; d._mn = mScores.length;
      if (d._overall != null) scored++;
    }
    return scored;
  }

  function breakdown(d, list, pools) {
    return list.map(function (f) {
      var raw = rawFor(d, f);
      return {
        key: f.key, label: f.label, unit: f.unit, d: f.d, dir: f.dir, hint: f.hint || "",
        raw: raw,
        score: raw === null ? null : round1(scoreValue(raw, f, pools[f.key])),
      };
    });
  }

  function round1(v) { return v == null ? null : Math.round(v * 10) / 10; }

  // ── Load + memoise ────────────────────────────────────────────────────────
  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = fetch(DATA_URL, { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("stocks.json HTTP " + r.status); return r.json(); })
      .then(function (b) {
        var arr = Array.isArray(b) ? b : (b.stocks || []);
        // Drop error/empty rows up front so scoring pools stay clean.
        STOCKS = arr.filter(function (d) { return d && d.symbol && !d.error; });
        BUNDLE = Array.isArray(b) ? { stocks: STOCKS } : b;
        for (var i = 0; i < STOCKS.length; i++) BY_SYM[STOCKS[i].symbol] = STOCKS[i];
        var scored = scoreAll(STOCKS);
        META = {
          count: STOCKS.length,
          scored: scored,
          generated_at: (BUNDLE && BUNDLE.generated_at) || "",
          data_through: (BUNDLE && BUNDLE.data_through) || "",
        };
        MFCScores.meta = META;
        try { document.dispatchEvent(new CustomEvent("mfc:scores-ready", { detail: META })); } catch (e) {}
        return META;
      });
    return loadPromise;
  }

  // ── Public surface ────────────────────────────────────────────────────────
  var MFCScores = {
    load: load,
    all: function () { return STOCKS; },
    bySym: function (s) { return BY_SYM[String(s || "").toUpperCase()] || null; },
    meta: META,
    grade: grade,
    color: color,
    FACTORS: FACTORS,
  };
  window.MFCScores = MFCScores;

  // Perf: kick off the stocks.json fetch the moment this script parses (it's in
  // <head>), so the heavy ~6 MB bundle downloads in parallel with the rest of
  // the page render instead of waiting for the page's init script. load() is
  // memoised, so the page's own MFCScores.load() reuses this in-flight request.
  try { load(); } catch (e) {}
})();

/* ============================================================================
   MFC Screener — static data layer
   ----------------------------------------------------------------------------
   Overrides window.fetch to serve the screener's /api/* endpoints from a single
   bundled JSON snapshot (stocks.json) plus browser localStorage. This lets the
   screener run fully client-side on GitHub Pages — no Flask backend, no local
   PC required ("always live").

   Drop-in: the existing page scripts keep calling fetch(`${API}/screen?…`) etc.
   and receive the same response shapes the Flask server returned.
   ========================================================================== */
(function () {
  "use strict";

  // (Responsive nav handled in-page via the hamburger menu — matches the
  //  main mindforgecapital.com nav. No JS-injected nav CSS needed here.)

  var origFetch = window.fetch ? window.fetch.bind(window) : null;

  var BUNDLE = null;                 // {generated_at, data_through, count, sectors, stocks}
  var BY_SYM = Object.create(null);
  var bundlePromise = null;
  var DATA_URL = "stocks.json";      // relative to the screener pages

  function fmtDate(s) {
    try {
      return new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch (e) { return ""; }
  }

  function loadBundle() {
    if (bundlePromise) return bundlePromise;
    // "no-cache" = always revalidate with the CDN (cheap 304 when unchanged),
    // but always pick up a freshly-published snapshot. Avoids serving a stale
    // or partially-written bundle from a previous deploy.
    bundlePromise = origFetch(DATA_URL, { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("stocks.json HTTP " + r.status);
        return r.json();
      })
      .then(function (b) {
        var arr = Array.isArray(b) ? b : (b.stocks || []);
        BUNDLE = Array.isArray(b)
          ? { stocks: arr, count: arr.length, sectors: [], generated_at: "", data_through: "" }
          : b;
        BUNDLE.stocks = arr;
        for (var i = 0; i < arr.length; i++) {
          if (arr[i] && arr[i].symbol) BY_SYM[arr[i].symbol] = arr[i];
        }
        if (!BUNDLE.sectors || !BUNDLE.sectors.length) {
          var set = {};
          arr.forEach(function (d) { if (d.sector && d.sector !== "N/A") set[d.sector] = 1; });
          BUNDLE.sectors = Object.keys(set).sort();
        }
        window.__SCREENER_META__ = {
          count: BUNDLE.count || arr.length,
          generated_at: BUNDLE.generated_at || "",
          data_through: BUNDLE.data_through || ""
        };
        // Optional UI hook: pages with a #snapNote element get a snapshot stamp.
        try {
          var sn = document.getElementById("snapNote");
          if (sn) {
            var dt = BUNDLE.data_through || BUNDLE.generated_at;
            sn.textContent = dt
              ? ("Snapshot: " + fmtDate(dt) + " · refreshed daily")
              : "Refreshed monthly";
          }
        } catch (e) {}
        try { document.dispatchEvent(new CustomEvent("mfc:data-ready", { detail: window.__SCREENER_META__ })); } catch (e) {}
        return BUNDLE;
      });
    return bundlePromise;
  }

  window.MFCScreenerData = { load: loadBundle, bySym: function (s) { return BY_SYM[s]; } };

  // ---- helpers -------------------------------------------------------------
  function jsonResp(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  function numOrNull(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = Number(v); return isNaN(n) ? null : n;
  }
  function getURL(input) {
    var url = (typeof input === "string") ? input : (input && input.url) || "";
    try { return new URL(url, location.href); } catch (e) { return null; }
  }

  // ---- localStorage stores -------------------------------------------------
  var WL_KEY = "mfc_screener_watchlist";
  var PF_KEY = "mfc_screener_portfolio";
  function readStore(k) { try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch (e) { return []; } }
  function writeStore(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function newId(existing) {
    var max = 0;
    (existing || []).forEach(function (x) { if (x.id > max) max = x.id; });
    return max + 1;
  }

  // ---- /api/screen ---------------------------------------------------------
  function doScreen(params) {
    var f = {};
    ["min_pe","max_pe","min_pb","max_pb","min_ps","max_ps","min_roe","max_roe",
     "min_roa","min_roce","min_mcap","max_mcap","min_div","min_net_margin",
     "max_de","min_current_ratio","min_rev_growth","min_earn_growth",
     "max_ev_ebitda","min_fcf_yield","min_graham_mos",
     "min_opm","max_peg","min_promoter","min_int_cov",
     "min_gross_margin","min_ebitda_margin"].forEach(function (k) {
      f[k] = numOrNull(params.get(k));
    });
    var sector   = params.get("sector") || "";
    var aboveSma = params.get("above_sma200") || "";
    var limit    = params.get("limit"); limit = (limit === null) ? 500 : parseInt(limit, 10);
    var sortBy   = params.get("sort_by") || "market_cap_cr";
    var sortDir  = params.get("sort_dir") || "desc";

    function chk(d, key, mn, mx) {
      var v = d[key];
      if (mn !== null && (v === null || v === undefined || v < mn)) return false;
      if (mx !== null && (v === null || v === undefined || v > mx)) return false;
      return true;
    }

    var all = BUNDLE.stocks, out = [];
    for (var i = 0; i < all.length; i++) {
      var d = all[i];
      if (!d || d.error) continue;
      if (!chk(d, "pe_ratio",        f.min_pe,            f.max_pe)) continue;
      if (!chk(d, "pb_ratio",        f.min_pb,            f.max_pb)) continue;
      if (!chk(d, "ps_ratio",        f.min_ps,            f.max_ps)) continue;
      if (!chk(d, "roe",             f.min_roe,           f.max_roe)) continue;
      if (!chk(d, "roa",             f.min_roa,           null)) continue;
      if (!chk(d, "roce",            f.min_roce,          null)) continue;
      if (!chk(d, "market_cap_cr",   f.min_mcap,          f.max_mcap)) continue;
      if (!chk(d, "dividend_yield",  f.min_div,           null)) continue;
      if (!chk(d, "net_margin",      f.min_net_margin,    null)) continue;
      if (!chk(d, "debt_to_equity",  null,                f.max_de)) continue;
      if (!chk(d, "current_ratio",   f.min_current_ratio, null)) continue;
      if (!chk(d, "revenue_growth",  f.min_rev_growth,    null)) continue;
      if (!chk(d, "earnings_growth", f.min_earn_growth,   null)) continue;
      if (!chk(d, "ev_ebitda",       null,                f.max_ev_ebitda)) continue;
      if (!chk(d, "fcf_yield",       f.min_fcf_yield,     null)) continue;
      if (!chk(d, "graham_mos",      f.min_graham_mos,    null)) continue;
      if (!chk(d, "operating_margin",f.min_opm,           null)) continue;
      if (!chk(d, "peg_ratio",       null,                f.max_peg)) continue;
      if (!chk(d, "promoter_holding",f.min_promoter,      null)) continue;
      if (!chk(d, "interest_coverage",f.min_int_cov,      null)) continue;
      if (!chk(d, "gross_margin",    f.min_gross_margin,  null)) continue;
      if (!chk(d, "ebitda_margin",   f.min_ebitda_margin, null)) continue;
      if (aboveSma === "true" && !d.above_sma200) continue;
      if (sector && String(d.sector || "").toLowerCase() !== sector.toLowerCase()) continue;
      out.push(d);
    }
    out.sort(function (a, b) {
      var av = a[sortBy], bv = b[sortBy];
      av = (av === null || av === undefined) ? 0 : av;
      bv = (bv === null || bv === undefined) ? 0 : bv;
      return sortDir === "desc" ? (bv - av) : (av - bv);
    });
    var results = (limit > 0) ? out.slice(0, limit) : out;
    return { count: out.length, results: results, cached_total: all.length };
  }

  // ---- router --------------------------------------------------------------
  function handle(pathname, params, method, body) {
    var m = pathname.match(/\/api\/(.*)$/);
    if (!m) return null;
    var route = m[1];

    if (route === "health")
      return jsonResp({ status: "ok", static: true, universe: BUNDLE.count,
                        generated_at: BUNDLE.generated_at, data_through: BUNDLE.data_through });
    if (route === "sectors")  return jsonResp(BUNDLE.sectors);
    if (route === "universe")  return jsonResp(BUNDLE.stocks.map(function (d) { return d.symbol; }));
    if (route === "screen")    return jsonResp(doScreen(params));

    if (route === "search") {
      var q = (params.get("q") || "").toUpperCase().trim();
      if (q.length < 1) return jsonResp([]);
      var res = BUNDLE.stocks
        .filter(function (d) { return d.symbol.indexOf(q) !== -1; })
        .slice(0, 20)
        .map(function (d) { return { symbol: d.symbol, name: d.name || d.symbol, sector: d.sector || "", current_price: d.current_price }; });
      return jsonResp(res);
    }

    var cm = route.match(/^company\/(.+)$/);
    if (cm) {
      var sym = decodeURIComponent(cm[1]).toUpperCase();
      var d0 = BY_SYM[sym];
      if (!d0) return jsonResp({ error: "not found", symbol: sym }, 404);
      var copy = {};
      for (var k in d0) copy[k] = d0[k];
      copy.price_history = [];     // not bundled in the static snapshot
      copy.financials = {};        // not bundled in the static snapshot
      copy.static_snapshot = true;
      return jsonResp(copy);
    }

    if (route === "bulk-fetch")
      return jsonResp({ success: [], failed: [], total: 0, static: true });

    // ---- watchlist ----
    if (route === "watchlist" && method === "GET") {
      var wl = readStore(WL_KEY).map(function (it) {
        var s = BY_SYM[it.symbol] || {};
        return Object.assign({}, it, {
          name: it.name || s.name || it.symbol,
          current_price: s.current_price, day_change: s.day_change,
          sector: s.sector, market_cap: s.market_cap, market_cap_cr: s.market_cap_cr,
          pe_ratio: s.pe_ratio, roe: s.roe
        });
      });
      return jsonResp(wl);
    }
    if (route === "watchlist" && method === "POST") {
      var sym2 = (body.symbol || "").toUpperCase();
      if (!sym2) return jsonResp({ error: "symbol required" }, 400);
      var list = readStore(WL_KEY);
      if (list.some(function (x) { return x.symbol === sym2; }))
        return jsonResp({ error: "Already in watchlist" }, 409);
      var s2 = BY_SYM[sym2] || {};
      list.unshift({ id: newId(list), symbol: sym2, name: s2.name || sym2,
                     notes: body.notes || "", added_at: new Date().toISOString() });
      writeStore(WL_KEY, list);
      return jsonResp({ success: true, symbol: sym2, name: s2.name || sym2 });
    }
    var wdel = route.match(/^watchlist\/(\d+)$/);
    if (wdel && method === "DELETE") {
      var id = parseInt(wdel[1], 10);
      writeStore(WL_KEY, readStore(WL_KEY).filter(function (x) { return x.id !== id; }));
      return jsonResp({ success: true });
    }

    // ---- portfolio ----
    if (route === "portfolio" && method === "GET") {
      var pf = readStore(PF_KEY).map(function (it) {
        var s = BY_SYM[it.symbol] || {};
        var cp = s.current_price;
        var row = Object.assign({}, it, { current_price: cp, name: it.name || s.name || it.symbol });
        if (cp != null && it.buy_price) {
          row.pnl = (cp - it.buy_price) * it.quantity;
          row.pnl_pct = (cp - it.buy_price) / it.buy_price * 100;
          row.current_value = cp * it.quantity;
        }
        return row;
      });
      return jsonResp(pf);
    }
    if (route === "portfolio" && method === "POST") {
      var sym3 = (body.symbol || "").toUpperCase();
      if (!sym3 || !body.quantity || !body.buy_price)
        return jsonResp({ error: "symbol, quantity, buy_price required" }, 400);
      var plist = readStore(PF_KEY);
      var s3 = BY_SYM[sym3] || {};
      plist.unshift({ id: newId(plist), symbol: sym3, name: s3.name || sym3,
                      quantity: +body.quantity, buy_price: +body.buy_price,
                      buy_date: body.buy_date || "", notes: body.notes || "" });
      writeStore(PF_KEY, plist);
      return jsonResp({ success: true });
    }
    var pdel = route.match(/^portfolio\/(\d+)$/);
    if (pdel && method === "DELETE") {
      var id2 = parseInt(pdel[1], 10);
      writeStore(PF_KEY, readStore(PF_KEY).filter(function (x) { return x.id !== id2; }));
      return jsonResp({ success: true });
    }

    return jsonResp({ error: "unknown route", route: route }, 404);
  }

  // ---- fetch override ------------------------------------------------------
  window.fetch = function (input, init) {
    var u = getURL(input);
    if (!u || u.pathname.indexOf("/api/") === -1) {
      return origFetch ? origFetch(input, init) : Promise.reject(new Error("fetch unavailable"));
    }
    init = init || {};
    var method = (init.method || (typeof input !== "string" && input && input.method) || "GET").toUpperCase();
    var body = {};
    if (init.body) { try { body = JSON.parse(init.body); } catch (e) { body = {}; } }
    return loadBundle().then(function () {
      var resp = handle(u.pathname, u.searchParams, method, body);
      return resp || jsonResp({ error: "unhandled" }, 500);
    }).catch(function (e) {
      return jsonResp({ error: String((e && e.message) || e) }, 500);
    });
  };
})();

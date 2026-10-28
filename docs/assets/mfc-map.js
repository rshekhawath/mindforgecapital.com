/* MindForge Capital · /map/ "Map my holdings" (V43.3 — A3)
   ─────────────────────────────────────────────────────────────────────────────
   A DESCRIPTION of a pasted holdings list: how many lines, where the money sits,
   large/mid/small/micro, sectors, fund categories, and the tail of holdings too
   small to move the result. It gives no advice: no verdict, score, grade or
   "sell" anywhere in it.

   PRIVACY, the load-bearing half: what the reader pastes never leaves the tab.
   No fetch, beacon, URL or storage carries it. The only requests are the site's
   own public files (screener/stocks-lite.json, screener/closes-etf.json,
   learn/holdings-curve.json), fetched after "Map it", and mfc-track.js's
   anonymous tool_use event for the #runBtn click (page + button id only).

   THE PARSER IS A TWIN of dashboard.html's Match my holdings (normSym, num,
   csvSplit, findCol, parseHoldings, normName in <script id="mf-v375-adjust-js">),
   copied byte for byte so a broker file reads the same on both pages. If one
   changes, change the other and re-run the parity fixtures. */
(function () {
  'use strict';
  var D = document;

  /* ── twin of dashboard.html (mf-v375-adjust-js) ─────────────────────────── */
  function normSym(t){
    return String(t == null ? '' : t).trim().replace(/^["']|["']$/g,'').toUpperCase()
      .replace(/^(NSE|BSE|NSE_EQ|BSE_EQ)\s*[:|]\s*/,'')
      .replace(/\.(NS|BO|NSE|BSE)$/,'')
      .replace(/-(EQ|BE|BZ|SM|ST|BL|IL|GB|GS|N[0-9]|T[0-9])$/,'');
  }
  function num(v){ var n = Number(String(v == null ? '' : v).replace(/[,\s₹"]/g,'')); return isFinite(n) ? n : NaN; }
  function csvSplit(line, d){
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++){
      var ch = line[i];
      if (ch === '"'){ if (q && line[i+1] === '"'){ cur += '"'; i++; } else q = !q; }
      else if (ch === d && !q){ out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(function(x){ return x.trim(); });
  }
  function findCol(h, res){
    for (var r = 0; r < res.length; r++) for (var i = 0; i < h.length; i++) if (res[r].test(h[i])) return i;
    return -1;
  }
  function parseHoldings(text){
    var res = { rows:{}, px:{}, bad:[], count:0, table:false };
    var lines = String(text || '').replace(/^﻿/,'').replace(/\r/g,'').split('\n')
      .map(function(l){ return l.trim(); }).filter(function(l){ return l.length; });
    if (!lines.length) return res;
    var d = lines[0].indexOf('\t') > -1 ? '\t' : (lines[0].indexOf(',') > -1 ? ',' : (lines[0].indexOf(';') > -1 ? ';' : null));
    var symCol = -1, qtyCol = -1, ltpCol = -1, valCol = -1, start = 0;
    if (d){
      var h = csvSplit(lines[0], d).map(function(x){ return x.toLowerCase().replace(/\s+/g,' '); });
      symCol = findCol(h, [/^(symbol|instrument|tradingsymbol|trading symbol|ticker|scrip|scrip code|scrip name|stock symbol|nse symbol|security|security name|stock|stock name|company)$/]);
      qtyCol = findCol(h, [/^quantity available$/, /^(qty\.?|quantity|net qty\.?|total qty\.?|holding qty\.?|holdings|shares|units|available qty\.?|qty available|free qty\.?|balance qty\.?)$/]);
      ltpCol = findCol(h, [/^(ltp|last price|last traded price|current price|cmp|market price|close price|previous closing price)$/]);
      valCol = findCol(h, [/^(cur\.? val\.?|current value|present value|market value|value)$/]);
      if (symCol > -1 && qtyCol > -1){ res.table = true; start = 1; }
    }
    for (var i = start; i < lines.length; i++){
      var l = lines[i], sym = '', q = NaN, ltp = NaN;
      if (res.table){
        var c = csvSplit(l, d);
        sym = c[symCol]; q = num(c[qtyCol]);
        if (ltpCol > -1) ltp = num(c[ltpCol]);
        if (!(ltp > 0) && valCol > -1 && q > 0){ var val = num(c[valCol]); if (val > 0) ltp = val / q; }
      } else {
        var m = l.match(/^([A-Za-z][A-Za-z0-9&._:\-]*)[\s,;:=\t]+(?:x\s*|×\s*)?([0-9][0-9,]*(?:\.[0-9]+)?)\s*$/) ||
                l.match(/^([0-9][0-9,]*(?:\.[0-9]+)?)[\s,;:=\t]+(?:x\s*|×\s*)?([A-Za-z][A-Za-z0-9&._:\-]*)\s*$/);
        if (m){
          if (/^[0-9]/.test(m[1])){ q = num(m[1]); sym = m[2]; } else { sym = m[1]; q = num(m[2]); }
        }
      }
      var k = normSym(sym);
      if (!k || !(q > 0) || Math.abs(q - Math.round(q)) > 1e-6){
        if (!(res.table && /^(total|grand total)/i.test(l))) res.bad.push(l.slice(0, 60));
        continue;
      }
      res.rows[k] = (res.rows[k] || 0) + Math.round(q);
      if (ltp > 0) res.px[k] = ltp;
    }
    res.count = Object.keys(res.rows).length;
    return res;
  }
  function normName(n){
    return String(n == null ? '' : n).toLowerCase().replace(/&/g, ' and ')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\b(limited|ltd|pvt|private|company|co|corporation|corp|inc|the)\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  /* ── end of the twin ─────────────────────────────────────────────────────── */

  /* Funds: one per line, "name, value" (or "name value"); value may say L or Cr. */
  var UNIT = { l: 1e5, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, cr: 1e7, crore: 1e7, crores: 1e7, k: 1e3 };
  function parseFunds(text){
    var out = [], bad = [];
    String(text || '').replace(/^﻿/, '').replace(/\r/g, '').split('\n').forEach(function (raw) {
      var l = raw.trim();
      if (!l) return;
      if (/^(scheme|fund)( name)?\b.*\b(value|amount)\b/i.test(l)) return;          // a header row
      var m = l.match(/^(.*?)[,\t;|:]\s*(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(l|lakhs?|lacs?|cr|crores?|k)?\s*$/i) ||
              l.match(/^(.*?\S)\s+(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(l|lakhs?|lacs?|cr|crores?|k)?\s*$/i);
      var name = m ? m[1].replace(/[,\t;|:]+$/, '').trim() : l, val = NaN;
      if (m) { val = num(m[2]); if (m[3]) val *= UNIT[m[3].toLowerCase()] || 1; }
      if (!/[a-z]/i.test(name)) { bad.push(l.slice(0, 60)); return; }
      out.push({ name: name.slice(0, 90), value: val > 0 ? val : NaN });
    });
    return { funds: out, bad: bad };
  }
  /* The category a fund's NAME says it is in. Order matters: "banking & PSU debt"
     is debt before it is banking; "multi asset" before "multi cap". */
  var FCAT = [
    ['Gold & silver', /\b(gold|silver|precious)\b/],
    ['International', /\b(nasdaq|s&p|us |u\.s\.|international|global|overseas|world|china|japan|emerging market|feeder)\b/],
    ['Debt', /\b(liquid|overnight|money market|debt|bond|gilt|corporate|duration|credit|income|treasury|floater|floating|target maturity|g-?sec|savings fund)\b/],
    ['Multi asset', /\bmulti[ -]?asset\b/],
    ['Hybrid', /\b(balanced|hybrid|dynamic asset|aggressive|equity savings|arbitrage|retirement|children|asset allocat)\b/],
    ['ELSS (tax saver)', /\b(elss|tax ?saver|long term equity|tax advantage|tax plan)\b/],
    ['Index', /\b(index|nifty|sensex|etf|bees)\b/],
    ['Large & mid cap', /\blarge (and|&) ?mid ?cap\b|\blarge ?& ?mid\b/],
    ['Large cap', /\b(large ?cap|blue ?chip|top ?100|frontline)\b/],
    ['Mid cap', /\b(mid ?cap|emerging (equity|bluechip))\b/],
    ['Small cap', /\bsmall ?cap\b/],
    ['Flexi cap', /\bflexi ?-?cap\b/],
    ['Multi cap', /\bmulti ?cap\b/],
    ['Focused', /\bfocus(ed)?\b/],
    ['Value / contra', /\b(value|contra|dividend yield)\b/],
    ['Sector or theme', /\b(bank|banking|financial|pharma|health|technology|tech|digital|infra|infrastructure|consumption|fmcg|psu|manufactur|energy|thematic|sector|esg|mnc|innovation|business cycle|momentum|auto|transport|defen[cs]e|housing|commodit|quant|quality|low vol)\b/]
  ];
  function fundCat(name){
    var s = ' ' + String(name).toLowerCase().replace(/&/g, ' & ') + ' ';
    for (var i = 0; i < FCAT.length; i++) if (FCAT[i][1].test(s)) return FCAT[i][0];
    return 'Other';
  }
  /* ETFs a broker list carries beside shares, by symbol or name. */
  function etfKind(sym){
    var s = String(sym).toUpperCase();
    if (/GOLD/.test(s)) return 'Gold';
    if (/SILVER/.test(s)) return 'Silver';
    if (/LIQUID|EBBETF|BHARATBOND|GILT|BOND|LIQ|SDL|GSEC/.test(s)) return 'Debt';
    if (/MON100|MAFANG|NASDAQ|N100|HNGSNG|MAHKTECH|SPX|NASD|US|FANG|GLOBAL/.test(s)) return 'International';
    if (/BANK|PSU|^IT|ITBEES|PHARMA|CPSE|INFRA|AUTO|FMCG|CONSUM|HEALTH|ENERGY|REALTY/.test(s)) return 'Sector or theme';
    return 'Equity index';
  }
  function looksEtf(sym){ return /BEES$|ETF|IETF$|^MON100$|^MAFANG$|^MAHKTECH$|^HNGSNGBEES$/.test(String(sym).toUpperCase()); }

  /* ── formatting ─────────────────────────────────────────────────────────── */
  function rs(x){ return '₹' + Math.round(x).toLocaleString('en-IN'); }
  function pc(x, dp){ if (!isFinite(x)) return '—'; var f = Math.pow(10, dp == null ? 1 : dp); return (Math.round(x * f) / f).toFixed(dp == null ? 1 : dp) + '%'; }
  function esc(t){ return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function plural(n, one, many){ return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function day(iso){ var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? (+m[3]) + '&nbsp;' + MON[+m[2] - 1] + '&nbsp;' + m[1] : 'the last refresh'; }

  /* ── data (fetched once, only after "Map it") ───────────────────────────── */
  var DATA = null;
  function getJSON(u){ return fetch(u, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function load(){
    if (DATA) return Promise.resolve(DATA);
    return Promise.all([getJSON('/screener/stocks-lite.json'), getJSON('/screener/closes-etf.json'), getJSON('/learn/holdings-curve.json')]).then(function (v) {
      var lite = v[0], etf = v[1], curve = v[2];
      if (!lite || !lite.stocks) return null;
      var bySym = {}, byName = {}, ranked = [];
      lite.stocks.forEach(function (s) {
        bySym[normSym(s.symbol)] = s;
        var nn = normName(s.name); if (nn && !byName[nn]) byName[nn] = s;
        if (s.market_cap_cr > 0) ranked.push(s);
      });
      ranked.sort(function (a, b) { return b.market_cap_cr - a.market_cap_cr; });
      var rank = {}; ranked.forEach(function (s, i) { rank[s.symbol] = i + 1; });
      var etfPx = {};
      if (etf && etf.rows) Object.keys(etf.rows).forEach(function (k) {
        var r = etf.rows[k]; for (var i = r.length - 1; i >= 0; i--) if (r[i] > 0) { etfPx[k] = r[i]; break; }
      });
      DATA = { bySym: bySym, byName: byName, rank: rank, n: ranked.length, etfPx: etfPx, etfAsOf: etf && etf.as_of,
               asOf: String(lite.data_through || '').slice(0, 10), curve: curve };
      return DATA;
    });
  }
  function sizeOf(rank){ return !rank ? 'Unknown' : rank <= 100 ? 'Large' : rank <= 250 ? 'Mid' : rank <= 500 ? 'Small' : 'Micro'; }

  /* ── the map ────────────────────────────────────────────────────────────── */
  function build(stocksText, fundsText, data){
    var p = parseHoldings(stocksText), f = parseFunds(fundsText), lines = [], miss = [];
    Object.keys(p.rows).forEach(function (k) {
      var qty = p.rows[k], s = data.bySym[k] || data.byName[normName(k)], etf = !s && (looksEtf(k) || data.etfPx[k] > 0);
      if (s) {
        var px = p.px[k] > 0 ? p.px[k] : s.current_price, r = data.rank[s.symbol];
        lines.push({ type: 'stock', key: s.symbol, label: s.symbol, qty: qty, value: px > 0 ? qty * px : NaN, size: sizeOf(r), rank: r, sector: s.sector || 'Not classified' });
      } else if (etf) {
        var ep = p.px[k] > 0 ? p.px[k] : data.etfPx[k];
        lines.push({ type: 'etf', key: k, label: k, qty: qty, value: ep > 0 ? qty * ep : NaN, kind: etfKind(k) });
      } else miss.push(k);
    });
    f.funds.forEach(function (x) { lines.push({ type: 'fund', key: x.name, label: x.name, value: x.value, cat: fundCat(x.name) }); });
    var valued = lines.filter(function (l) { return l.value > 0; });
    var total = valued.reduce(function (a, l) { return a + l.value; }, 0);
    valued.sort(function (a, b) { return b.value - a.value; });
    return { lines: lines, valued: valued, total: total, miss: miss, bad: p.bad.concat(f.bad),
             stocks: lines.filter(function (l) { return l.type === 'stock'; }),
             etfs: lines.filter(function (l) { return l.type === 'etf'; }),
             funds: lines.filter(function (l) { return l.type === 'fund'; }) };
  }
  function group(items, keyOf){
    var g = {}, order = [];
    items.forEach(function (it) { var k = keyOf(it); if (!g[k]) { g[k] = { k: k, n: 0, v: 0 }; order.push(k); } g[k].n++; if (it.value > 0) g[k].v += it.value; });
    return order.map(function (k) { return g[k]; });
  }
  function bars(rows, total, cls){
    return '<div class="mp-bars ' + (cls || '') + '">' + rows.map(function (r) {
      var share = total > 0 ? r.v / total * 100 : 0;
      return '<div class="mp-bar"><span class="mp-bk">' + esc(r.k) + '<small>' + plural(r.n, r.unit || 'holding') + '</small></span>' +
        '<span class="mp-bt" aria-hidden="true"><i style="width:' + Math.max(0.6, Math.min(100, share)).toFixed(2) + '%"></i></span>' +
        '<span class="mp-bv">' + pc(share) + '<small>' + (r.v > 0 ? rs(r.v) : 'value not given') + '</small></span></div>';
    }).join('') + '</div>';
  }
  function curveAt(curve, n){
    var s = curve.sizes, v = curve.vol.p50;
    if (n <= s[0]) return v[0];
    for (var i = 1; i < s.length; i++) if (n <= s[i]) return v[i - 1] + (v[i] - v[i - 1]) * (n - s[i - 1]) / (s[i] - s[i - 1]);
    return v[v.length - 1];
  }

  function render(m, data){
    var h = [], N = m.lines.length, S = m.stocks.length, E = m.etfs.length, F = m.funds.length;
    var unvalued = m.lines.length - m.valued.length;
    h.push('<section class="dp-sec mp-res" aria-labelledby="mp-h1"><h2 id="mp-h1" tabindex="-1">What you own</h2>' +
      '<div class="dp-tiles dp-facts">' +
        '<div class="dp-tile"><span class="dp-tk">Lines</span><span class="dp-tv">' + N + '</span><span class="dp-tl">' +
          [plural(S, 'stock'), plural(E, 'ETF'), plural(F, 'fund')].join(' · ') + '</span></div>' +
        '<div class="dp-tile"><span class="dp-tk">Total value</span><span class="dp-tv">' + (m.total > 0 ? rs(m.total) : '—') + '</span><span class="dp-tl">' +
          (unvalued ? plural(unvalued, 'line') + ' without a value ' + (unvalued === 1 ? 'is' : 'are') + ' left out of the shares below' : 'every line valued') + '</span></div>' +
      '</div>' +
      (m.miss.length ? '<p class="mp-miss"><b>Not found (' + m.miss.length + '):</b> ' + m.miss.map(esc).join(', ') +
        '. They may be SME or unlisted shares, a fund pasted into the stocks box, or a mistyped symbol; they are left out.</p>' : '') +
      (m.bad.length ? '<p class="mp-miss"><b>Lines that could not be read (' + m.bad.length + '):</b> ' + m.bad.slice(0, 6).map(esc).join(' · ') + (m.bad.length > 6 ? ' …' : '') + '</p>' : '') +
      '</section>');

    if (m.valued.length >= 2 && m.total > 0) {
      var top = m.valued.slice(0, 10), topV = top.reduce(function (a, l) { return a + l.value; }, 0);
      var tail = m.valued.filter(function (l) { return l.value / m.total < 0.01; }), tailV = tail.reduce(function (a, l) { return a + l.value; }, 0);
      var biggest = m.valued[0];
      h.push('<section class="dp-sec mp-res" aria-labelledby="mp-h2"><h2 id="mp-h2">Where the money sits</h2><ul class="mp-facts">' +
        (m.valued.length > 10 ? '<li>Your 10 largest lines are <b>' + pc(topV / m.total * 100) + '</b> of the total; the other ' + (m.valued.length - 10) + ' share the rest.</li>' : '') +
        '<li>The largest single line, ' + esc(biggest.label) + ', is <b>' + pc(biggest.value / m.total * 100) + '</b>.</li>' +
        (tail.length ? '<li><b>' + plural(tail.length, 'line') + '</b> ' + (tail.length === 1 ? 'is' : 'are each') + ' under 1% of the total; together ' + (tail.length === 1 ? 'it is' : 'they are') + ' <b>' + pc(tailV / m.total * 100) + '</b>. A line at 1% that doubles adds 1% to the whole.</li>'
                     : '<li>No line is under 1% of the total.</li>') +
        '</ul>' +
        '<details class="dp-more"><summary>Every line, largest first</summary><table class="mp-tab"><thead><tr><th scope="col">Line</th><th scope="col">Kind</th><th scope="col">Value</th><th scope="col">Share</th></tr></thead><tbody>' +
          m.valued.map(function (l) {
            var kind = l.type === 'stock' ? l.size + ' cap' : l.type === 'etf' ? 'ETF · ' + l.kind : 'Fund · ' + l.cat;
            return '<tr' + (l.value / m.total < 0.01 ? ' class="is-tail"' : '') + '><td>' + esc(l.label) + '</td><td>' + esc(kind) + '</td><td class="num">' + rs(l.value) + '</td><td class="num">' + pc(l.value / m.total * 100) + '</td></tr>';
          }).join('') + '</tbody></table></details></section>');
    }

    if (S) {
      var sv = m.stocks.filter(function (l) { return l.value > 0; }), sT = sv.reduce(function (a, l) { return a + l.value; }, 0);
      var sizes = ['Large', 'Mid', 'Small', 'Micro'].map(function (k) {
        var it = m.stocks.filter(function (l) { return l.size === k; });
        return { k: k + ' cap', n: it.length, v: it.reduce(function (a, l) { return a + (l.value > 0 ? l.value : 0); }, 0), unit: 'stock' };
      }).filter(function (r) { return r.n; });
      var secs = group(m.stocks, function (l) { return l.sector; }).sort(function (a, b) { return b.v - a.v; });
      if (secs.length > 7) {
        var rest = secs.slice(6), other = { k: 'Other sectors', n: 0, v: 0 };
        rest.forEach(function (r) { other.n += r.n; other.v += r.v; });
        secs = secs.slice(0, 6).concat([other]);
      }
      secs.forEach(function (r) { r.unit = 'stock'; });
      var heavy = secs.filter(function (r) { return r.k !== 'Other sectors' && sT > 0 && r.v / sT > 0.25; });
      h.push('<section class="dp-sec mp-res" aria-labelledby="mp-h3"><h2 id="mp-h3">Your ' + plural(S, 'stock') + '</h2>' +
        '<h3>By size</h3>' + bars(sizes, sT, 'is-size') +
        '<p class="dp-note">Size by today&rsquo;s market value, ranked among the ' + data.n.toLocaleString('en-IN') + ' NSE companies this site follows: the 100 largest are large cap, the next 150 mid cap, the next 250 small cap, the rest micro cap (the same rank bands as the fund categories; AMFI&rsquo;s half-yearly list can differ at the edges).</p>' +
        '<h3>By sector</h3>' + bars(secs, sT, 'is-sector') +
        (heavy.length ? '<p class="mp-note">' + heavy.map(function (r) { return esc(r.k) + ' is ' + pc(r.v / sT * 100) + ' of your stock money'; }).join('; ') + '.</p>' : '') +
        '<p class="dp-note">Sector names from the data provider; NSE&rsquo;s industry names differ.</p></section>');
    }

    if (F || E) {
      var cats = group(m.funds, function (l) { return l.cat; }).sort(function (a, b) { return b.n - a.n || b.v - a.v; });
      var fT = m.funds.reduce(function (a, l) { return a + (l.value > 0 ? l.value : 0); }, 0);
      var same = cats.filter(function (r) { return r.n > 1 && r.k !== 'Other'; });
      var kinds = group(m.etfs, function (l) { return l.kind; }), eT = m.etfs.reduce(function (a, l) { return a + (l.value > 0 ? l.value : 0); }, 0);
      kinds.forEach(function (r) { r.unit = 'ETF'; });
      cats.forEach(function (r) { r.unit = 'fund'; });
      h.push('<section class="dp-sec mp-res" aria-labelledby="mp-h4"><h2 id="mp-h4">Your funds and ETFs</h2>' +
        (F ? '<h3>Funds, by the category in their name</h3>' + bars(cats, fT, 'is-fund') +
          (same.length ? '<p class="mp-note">' + same.map(function (r) { return r.n + ' funds in ' + esc(r.k); }).join('; ') +
            '. A fund&rsquo;s category fixes where most of its money must sit, so funds in one category often hold many of the same companies. <a href="/learn/how-many-holdings/#same-fund">Why</a></p>' : '') +
          '<p class="dp-note">The category is read from each fund&rsquo;s name; a fund whose name does not say it shows as Other. This map does not read the stocks inside your funds.</p>' : '') +
        (E ? '<h3>ETFs</h3>' + bars(kinds, eT, 'is-etf') : '') + '</section>');
    }

    var c = data.curve;
    if (S >= 2 && c && c.vol) {
      var v = curveAt(c, Math.min(S, 60)), v15 = curveAt(c, 15);
      h.push('<section class="dp-sec mp-res" aria-labelledby="mp-h5"><h2 id="mp-h5">Your stocks on the curve</h2>' +
        '<p>A typical portfolio of ' + (S > 60 ? '60 or more' : S) + ' large and mid-cap stocks swung about <b>' + pc(v) + '</b> a year over the last ' +
        c.window.years + ' years; 15 stocks, about ' + pc(v15) + '; one stock, about ' + pc(c.vol.p50[0]) + '. ' +
        'Your own stocks may not be large or mid caps, and your weights are not equal, so read this as a guide, not a measurement. ' +
        '<a href="/learn/how-many-holdings/">How many holdings is enough?</a></p></section>');
    }

    h.push('<section class="dp-sec mp-res" aria-labelledby="mp-h6"><h2 id="mp-h6">What this map does not show</h2><ul>' +
      '<li>The stocks inside your funds, and how much your funds overlap.</li>' +
      '<li>Your returns, your tax, or when you bought anything.</li>' +
      '<li>Whether any of it suits you. That is your decision, and a qualified adviser&rsquo;s.</li></ul>' +
      '<p class="dp-note">A description of the list you pasted and general information, not advice on what to hold, buy or sell. Prices: NSE closes to ' + day(data.asOf) +
      (E ? '; ETFs to ' + day(data.etfAsOf) : '') + ', where your paste had no price.</p></section>');
    return h.join('');
  }

  /* ── wiring ─────────────────────────────────────────────────────────────── */
  var SAMPLE_STOCKS = [
    'Instrument,Qty.', 'HDFCBANK,120', 'ICICIBANK,60', 'SBIN,50', 'AXISBANK,30', 'KOTAKBANK,40', 'BAJFINANCE,25', 'INFY,80', 'TCS,25',
    'WIPRO,150', 'HCLTECH,40', 'TECHM,30', 'RELIANCE,40', 'ITC,200', 'HINDUNILVR,10', 'ASIANPAINT,12', 'MARUTI,3', 'TMPV,40', 'TATASTEEL,100',
    'ADANIENT,8', 'ETERNAL,200', 'PAYTM,20', 'IRCTC,25', 'IRFC,300', 'YESBANK,1000', 'SUZLON,500', 'IDEA,2000', 'NHPC,150', 'BEL,100',
    'HAL,6', 'DIXON,2', 'POLYCAB,4', 'NBCC,150', 'PVRINOX,10', 'IEX,100', 'TRIDENT,300', 'NIFTYBEES,200', 'GOLDBEES,300', 'MON100,100'
  ].join('\n');
  var SAMPLE_FUNDS = [
    'Parag Parikh Flexi Cap Fund, 4,20,000', 'HDFC Flexi Cap Fund, 2,10,000', 'Kotak Flexicap Fund, 1,40,000',
    'Mirae Asset Large Cap Fund, 1,60,000', 'SBI Bluechip Fund, 90,000', 'Nippon India Small Cap Fund, 2,40,000',
    'Quant Small Cap Fund, 1,10,000', 'Axis ELSS Tax Saver Fund, 1,50,000', 'ICICI Prudential Technology Fund, 70,000'
  ].join('\n');

  function init(){
    var st = D.getElementById('mp-stocks'), fu = D.getElementById('mp-funds'), go = D.getElementById('runBtn');
    var out = D.getElementById('mp-out'), msg = D.getElementById('mp-msg'), file = D.getElementById('mp-file');
    var sample = D.getElementById('mp-sample'), clear = D.getElementById('mp-clear'), sampleNote = D.getElementById('mp-sample-note');
    if (!st || !fu || !go || !out) return;
    function say(t){ if (msg) msg.textContent = t || ''; }
    function run(){
      if (!st.value.trim() && !fu.value.trim()) { say('Paste your holdings, or a list of funds, first.'); st.focus(); return; }
      say('Loading the company list this map reads…');
      go.disabled = true;
      load().then(function (data) {
        go.disabled = false;
        if (!data) { say('The company list did not load. Check your connection and try again; nothing you pasted was sent anywhere.'); return; }
        var m = build(st.value, fu.value, data);
        if (!m.lines.length) { say('Nothing in the boxes could be read as a holding. A symbol and a quantity per line is enough, e.g. HDFCBANK 120.'); out.innerHTML = ''; return; }
        say('');
        out.innerHTML = render(m, data);
        out.hidden = false;
        var h1 = D.getElementById('mp-h1');
        if (h1) { try { h1.focus({ preventScroll: true }); } catch (e) {} h1.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      });
    }
    go.addEventListener('click', run);
    if (file) file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      if (f.size > 2e6) { say('That file is larger than 2 MB; paste the holdings instead.'); return; }
      var r = new FileReader();
      r.onload = function () { st.value = String(r.result || ''); say('Read ' + f.name + ' on this device. Press Map it.'); };
      r.readAsText(f);
      file.value = '';
    });
    if (sample) sample.addEventListener('click', function () {
      st.value = SAMPLE_STOCKS; fu.value = SAMPLE_FUNDS;
      if (sampleNote) sampleNote.hidden = false;
      run();
    });
    if (clear) clear.addEventListener('click', function () {
      st.value = ''; fu.value = ''; out.innerHTML = ''; out.hidden = true; say('');
      if (sampleNote) sampleNote.hidden = true;
      st.focus();
    });
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', init); else init();

  // for the parity fixtures (QA only; nothing on the page reads these)
  window.MFMap = { parseHoldings: parseHoldings, normSym: normSym, normName: normName, parseFunds: parseFunds, fundCat: fundCat, etfKind: etfKind, build: build };
})();

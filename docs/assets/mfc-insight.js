/* MindForge dashboard — insight layer (V42.3)
   ===========================================
   A member can already see WHAT happened in their broker (holdings, P&L, XIRR,
   top contributors). This layer answers what the broker cannot:
     · WHY the book moved, measured against its own index;
     · whether this month is NORMAL for this book;
     · how closely the member's own book FOLLOWS the model.
   Plan: markdowns/dashboard_updates.md (M1–M13). V42.5 adds M12's "what happened
   today" card; the weekly e-mail half of M12 is a backend job, not this file.

   HOW IT FITS THE PAGE
   · Two modes. "This month's orders" holds the order machinery; "How it's going"
     holds the explanations. The page tags its existing cards with data-mfm and a
     CSS rule hides the other mode's cards: no card is moved, rebuilt or renamed.
   · It reads the dashboard's own state (stocksData, currentStrategy, _livePx,
     _atState, _benchLive, cycleOrders, loadBought, _mfData…) and never writes it.
     The dashboard calls window.mfcInsight.refresh(stage) at its existing render
     points; this file also renders once on its own load, so script order cannot
     strand a card.
   · Public data only, all aggregate or market data: docs/screener/market.json,
     bench-attr.json, signals.json, closes-{lm,sm,etf}.json, backtest-months.json
     and live-history.json, written by screener/market_data.py and live_perf.py.
     Per-pick data stays where it already is: the token API.

   HONESTY CONDITIONS — the half of each module that keeps it from being a sales
   device:
   · every figure names its basis (live / backtest / your own entered prices) and
     its window; an approximation says it is one;
   · explanations describe conditions and published research — no forecast, and
     no "hold", "buy", "sell" or "stay the course" (the V39.1 rule);
   · fewer than six closed cycles says "too early to judge" instead of a ratio;
   · a module whose inputs are missing renders nothing — never a zero, never a
     placeholder that looks like a number (the V36.6 zero-then-observe lesson). */
(function () {
  'use strict';
  var W = window, D = document;
  if (!D.getElementById('state-dashboard')) return;

  // ── dashboard state, read defensively (its let/const bindings are globals) ──
  function st() {
    var o = { stocks: [], strategy: '', capital: 0, demo: false, sub: W._currentSub || {} };
    try { o.stocks = stocksData || []; } catch (e) {}
    try { o.strategy = String(currentStrategy || '').replace(/ /g, ' '); } catch (e) {}
    try { o.capital = Number(currentCapital) || 0; } catch (e) {}
    try { o.demo = !!isDemo; } catch (e) { o.demo = /[?&]demo=/.test(location.search); }
    try { o.demoMode = demoMode; } catch (e) {}
    var s = o.strategy || String(o.sub.strategy || '');
    o.key = /multiasset/i.test(s) ? 'ma' : /largemidcap/i.test(s) ? 'lm' : /smallmicro/i.test(s) ? 'sm' : null;
    o.book = o.key === 'ma' ? 'MultiAsset' : o.key === 'lm' ? 'LargeMidcap 250' : o.key === 'sm' ? 'SmallMicro 500' : 'this';
    o.rebal = W._rebalDate || (typeof W.parseRebalanceDate === 'function' ? W.parseRebalanceDate(o.sub) : null);
    o.rebalIso = o.rebal && !isNaN(o.rebal.getTime()) ? iso(o.rebal) : null;
    o.capEntered = !!W._capEntered;
    return o;
  }
  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dt(isoStr) { var d = new Date(String(isoStr).slice(0, 10) + 'T00:00:00'); return isNaN(d.getTime()) ? null : d; }
  function dshort(d) {
    if (!d) return '';
    try { return W.mfDate(d, { day: 'numeric', month: 'short' }); } catch (e) {}
    return d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  }
  function dlong(d) {
    if (!d) return '';
    try { return W.mfDate(d, { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) {}
    return dshort(d) + ' ' + d.getFullYear();
  }
  function esc(s) {
    s = String(s == null ? '' : s);
    if (typeof W.escapeHtml === 'function') { try { return W.escapeHtml(s); } catch (e) {} }
    return s.replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function inr(v) {
    v = Math.round(Number(v) || 0);
    try { return W.fmtMoney(v); } catch (e) {}
    return '₹' + v.toLocaleString('en-IN');
  }
  function num(v) { v = Number(v); return isFinite(v) ? v : null; }
  function sgn(v, dp, unit) {
    if (v == null || !isFinite(v)) return '—';
    dp = dp == null ? 2 : dp; unit = unit == null ? '%' : unit;
    var s = Math.abs(v).toFixed(dp);
    if (Number(s) === 0) return (0).toFixed(dp) + unit;
    return (v > 0 ? '+' : '−') + s + unit;
  }
  function pts(v, dp) { return sgn(v, dp == null ? 2 : dp, ' pts'); }
  function tone(v) { return v > 0.05 ? 'mi-up' : (v < -0.05 ? 'mi-down' : 'mi-flat'); }
  function span(v, txt) { return '<span class="' + tone(v) + '">' + txt + '</span>'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function quant(sorted, q) {
    if (!sorted.length) return null;
    var p = (sorted.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo);
  }
  function learn(lines) {
    return '<details class="mi-learn"><summary>How to read this</summary>' +
      lines.map(function (l) { return '<p>' + l + '</p>'; }).join('') + '</details>';
  }

  // ── data: memoised promises (memoise the promise, never a flag — V37.6) ──
  var memo = {};
  function getJSON(path) {
    if (!memo[path]) {
      memo[path] = fetch(path, { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return memo[path];
  }
  function closesFor(key) { return getJSON('screener/closes-' + (key === 'ma' ? 'etf' : key) + '.json'); }

  // the book at live prices — the same arithmetic as the profit headline
  function liveBook(s) {
    var px = W._livePx || {}, rows = [], wSum = 0, wRet = 0;
    (s.stocks || []).forEach(function (x) {
      var rec = Number(x.recommended_price) || 0, p = px[x.yahoo_ticker];
      if (!rec || !p || !(Number(p.price) > 0)) return;
      var r = (Number(p.price) - rec) / rec * 100, w = Number(x.weight_pct) || 0;
      if (!(w > 0)) return;
      wSum += w; wRet += w * r;
      rows.push({ t: String(x.ticker), n: x.company_name || x.ticker, ind: x.industry || '', w: w, r: r, rec: rec, live: Number(p.price) });
    });
    if (rows.length < 2 || !(wSum > 0)) return null;
    rows.forEach(function (x) { x.wn = x.w / wSum; x.c = x.w * x.r / wSum; });
    return { rows: rows, port: wRet / wSum, n: rows.length, total: (s.stocks || []).length };
  }

  // the live benchmark, on the same window as the book, or nothing (V27.9 guard)
  var benchP = null, benchFor = '';
  function benchLive(s) {
    var k = (s.key || '') + '|' + (s.rebalIso || '');
    if (benchP && benchFor === k) return benchP;
    benchFor = k;
    if (typeof W.loadBenchPerf !== 'function' || !s.key) return (benchP = Promise.resolve(null));
    benchP = W.loadBenchPerf().then(function (d) {
      if (!d || !d.strategies || !d.strategies[s.key]) return null;
      var b = d.strategies[s.key];
      if (!d.rebalance_date || d.rebalance_date !== s.rebalIso) return null;
      var tail = function (live) {
        if (live != null && isFinite(live)) return { bench: Number(live), name: b.bench_name, legs: b.bench_legs || [], live: true };
        if (b.bench_pct != null) return { bench: Number(b.bench_pct), model: Number(b.live_pct), name: b.bench_name, legs: b.bench_legs || [], live: false, asOf: d.data_through };
        return null;
      };
      return (typeof W._benchLive === 'function' ? W._benchLive(s.key, b) : Promise.resolve(null)).then(tail, function () { return tail(null); });
    }).catch(function () { return null; });
    return benchP;
  }

  // ── placing cards ───────────────────────────────────────────────────────
  function card(id, mode, cls) {
    var el = D.getElementById(id);
    if (!el) {
      el = D.createElement('section');
      el.id = id;
      el.className = 'mi-card' + (cls ? ' ' + cls : '');
      el.setAttribute('data-mfm', mode || 'insight');
      el.hidden = true;
    }
    return el;
  }
  function after(el, ref) { if (ref && ref.parentNode && el.previousElementSibling !== ref) ref.parentNode.insertBefore(el, ref.nextSibling); }
  function before(el, ref) { if (ref && ref.parentNode && el.nextElementSibling !== ref) ref.parentNode.insertBefore(el, ref); }
  function show(el, html) { el.innerHTML = html; el.hidden = false; }
  function hide(id) { var el = D.getElementById(id); if (el) { el.hidden = true; el.innerHTML = ''; } }

  // ── the two modes ───────────────────────────────────────────────────────
  var ORDERS = ['#chg-card', '#size-card', '.table-section > .table-header', '#sector-chips', '#buy-prog-card', '#sess',
    '.table-section > .table-wrap', '#stock-cards-mobile', '#weightCap', '.table-section > .howto-card',
    '#adj-card', '#cs-card', '#track-more'];
  var INSIGHT = ['#profit-card', '#attrib-card', '#mypos-card', '#trk-card', '#why25', '#alloc-card', '#pmap-card'];
  function pendingOrders() {
    try {
      var o = W.cycleOrders(), placed = W.loadBought(currentStrategy) || {};
      return o.all.filter(function (x) { return !placed[W.orderKey(x)]; }).length;
    } catch (e) { return 0; }
  }
  function modeKey(s) { return 'mfc_dmode::' + (s.key || 'x') + '::' + (s.rebalIso || 'na'); }
  function defaultMode(s) {
    var h = (location.hash || '').toLowerCase();
    if (h === '#orders' || h === '#insight') return h.slice(1);
    try { var m = localStorage.getItem(modeKey(s)); if (m === 'orders' || m === 'insight') return m; } catch (e) {}
    if (s.demo) return 'orders';
    if (!pendingOrders()) return 'insight';
    var now = Date.now();
    var dReb = s.rebal ? (now - s.rebal.getTime()) / 864e5 : 99;
    var subAt = s.sub && s.sub.subscribed_at ? new Date(s.sub.subscribed_at).getTime() : NaN;
    var dSub = isFinite(subAt) ? (now - subAt) / 864e5 : 99;
    return (dReb <= 7 || dSub <= 7) ? 'orders' : 'insight';
  }
  var modeSet = false;
  function tagCards() {
    ORDERS.forEach(function (q) { D.querySelectorAll(q).forEach(function (el) { el.setAttribute('data-mfm', 'orders'); }); });
    INSIGHT.forEach(function (q) { D.querySelectorAll(q).forEach(function (el) { el.setAttribute('data-mfm', 'insight'); }); });
  }
  function setMode(m, s, remember) {
    D.documentElement.setAttribute('data-dmode', m);
    var bar = D.getElementById('mi-modes');
    if (bar) bar.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-m') === m)); });
    if (remember) { try { localStorage.setItem(modeKey(s), m); } catch (e) {} }
    if (m === 'insight') renderInsight();
    try { W.dispatchEvent(new Event('resize')); } catch (e) {}
    if (remember) { try { if (typeof W.mfcTrack === 'function') W.mfcTrack('insight_mode', m); } catch (e) {} }
  }
  function renderModes(s) {
    var hero = D.querySelector('#state-dashboard .dash-hero');
    var bar = D.getElementById('mi-modes');
    if (!bar) {
      bar = D.createElement('div');
      bar.id = 'mi-modes';
      bar.className = 'mi-modes';
      bar.setAttribute('role', 'group');
      bar.setAttribute('aria-label', 'Dashboard view');
      bar.innerHTML = '<button type="button" data-m="orders" aria-pressed="false"><span class="mi-long">This month’s orders</span><span class="mi-short" aria-hidden="true">Orders</span> <span class="mi-cnt" id="mi-cnt" hidden></span></button>' +
                      '<button type="button" data-m="insight" aria-pressed="false">How it’s going</button>';
      bar.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('button[data-m]');
        if (!b) return;
        setMode(b.getAttribute('data-m'), st(), true);
      });
      if (hero) after(bar, hero);
      else { var root = D.getElementById('state-dashboard'); if (root) root.insertBefore(bar, root.firstChild); }
    }
    var n = pendingOrders(), cnt = D.getElementById('mi-cnt');
    if (cnt) { cnt.hidden = !n; cnt.textContent = n ? String(n) : ''; cnt.setAttribute('aria-label', n + ' left'); }
    if (!modeSet) { modeSet = true; setMode(defaultMode(s), s, false); }
  }

  // ── M1 · the month in one paragraph ───────────────────────────────────────
  var REGIME_SHORT = {
    'rising-calm': 'steady and rising',
    'rising-nervous': 'rising, with bigger daily swings than usual',
    'falling': 'falling',
    'rebound': 'rebounding sharply after a fall',
    'steadying': 'below its long-run average but no longer falling'
  };
  var REGIME_LONG = {
    'rising-calm': 'Steady, rising markets are the conditions in which books that rank stocks on their recent trends have historically done best: leadership tends to persist from one month to the next.',
    'rising-nervous': 'Trends are still up, but daily swings are larger than usual and leadership can rotate quickly, so more names tend to change at the next rebalance.',
    'falling': 'In a falling market most stocks fall together, and a book of recent leaders usually falls too. The useful number is the gap to the index, not the sign of the return.',
    'rebound': 'Sharp rebounds after a fall are the months in which books that rank on recent trends have historically lagged most: the previous quarter’s laggards often lead the bounce (Daniel & Moskowitz, “Momentum Crashes”, 2016).',
    'steadying': 'With the index below its long-run average but no longer falling, leadership is unsettled: trends are shorter and less reliable than in a steady rise.'
  };

  function renderNarrative(s, lb, bench, mk) {
    var el = card('mi-narr', 'insight', 'mi-narr');
    var anchor = D.getElementById('profit-card');
    before(el, anchor);
    if (s.demo) {
      show(el, '<div class="mi-head"><h2>Your month in one paragraph<span class="mi-badge">Sample</span></h2></div>' +
        '<p class="mi-p">On a member’s dashboard this paragraph is written from the book’s own numbers each time the page loads: how far the book is up or down since the rebalance, how that compares with its index, which holdings did most of the work, and what kind of market it has been. Every clause links to the card below that proves it.</p>' +
        '<p class="mi-p">It never forecasts and never tells a member to buy, sell or hold anything; the only orders on this page are the model’s published ones.</p>');
      return;
    }
    if (!lb) { hide('mi-narr'); return; }
    var port = lb.port, parts = [];
    var dir = port > 0.05 ? 'up' : port < -0.05 ? 'down' : 'flat';
    var since = s.rebal ? ' since the ' + esc(dshort(s.rebal)) + ' rebalance' : ' since the rebalance';
    var head = 'Your ' + esc(s.book) + ' book is ' + (dir === 'flat' ? 'flat' : dir + ' ' + span(port, Math.abs(port).toFixed(2) + '%')) + since;
    if (bench && bench.live) {
      var gap = port - bench.bench;
      var g = Math.abs(gap) <= 0.05 ? 'level with it' : (span(gap, Math.abs(gap).toFixed(2) + ' points') + (gap > 0 ? ' ahead' : ' behind'));
      head += '; its index, the ' + esc(bench.name) + ', is ' + span(bench.bench, sgn(bench.bench)) + ' — ' + g + '.';
    } else head += '.';
    parts.push(head);

    // drivers: the names that did most of the work, from the same contributions as the attribution card.
    // Both halves are printed: three names can add more than the whole gain (2.77 pts in a book up 1.88%),
    // and that only reconciles once the other side's part is on the page too.
    var rows = lb.rows.slice().sort(function (a, b) { return b.c - a.c; });
    var who = function (list) {
      var n = list.map(function (x) { return '<b>' + esc(x.t) + '</b>'; });
      return n.length > 1 ? n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1] : n[0];
    };
    var sumC = function (sign) { return rows.reduce(function (a, x) { return a + (x.c * sign > 0 ? x.c : 0); }, 0); };
    if (port > 0.05) {
      var lift = rows.filter(function (x) { return x.c > 0; });
      var tot = sumC(1), fell = sumC(-1), acc = 0, top = [];
      for (var i = 0; i < lift.length && top.length < 3; i++) { top.push(lift[i]); acc += lift[i].c; if (acc >= tot * 0.6) break; }
      if (top.length && tot > 0.0001) {
        parts.push(who(top) + ' did most of the lifting: <a href="#attrib-card">' + acc.toFixed(2) + '</a> of the ' + tot.toFixed(2) +
          ' pts the rising holdings added' + (fell < -0.005 ? ' (the ones that fell took ' + Math.abs(fell).toFixed(2) + ' pts away)' : '') + '.');
      }
    } else if (port < -0.05) {
      var drag = rows.filter(function (x) { return x.c < 0; }).reverse();
      var totd = sumC(-1), rose = sumC(1), accd = 0, topd = [];
      for (var j = 0; j < drag.length && topd.length < 3; j++) { topd.push(drag[j]); accd += drag[j].c; if (accd <= totd * 0.6) break; }
      if (topd.length && totd < -0.0001) {
        parts.push(who(topd) + ' did most of the damage: <a href="#attrib-card">' + Math.abs(accd).toFixed(2) + '</a> of the ' + Math.abs(totd).toFixed(2) +
          ' pts the falling holdings took away' + (rose > 0.005 ? ' (the ones that rose added ' + rose.toFixed(2) + ' pts back)' : '') + '.');
      }
    }

    // the market it happened in
    if (mk && mk.regime && REGIME_SHORT[mk.regime.key]) {
      var bits = 'The market has been ' + REGIME_SHORT[mk.regime.key];
      if (mk.size && mk.size.cyc != null && Math.abs(mk.size.cyc) >= 1) bits += ', with small caps ' + (mk.size.cyc > 0 ? 'ahead of' : 'behind') + ' large caps by ' + Math.abs(mk.size.cyc).toFixed(1) + ' points since the rebalance';
      var mom = (mk.styles || []).filter(function (x) { return x.key === 'momentum'; })[0];
      if (mom && mom.cyc != null && (s.key === 'lm' || s.key === 'sm')) bits += ', and the momentum index ' + (mom.cyc >= 0 ? 'up ' : 'down ') + Math.abs(mom.cyc).toFixed(1) + '%';
      bits += ' (<a href="#mi-weather">market weather</a>).';
      parts.push(bits);
    }

    // is it normal (equity books with a published monthly calendar)
    var nrm = W.__miNormal;
    if (nrm && nrm.n && Math.abs(port) >= 1.5) {
      parts.push(port < 0
        ? 'In the backtest, ' + nrm.below + ' of ' + nrm.n + ' months ended lower than this (<a href="#mi-normal">is this normal?</a>).'
        : 'In the backtest, ' + nrm.above + ' of ' + nrm.n + ' months ended higher than this (<a href="#mi-normal">is this normal?</a>).');
    }

    // what happens next — a process fact, never advice
    var left = pendingOrders();
    var next = new Date(); next = new Date(next.getFullYear(), next.getMonth() + 1, 1);
    parts.push(left ? 'You still have ' + plural(left, 'order') + ' to place this cycle.' : 'The next list lands on ' + esc(dshort(next)) + '.');

    show(el, '<div class="mi-head"><h2>Your month in one paragraph</h2><span class="mi-sub">Live prices</span></div>' +
      '<p class="mi-p">' + parts.join(' ') + '</p>' +
      learn(['Written by the page from its own numbers each time it loads: the weighted move of the book’s holdings since the rebalance (model weights, published prices), the same index the profit card uses, and the contributions in “What moved your number”. Nothing in it is typed by hand, and it never says what to do beyond the model’s published orders.']));
  }

  // ── M6 · is this normal? ─────────────────────────────────────────────────
  function renderNormal(s, lb, bm, hist) {
    var el = card('mi-normal', 'insight');
    var anchor = D.getElementById('profit-card');
    after(el, anchor);
    var bookM = bm && bm.books && bm.books[s.key];
    var months = bookM ? bookM.months.map(function (m) { return m[1]; }).sort(function (a, b) { return a - b; }) : [];
    var neg = parseInt(W._mfData ? W._mfData(s.key + ':neg') : '', 10), tot = parseInt(W._mfData ? W._mfData(s.key + ':months') : '', 10);
    var worstTxt = W._mfData ? W._mfData(s.key + ':worst') : '';
    if (!months.length && !(neg >= 0 && tot > 0)) { hide('mi-normal'); W.__miNormal = null; return; }
    var port = (!s.demo && lb) ? lb.port : null;
    var html = '<div class="mi-head"><h2>Is this normal?' + (s.demo ? '<span class="mi-badge">Sample</span>' : '') + '</h2><span class="mi-sub">Backtest, before tax</span></div>';
    if (months.length >= 12) {
      var p10 = quant(months, 0.1), p50 = quant(months, 0.5), p90 = quant(months, 0.9), lo = months[0], hi = months[months.length - 1];
      var worstM = bookM.months.filter(function (m) { return m[1] === lo; })[0];
      var x0 = Math.min(lo, port != null ? port : lo), x1 = Math.max(hi, port != null ? port : hi), span_ = (x1 - x0) || 1;
      var pos = function (v) { return ((v - x0) / span_ * 100).toFixed(2) + '%'; };
      var below = months.filter(function (v) { return port != null && v < port; }).length;
      var above = months.filter(function (v) { return port != null && v > port; }).length;
      W.__miNormal = { n: months.length, below: below, above: above };
      // calendar days, midnight to midnight: a rounded elapsed time read 21 after noon on a 20-day cycle
      var dayN = null;
      if (s.rebal) { var d0 = new Date(s.rebal.getTime()), d1 = new Date(); d0.setHours(0, 0, 0, 0); d1.setHours(0, 0, 0, 0); dayN = Math.max(1, Math.round((d1 - d0) / 864e5)); }
      var lead = port != null
        ? 'This cycle so far: ' + span(port, sgn(port)) + (dayN ? ' after ' + plural(dayN, 'day') : '') + '. In the backtest the middle 80% of months ended between ' + sgn(p10, 1) + ' and ' + sgn(p90, 1) +
          ', and <b>' + below + ' of ' + months.length + '</b> months ended lower than this. The worst was ' + span(lo, sgn(lo, 1)) + (worstM ? ' (' + esc(monthName(worstM[0])) + ')' : '') + '.'
        : 'In the backtest the middle 80% of months ended between ' + sgn(p10, 1) + ' and ' + sgn(p90, 1) + ', the median month was ' + sgn(p50, 1) + ' and the worst was ' + span(lo, sgn(lo, 1)) + (worstM ? ' (' + esc(monthName(worstM[0])) + ')' : '') + '.' +
          (s.demo ? ' On a member’s dashboard, this cycle’s figure appears as a dot on the range.' : '');
      html += '<p class="mi-p">' + lead + '</p>' +
        '<div class="mi-range" role="img" aria-label="' + esc('Backtest monthly returns from ' + sgn(lo, 1) + ' to ' + sgn(hi, 1) + '; middle 80% between ' + sgn(p10, 1) + ' and ' + sgn(p90, 1) + (port != null ? '; this cycle so far ' + sgn(port) : '')) + '">' +
          '<span class="mi-rtrack"></span>' +
          '<span class="mi-rband" style="left:' + pos(p10) + ';width:' + ((p90 - p10) / span_ * 100).toFixed(2) + '%"></span>' +
          '<span class="mi-rtick" style="left:' + pos(p50) + '"></span>' +
          (port != null ? '<span class="mi-rdot ' + tone(port) + '" style="left:' + pos(port) + '"></span><span class="mi-rcap ' + tone(port) + '" style="left:' + pos(port) + '">This cycle</span>' : '') +
          '<span class="mi-rlbl mi-l0" style="left:0">' + sgn(lo, 1) + '</span><span class="mi-rlbl mi-l1">' + sgn(hi, 1) + '</span>' +
        '</div>' +
        '<div class="mi-legend"><span><i></i>Middle 80% of backtest months</span><span><i class="mi-lk-tick"></i>Median month</span></div>';
    } else {
      W.__miNormal = null;
      html += '<p class="mi-p">In its backtest, <b>' + neg + ' of ' + tot + '</b> months ended negative' + (worstTxt ? ' and the worst was ' + span(-1, esc(worstTxt.replace('-', '−'))) : '') + '.' +
        (port != null ? ' This cycle so far: ' + span(port, sgn(port)) + '.' : '') + '</p>';
    }
    // the live record against that range
    var cyc = hist && hist.cycles ? hist.cycles.filter(function (c) { return c.strategies && c.strategies[s.key] && c.strategies[s.key].live_pct != null; }) : [];
    if (cyc.length) {
      var sealed = cyc.filter(function (c) { return c.sealed; }).length;
      html += '<p class="mi-note">Live record so far: ' + plural(cyc.length, 'cycle') + ' (' + sealed + ' closed). ' +
        (sealed < 6 ? 'That is far too few to judge a strategy; each month adds one.' : 'Every closed cycle is on the record card below.') + '</p>';
    }
    html += learn(['Each month of the published backtest is one point on the range. A cycle in progress is compared with whole months, so treat the dot as a guide, not a verdict. The backtest window held no crash like 2008’s or 2020’s, so a real one can go further than the left end of this bar.']);
    show(el, html);
  }
  function monthName(ym) {
    var m = /^(\d{4})-(\d{2})$/.exec(ym || ''); if (!m) return ym;
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1] + ' ' + m[1];
  }

  // ── M2 + M3 · ahead or behind the index, and why ──────────────────────────
  function normInd(n) { return String(n || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z]+/g, ' ').trim(); }
  function renderVsIndex(s, lb, bench, mk, ba, closes) {
    var el = card('mi-vs', 'insight');
    after(el, D.getElementById('attrib-card'));
    if (s.demo) { hide('mi-vs'); return; }
    var html = '', any = false;

    // M2 — live, from the same contributions as the attribution card
    if (lb && bench && bench.live) {
      var gap = lb.port - bench.bench;
      var act = lb.rows.map(function (x) { return { t: x.t, ind: x.ind, r: x.r, a: x.wn * (x.r - bench.bench) }; });
      var pos = act.filter(function (x) { return x.a > 0.005; }).sort(function (a, b) { return b.a - a.a; });
      var neg = act.filter(function (x) { return x.a < -0.005; }).sort(function (a, b) { return a.a - b.a; });
      var indMove = function (ind) {
        var m = mk && mk.industries ? mk.industries[Object.keys(mk.industries).filter(function (k) { return normInd(k) === normInd(ind); })[0]] : null;
        return m && m.cyc != null ? m.cyc : null;
      };
      var chip = function (x) {
        var im = indMove(x.ind);
        return '<span class="mi-chip"><b>' + esc(x.t) + '</b> ' + span(x.a, pts(x.a)) + ' <span class="mi-cx">stock ' + sgn(x.r, 1) +
          (im != null ? ' · its industry ' + sgn(im, 1) : '') + '</span></span>';
      };
      html += '<p class="mi-p">' + esc(s.book) + ' ' + span(lb.port, sgn(lb.port)) + ' against the ' + esc(bench.name) + ' ' + span(bench.bench, sgn(bench.bench)) + ': ' +
        (Math.abs(gap) <= 0.05 ? '<b>level with it</b>.' : '<b>' + span(gap, Math.abs(gap).toFixed(2) + ' points') + ' ' + (gap > 0 ? 'ahead' : 'behind') + '</b>.') + '</p>';
      if (pos.length) {
        var sumPos = pos.reduce(function (a, x) { return a + x.a; }, 0), top3 = pos.slice(0, 3).reduce(function (a, x) { return a + x.a; }, 0);
        var sumNeg = neg.reduce(function (a, x) { return a + x.a; }, 0);
        // the two sides net to the gap printed above (4.10 − 1.72 = 2.38), so the share is never of the gap itself
        html += '<p class="mi-k">Put it ahead of the index</p><div class="mi-chips">' + pos.slice(0, 3).map(chip).join('') + '</div>' +
          (pos.length > 3 ? '<p class="mi-note" style="margin-top:4px">These three added ' + top3.toFixed(2) + ' of the ' + sumPos.toFixed(2) +
            ' pts that the names ahead of the index added' + (sumNeg < -0.005 ? '; the names behind it took ' + Math.abs(sumNeg).toFixed(2) + ' pts back' : '') + '.</p>' : '');
      }
      if (neg.length) html += '<p class="mi-k">Held it back</p><div class="mi-chips">' + neg.slice(0, 3).map(chip).join('') + '</div>';
      any = true;
    }

    // M3 — Brinson-Fachler by NSE industry, both sides to the same close
    var bf = (s.key === 'lm' || s.key === 'sm') ? brinson(s, bench, ba, closes) : null;
    if (bf) {
      html += '<p class="mi-k">Industry choice or stock choice</p>' +
        '<p class="mi-p">To the ' + esc(dshort(dt(bf.asOf))) + ' close, against the index rebuilt from its constituents (' + sgn(bf.rb) + (bf.ri != null ? '; the index itself ' + sgn(bf.ri) : '') + '), the book was ' +
        span(bf.rp - bf.rb, Math.abs(bf.rp - bf.rb).toFixed(2) + ' points') + ' ' + (bf.rp >= bf.rb ? 'ahead' : 'behind') + ': <b>' + span(bf.alloc, pts(bf.alloc)) + '</b> from the industries it held and <b>' +
        span(bf.sel, pts(bf.sel)) + '</b> from the stocks it held within them.</p>' +
        '<details class="mi-more"><summary>See it by industry</summary><div class="mi-tbl-wrap"><table class="mi-tbl"><thead><tr><th scope="col">Industry</th><th scope="col">Book</th><th scope="col">Index</th><th scope="col">Book move</th><th scope="col">Index move</th><th scope="col">Industry choice</th><th scope="col">Stock choice</th></tr></thead><tbody>' +
        bf.rows.map(function (r) {
          return '<tr><td>' + esc(r.name) + '</td><td>' + r.wp.toFixed(1) + '%</td><td>' + r.wb.toFixed(1) + '%</td><td>' + (r.rp == null ? '—' : span(r.rp, sgn(r.rp, 1))) + '</td><td>' + (r.rbj == null ? '—' : span(r.rbj, sgn(r.rbj, 1))) + '</td><td>' + span(r.a, pts(r.a)) + '</td><td>' + span(r.s, pts(r.s)) + '</td></tr>';
        }).join('') + '</tbody></table></div></details>';
      any = true;
    }
    if (!any) { hide('mi-vs'); return; }
    show(el, '<div class="mi-head"><h2>Ahead or behind the index, and why</h2><span class="mi-sub">Live prices · industry split to the last close</span></div>' + html +
      learn(['A holding’s share of the gap is its weight times how far its own move beat or trailed the index’s. The shares add up to the gap exactly.',
             '“Industry choice” is what the book gained or lost by holding more or less of each NSE industry than its index; “stock choice” is what the particular stocks did within their industries (the Brinson-Fachler method). The index is rebuilt from its own constituents’ official closes with free-float weights from the MindForge snapshot, so it can differ a little from the published level; NSE publishes official weights monthly.']));
  }

  function brinson(s, bench, ba, closes) {
    if (!ba || !ba.legs || !closes || !closes.rows || !closes.dates || !closes.dates.length) return null;
    if (ba.rebalance_date !== s.rebalIso) return null;                 // same window or nothing
    var legs = (bench && bench.legs && bench.legs.length) ? bench.legs : (s.key === 'lm'
      ? [{ t: '^CNX100', w: 0.5 }, { t: 'NIFTYMIDCAP150.NS', w: 0.5 }] : [{ t: 'NIFTYSMLCAP250.NS', w: 1 }]);
    var asOf = closes.dates[closes.dates.length - 1];
    if (asOf !== ba.as_of) return null;
    // benchmark side: blend the legs by their weights
    var B = {}, rb = 0, ri = 0, riOk = true, wsum = 0;
    for (var i = 0; i < legs.length; i++) {
      var L = ba.legs[legs[i].t], lw = Number(legs[i].w) || 0;
      if (!L || !(lw > 0)) return null;
      wsum += lw;
      Object.keys(L.industries).forEach(function (name) {
        var g = L.industries[name], k = normInd(name);
        var o = B[k] || (B[k] = { name: name, w: 0, wr: 0, wcov: 0 });
        var w = lw * (Number(g.w) || 0) / 100;
        o.w += w;
        if (g.r != null) { o.wr += w * Number(g.r); o.wcov += w; }
      });
      if (L.r_est != null) rb += lw * Number(L.r_est); else return null;
      if (L.r_index != null) ri += lw * Number(L.r_index); else riOk = false;
    }
    if (Math.abs(wsum - 1) > 0.01) return null;
    // book side: each holding from its published price to the same official close
    var col = closes.dates.length - 1, P = {}, wp = 0, rp = 0, covered = 0, total = 0;
    (s.stocks || []).forEach(function (x) {
      var w = (Number(x.weight_pct) || 0) / 100; total += w;
      var row = closes.rows[String(x.ticker)], rec = Number(x.recommended_price) || 0;
      var c = row ? row[col] : null;
      if (!(w > 0) || !(rec > 0) || !(c > 0)) return;
      var r = (c / rec - 1) * 100;
      if (Math.abs(r) > 60) return;                                  // a corporate action, not a move
      covered += w;
      var k = normInd(x.industry);
      var o = P[k] || (P[k] = { name: x.industry || 'Other', w: 0, wr: 0 });
      o.w += w; o.wr += w * r;
    });
    if (!(total > 0) || covered / total < 0.8) return null;
    Object.keys(P).forEach(function (k) { P[k].w /= covered; P[k].wr /= covered; });
    Object.keys(P).forEach(function (k) { rp += P[k].wr; });
    var rows = [], alloc = 0, sel = 0;
    var keys = {}; Object.keys(P).forEach(function (k) { keys[k] = 1; }); Object.keys(B).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var p = P[k], b = B[k];
      var wpj = p ? p.w : 0, wbj = b ? b.w : 0;
      var rbj = b && b.wcov ? b.wr / b.wcov : null;
      var rpj = p && p.w ? p.wr / p.w : null;
      var rbjUse = rbj == null ? rb : rbj;
      var a = (wpj - wbj) * (rbjUse - rb);
      var se = rpj == null ? 0 : (wbj * (rpj - rbjUse) + (wpj - wbj) * (rpj - rbjUse));   // selection + interaction
      alloc += a; sel += se;
      if (wpj > 0 || wbj >= 0.02) rows.push({ name: (p && p.name) || (b && b.name) || k, wp: wpj * 100, wb: wbj * 100, rp: rpj, rbj: rbj, a: a, s: se });
    });
    rows.sort(function (x, y) { return Math.abs(y.a + y.s) - Math.abs(x.a + x.s); });
    return { asOf: asOf, rp: rp, rb: rb, ri: riOk ? ri : null, alloc: alloc, sel: sel, rows: rows.slice(0, 10) };
  }

  // ── M4 · market weather ──────────────────────────────────────────────────
  function renderWeather(s, mk, etf) {
    var el = card('mi-weather', 'insight');
    after(el, D.getElementById('mi-vs') || D.getElementById('attrib-card'));
    if (!mk || !mk.indices || !mk.indices.nifty50) { hide('mi-weather'); return; }
    var n50 = mk.indices.nifty50, rows = [];
    if (n50.vs200 != null) rows.push(['Trend', 'The Nifty 50 is <b>' + Math.abs(n50.vs200).toFixed(1) + '% ' + (n50.vs200 >= 0 ? 'above' : 'below') + '</b> its 200-day average (' + sgn(n50.cyc, 1) + ' since the rebalance).']);
    if (mk.breadth) {
      var b = mk.breadth, chg = b.above200_mo != null ? ' (' + b.above200_mo + '% a month ago)' : (b.above200_wk != null ? ' (' + b.above200_wk + '% a week ago)' : '');
      rows.push(['Breadth', '<b>' + Math.round(b.above200) + '%</b> of ' + Number(b.n).toLocaleString('en-IN') + ' NSE stocks are above their 200-day average' + chg + ', and ' + Math.round(b.above50) + '% above their 50-day.']);
    }
    if (mk.vix && mk.vix.last != null) rows.push(['Volatility', 'India VIX <b>' + mk.vix.last.toFixed(1) + '</b> — higher than ' + mk.vix.pctile_1y + '% of the past year’s readings.']);
    if (mk.flows) {
      var f = mk.flows;
      rows.push(['Flows', 'Over the last ' + f.days + ' sessions FIIs sold on <b>' + f.fii_sell_days + '</b> (net ' + crore(f.fii_net_cr) + ') and DIIs bought on <b>' + f.dii_buy_days + '</b> (net ' + crore(f.dii_net_cr) + ').']);
    }
    if (mk.size && mk.size.cyc != null) {
      var sc = mk.indices.smallcap250, lg = n50;
      rows.push(['Size', 'Since the rebalance the Nifty Smallcap 250 is ' + span(sc ? sc.cyc : 0, sgn(sc ? sc.cyc : null, 1)) + ' against ' + span(lg.cyc, sgn(lg.cyc, 1)) + ' for the Nifty 50.']);
    }
    if (mk.styles && mk.styles.length) {
      var ss = mk.styles.filter(function (x) { return x.cyc != null; }).sort(function (a, b) { return b.cyc - a.cyc; });
      if (ss.length) rows.push(['Style', '<span class="mi-styles">' + ss.map(function (x) { return '<span>' + esc(x.short) + ' ' + span(x.cyc, sgn(x.cyc, 1)) + '</span>'; }).join('') + '</span> since the rebalance, through ETFs that track NSE’s factor indices.']);
    }
    var key = mk.regime && mk.regime.key;
    var meaning = '';
    if (s.key === 'ma') {
      var A = [['NIFTYBEES', 'Indian large caps'], ['MID150BEES', 'Indian midcaps'], ['HDFCSML250', 'Indian small caps'], ['GOLDBEES', 'Gold'], ['SILVERBEES', 'Silver'], ['MON100', 'US technology (Nasdaq-100)'], ['EBBETF0431', 'Indian bonds']];
      var moves = [];
      if (etf && etf.rows && etf.dates && s.rebalIso) {
        var ri = etf.dates.indexOf(s.rebalIso), li = etf.dates.length - 1;
        if (ri > -1) A.forEach(function (a) {
          var r = etf.rows[a[0]]; if (!r || !(r[ri] > 0) || !(r[li] > 0)) return;
          moves.push({ n: a[1], v: (r[li] / r[ri] - 1) * 100 });
        });
      }
      if (moves.length >= 3) {
        moves.sort(function (a, b) { return b.v - a.v; });
        meaning = '<p class="mi-k">The asset classes MultiAsset spreads across, since the rebalance</p><div class="mi-chips">' +
          moves.map(function (m) { return '<span class="mi-chip"><b>' + esc(m.n) + '</b> ' + span(m.v, sgn(m.v, 1)) + '</span>'; }).join('') + '</div>' +
          '<p class="mi-note">Through each class’s most common NSE ETF, official closes to ' + esc(dshort(dt(etf.dates[li]))) + '. A multi-asset book’s month depends on how these move against each other more than on any one market.</p>';
      }
    } else if (key && REGIME_LONG[key]) {
      meaning = '<p class="mi-k">What this kind of market has meant for books like this</p><p class="mi-p">' + REGIME_LONG[key] +
        ' <span class="mi-sub">General research about books that rank on price and volume trends, not a forecast for this month.</span></p>';
    }
    show(el, '<div class="mi-head"><h2>Market weather ' + (mk.regime ? '<span class="mi-pill is-' + esc(mk.regime.key) + '">' + esc(mk.regime.label) + '</span>' : '') + '</h2><span class="mi-sub">To the ' + esc(dshort(dt(mk.as_of))) + ' close</span></div>' +
      '<div class="mi-rows">' + rows.map(function (r) { return '<div class="mi-row"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>'; }).join('') + '</div>' + meaning +
      '<p class="mi-note">Sources: NSE official closes and FII/DII provisional data; Yahoo Finance for index levels and India VIX; the MindForge stock snapshot for breadth.</p>' +
      learn(['The label comes from published rules: the trend is the Nifty 50 against its 200-session average, “nervous” means India VIX at or above its 70th percentile of the past year, and a rebound is the index at least 5% off a 3-month low after a fall of 8% or more.',
             'None of this changes the model or its orders. It describes the market the book is moving in.']));
  }
  function crore(v) {
    if (v == null || !isFinite(v)) return '—';
    return '<span style="white-space:nowrap">' + (v < 0 ? '−' : '+') + '₹' + Math.round(Math.abs(v)).toLocaleString('en-IN') + ' cr</span>';
  }

  // ── M5 · what could move your book ───────────────────────────────────────
  function renderRisk(s, mk, ba, sig, closes) {
    var el = card('mi-risk', 'insight');
    after(el, D.getElementById('mi-weather') || D.getElementById('mi-vs') || D.getElementById('attrib-card'));
    if (!closes || !closes.rows || !closes.dates || closes.dates.length < 25) { hide('mi-risk'); return; }
    var stocks = (s.stocks || []).filter(function (x) { return Number(x.weight_pct) > 0; });
    var tot = stocks.reduce(function (a, x) { return a + Number(x.weight_pct); }, 0);
    if (!(tot > 0)) { hide('mi-risk'); return; }
    var n = closes.dates.length, rows = [];
    // daily book returns over the window (renormalised over the names priced each day)
    var series = [];
    for (var d = 1; d < n; d++) {
      var wr = 0, ws = 0;
      stocks.forEach(function (x) {
        var r = closes.rows[String(x.ticker)];
        if (!r || !(r[d] > 0) || !(r[d - 1] > 0)) return;
        var ret = r[d] / r[d - 1] - 1;
        if (Math.abs(ret) > 0.35) return;                           // a split or bonus, not a move
        var w = Number(x.weight_pct); wr += w * ret; ws += w;
      });
      series.push(ws / tot >= 0.8 ? { d: closes.dates[d], r: wr / ws } : null);
    }
    var got = series.filter(Boolean);
    if (got.length < 20) { hide('mi-risk'); return; }
    var m = mean(got.map(function (x) { return x.r; }));
    var sd = Math.sqrt(got.reduce(function (a, x) { return a + Math.pow(x.r - m, 2); }, 0) / (got.length - 1));
    var sdM = sd * Math.sqrt(21) * 100;
    var cap = s.capital > 0 ? s.capital : 0;
    if (cap) rows.push(['Typical month', 'About <b style="white-space:nowrap">±' + inr(cap * sdM / 100) + '</b> on ' + (s.capEntered ? 'your ' : 'the starting amount of ') + inr(cap) + ' — ±' + sdM.toFixed(1) + '%. Roughly one month in three moves more than that.']);
    else rows.push(['Typical month', 'About <b>±' + sdM.toFixed(1) + '%</b>. Roughly one month in three moves more than that.']);
    // market sensitivity against the book's own benchmark blend
    var legs = s.key === 'lm' ? [['nifty100', 0.5], ['midcap150', 0.5]] : s.key === 'sm' ? [['smallcap250', 1]] : [['nifty50', 1]];
    var bname = s.key === 'lm' ? 'Nifty LargeMidcap 250' : s.key === 'sm' ? 'Nifty Smallcap 250' : 'Nifty 50';
    if (mk && mk.indices) {
      var maps = legs.map(function (l) { var ix = mk.indices[l[0]], o = {}; (ix ? ix.series : []).forEach(function (p) { o[p[0]] = p[1]; }); return [o, l[1]]; });
      var pairs = [];
      got.forEach(function (x, k) {
        var i = closes.dates.indexOf(x.d), prev = closes.dates[i - 1], br = 0, ok = true;
        maps.forEach(function (mp) { var a = mp[0][x.d], b = mp[0][prev]; if (!(a > 0) || !(b > 0)) ok = false; else br += mp[1] * (a / b - 1); });
        if (ok) pairs.push([x.r, br]);
      });
      if (pairs.length >= 20) {
        var mx = mean(pairs.map(function (p) { return p[1]; })), my = mean(pairs.map(function (p) { return p[0]; }));
        var cov = 0, vx = 0; pairs.forEach(function (p) { cov += (p[1] - mx) * (p[0] - my); vx += Math.pow(p[1] - mx, 2); });
        if (vx > 0) {
          var beta = cov / vx;
          rows.push(['Market sensitivity', 'When the ' + bname + ' moved 1% in a day, this book has tended to move about <b>' + beta.toFixed(2) + '%</b> (last ' + pairs.length + ' sessions).']);
        }
      }
    }
    // concentration against the index (equity books)
    if ((s.key === 'lm' || s.key === 'sm') && ba && ba.legs) {
      var bw = {}, bl = s.key === 'lm' ? [['^CNX100', 0.5], ['NIFTYMIDCAP150.NS', 0.5]] : [['NIFTYSMLCAP250.NS', 1]];
      bl.forEach(function (l) { var L = ba.legs[l[0]]; if (!L) return; Object.keys(L.industries).forEach(function (k) { var nk = normInd(k); bw[nk] = (bw[nk] || 0) + l[1] * Number(L.industries[k].w || 0); }); });
      var pw = {}, pname = {};
      stocks.forEach(function (x) { var k = normInd(x.industry); pw[k] = (pw[k] || 0) + Number(x.weight_pct) / tot * 100; pname[k] = x.industry; });
      // only when the book's industries are the index's own NSE names (a book labelled
      // in another taxonomy would read as "0% of the index" against every row)
      var matched = Object.keys(pw).filter(function (k) { return bw[k] > 0; });
      var mw = matched.reduce(function (a, k) { return a + pw[k]; }, 0);
      var over = matched.map(function (k) { return { n: pname[k], p: pw[k], b: bw[k] }; })
        .filter(function (o) { return o.p - o.b >= 2; })
        .sort(function (a, b) { return (b.p - b.b) - (a.p - a.b); }).slice(0, 2);
      if (over.length && mw >= 60) rows.push(['Concentration', over.map(function (o) { return '<b>' + esc(o.n) + '</b> ' + o.p.toFixed(0) + '% of the book against ' + o.b.toFixed(0) + '% of the index'; }).join('; ') + '.']);
    }
    // trend health and distance from highs
    var a50 = 0, a200 = 0, nt = 0, deep = [];
    stocks.forEach(function (x) {
      var t = String(x.ticker), sr = sig && sig.rows ? sig.rows[t] : null, r = closes.rows[t];
      var above50 = sr && sr[1] != null ? sr[1] : null, above200 = sr && sr[2] != null ? sr[2] : null;
      if (above50 == null && r) {
        var tail = r.slice(-50).filter(function (v) { return v > 0; });
        if (tail.length >= 40 && r[r.length - 1] > 0) above50 = r[r.length - 1] > mean(tail) ? 1 : 0;
      }
      if (above50 != null) { nt++; a50 += above50; if (above200 != null) a200 += above200; }
      if (sr && sr[3] != null && sr[3] <= -20) deep.push({ t: t, v: sr[3] });
    });
    if (nt >= Math.max(3, stocks.length * 0.6)) {
      rows.push(['Trend', '<b>' + a50 + ' of ' + nt + '</b> holdings are above their 50-day average' + (s.key !== 'ma' ? ' and ' + a200 + ' above their 200-day' : '') + '.' +
        (s.key !== 'ma' ? ' <span class="mi-sub">The model ranks on price and volume trends, so this is the part of the market it is built to hold.</span>' : '')]);
    }
    if (deep.length) {
      deep.sort(function (a, b) { return a.v - b.v; });
      rows.push(['Off the highs', '<b>' + plural(deep.length, 'holding') + '</b> ' + (deep.length === 1 ? 'is' : 'are') + ' more than 20% below ' + (deep.length === 1 ? 'its' : 'their') + ' 52-week high (furthest: ' + esc(deep[0].t) + ', ' + sgn(deep[0].v, 0) + ').']);
    }
    // liquidity: the largest order against a normal day's trading
    if (cap && sig && sig.rows && typeof W.allocBudget === 'function') {
      var worst = null;
      stocks.forEach(function (x) {
        var sr = sig.rows[String(x.ticker)], adv = sr ? sr[7] : null;
        if (!(adv > 0)) return;
        var amt = W.allocBudget(x, s.stocks, cap);
        var share = amt / (adv * 1e7) * 100;
        if (!worst || share > worst.share) worst = { t: String(x.ticker), amt: amt, share: share };
      });
      if (worst) rows.push(['Liquidity', 'Your largest order here, ' + esc(worst.t) + ' at ' + inr(worst.amt) + ', is ' + (worst.share < 0.01 ? '<b>under 0.01%</b>' : 'about <b>' + (worst.share < 1 ? worst.share.toFixed(2) : worst.share.toFixed(1)) + '%</b>') + ' of a normal day’s trading in it' +
        (worst.share >= 5 ? ' — large enough that a limit order near the published price is sensible.' : '.')]);
    }
    // what the book owns, against the index (equity books)
    if ((s.key === 'lm' || s.key === 'sm') && sig && sig.rows) {
      var ey = 0, ew = 0, by = 0, bwt = 0, rq = 0, rw = 0;
      stocks.forEach(function (x) {
        var sr = sig.rows[String(x.ticker)], w = Number(x.weight_pct);
        if (!sr) return;
        if (sr[4] > 0) { ey += w / sr[4]; ew += w; }
        if (sr[5] > 0) { by += w / sr[5]; bwt += w; }
        if (sr[6] != null && sr[6] > -100 && sr[6] < 200) { rq += w * sr[6]; rw += w; }
      });
      var bst = null;
      if (ba && ba.legs) {
        var bl2 = s.key === 'lm' ? [['^CNX100', 0.5], ['NIFTYMIDCAP150.NS', 0.5]] : [['NIFTYSMLCAP250.NS', 1]];
        var acc = { pe: 0, pb: 0, roe: 0, ok: true };
        bl2.forEach(function (l) { var L = ba.legs[l[0]]; if (!L || !L.stats || !L.stats.pe || !L.stats.pb || L.stats.roe == null) { acc.ok = false; return; } acc.pe += l[1] / L.stats.pe; acc.pb += l[1] / L.stats.pb; acc.roe += l[1] * L.stats.roe; });
        if (acc.ok) bst = { pe: 1 / acc.pe, pb: 1 / acc.pb, roe: acc.roe };
      }
      if (ew >= tot * 0.6) {
        var pe = ew / ey, pb = bwt ? bwt / by : null, roe = rw ? rq / rw : null;
        rows.push(['What it owns', 'Weighted P/E <b>' + pe.toFixed(1) + '</b>' + (bst ? ' against ' + bst.pe.toFixed(1) + ' for the index' : '') +
          (pb ? ' · P/B ' + pb.toFixed(1) + (bst ? ' against ' + bst.pb.toFixed(1) : '') : '') +
          (roe != null ? ' · ROE ' + roe.toFixed(0) + '%' + (bst ? ' against ' + bst.roe.toFixed(0) + '%' : '') : '') +
          '. <span class="mi-sub">The model does not use these figures; they describe what the book holds.</span>']);
      }
    }
    show(el, '<div class="mi-head"><h2>What could move your book' + (s.demo ? '<span class="mi-badge">Sample book</span>' : '') + '</h2><span class="mi-sub">Last ' + n + ' sessions to ' + esc(dshort(dt(closes.dates[n - 1]))) + '</span></div>' +
      '<div class="mi-rows">' + rows.map(function (r) { return '<div class="mi-row"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>'; }).join('') + '</div>' +
      '<p class="mi-note">From official NSE closes over about three months, at today’s model weights. It describes the recent past, not a forecast.</p>' +
      learn(['“Typical month” is the book’s daily volatility scaled to a month (×√21). About two months in three fall inside it if returns behave normally; real markets have fatter tails.',
             'Market sensitivity is the beta of the book’s daily returns against its benchmark over the same sessions. Liquidity compares your order with the stock’s average daily traded value over the last 20 sessions.']));
  }

  // ── M7 · you and the model ───────────────────────────────────────────────
  function renderYou(s, lb, closes) {
    var el = card('mi-you', 'insight');
    after(el, D.getElementById('mi-risk') || D.getElementById('mi-weather') || D.getElementById('mi-vs') || D.getElementById('attrib-card'));
    if (s.demo || !lb || typeof W.cycleOrders !== 'function' || typeof W.loadBought !== 'function') { hide('mi-you'); return; }
    var orders, placed;
    try { orders = W.cycleOrders(); placed = W.loadBought(currentStrategy) || {}; } catch (e) { hide('mi-you'); return; }
    var px = W._livePx || {}, byT = {};
    lb.rows.forEach(function (x) { byT[x.t.toUpperCase()] = x; });
    var parts = { missed: 0, nMissed: 0, restricted: 0, nRes: 0, fills: 0, nFills: 0, exits: 0, nExits: 0, cash: 0 };
    var anyTick = Object.keys(placed).length > 0;
    (orders.buys || []).forEach(function (o) {
      var x = byT[String(o.ticker).toUpperCase()]; if (!x) return;
      var tick = placed[W.orderKey(o)];
      if (!tick) { parts.missed += -x.wn * x.r; parts.nMissed++; return; }
      if (tick && typeof tick === 'object' && Number(tick.p) > 0 && Math.abs(Number(tick.p) - x.rec) / x.rec > 0.0005) {
        parts.fills += x.wn * (x.live / Number(tick.p) - x.live / x.rec) * 100; parts.nFills++;
      }
    });
    try {
      (s.stocks || []).forEach(function (x) {
        if (typeof W._isRestricted === 'function' && W._isRestricted(x.ticker)) {
          var r = byT[String(x.ticker).toUpperCase()]; if (r) { parts.restricted += -r.wn * r.r; parts.nRes++; }
        }
      });
    } catch (e) {}
    // names the model sold that the member has not: exposure since the rebalance close
    var exitsKnown = true;
    (orders.sells || []).forEach(function (o) {
      if (placed[W.orderKey(o)]) return;
      var row = closes && closes.rows ? closes.rows[String(o.ticker).toUpperCase()] : null;
      var ri = closes && closes.dates ? closes.dates.indexOf(s.rebalIso) : -1;
      var live = px[o.y] ? Number(px[o.y].price) : 0;
      if (!row || ri < 0 || !(row[ri] > 0) || !(live > 0)) { exitsKnown = false; return; }
      var w = lb.n ? 1 / (lb.n + (orders.sells || []).length) : 0;
      parts.exits += w * (live / row[ri] - 1) * 100; parts.nExits++;
    });
    // cash left by whole-share rounding, at the member's own capital
    var cap = s.capital, alloc = 0;
    if (cap > 0 && typeof W.allocBudget === 'function') {
      (s.stocks || []).forEach(function (x) {
        var rec = Number(x.recommended_price) || 0; if (!(rec > 0)) return;
        if (typeof W._isRestricted === 'function' && W._isRestricted(x.ticker)) return;
        alloc += Math.floor(W.allocBudget(x, s.stocks, cap) / rec) * rec;
      });
      if (alloc > 0 && alloc <= cap) parts.cash = -(cap - alloc) / cap * lb.port;
    }
    var gap = parts.missed + parts.restricted + parts.fills + parts.exits + parts.cash;
    var you = lb.port + gap;
    var lines = [];
    if (parts.nMissed) lines.push(['Orders not placed yet', plural(parts.nMissed, 'buy') + ' still unticked', parts.missed]);
    if (parts.nRes) lines.push(['Your restricted list', plural(parts.nRes, 'name') + ' you do not hold by choice', parts.restricted]);
    if (parts.nFills) lines.push(['Your fill prices', plural(parts.nFills, 'order') + ' entered at a price other than the published one', parts.fills]);
    if (parts.nExits) lines.push(['Sales not made yet', plural(parts.nExits, 'name') + ' the model sold that you still hold', parts.exits]);
    if (cap > 0 && alloc > 0 && cap > alloc) lines.push(['Cash from rounding', inr(cap - alloc) + ' that whole shares cannot use', parts.cash]);
    if (!anyTick && !parts.nRes) {
      show(el, '<div class="mi-head"><h2>You and the model</h2><span class="mi-sub">From your ticks</span></div>' +
        '<p class="mi-p">Tick each order as you place it (and edit the price in <a class="mi-link" href="#mypos-card">Your position</a> if you paid a different one). This card then shows how closely your own book follows the model, and what any gap is made of.</p>');
      return;
    }
    show(el, '<div class="mi-head"><h2>You and the model</h2><span class="mi-sub">Your ticks and entered prices · live prices</span></div>' +
      '<div class="mi-split"><div class="mi-stat"><div class="mi-sv ' + tone(you) + '">' + sgn(you) + '</div><div class="mi-sl">Your book since the ' + esc(dshort(s.rebal)) + ' rebalance (estimated)</div></div>' +
      '<div class="mi-stat"><div class="mi-sv ' + tone(lb.port) + '">' + sgn(lb.port) + '</div><div class="mi-sl">The model, at its published prices</div></div></div>' +
      (lines.length
        ? '<div class="mi-rows" style="margin-top:12px">' + lines.map(function (l) { return '<div class="mi-row"><span>' + l[0] + '</span><span>' + l[1] + ': ' + span(l[2], pts(l[2])) + '</span></div>'; }).join('') + '</div>'
        : '<p class="mi-p" style="margin-top:12px">In step: every order placed at the published price, nothing outstanding.</p>') +
      (exitsKnown ? '' : '<p class="mi-note">One or more sales could not be priced at the rebalance close, so they are left out.</p>') +
      learn(['Each line is a weight times a move: an unplaced buy costs the model’s move on that name; a fill above the published price costs the difference; a name the model sold but you still hold adds its move since the rebalance close; cash from rounding earns nothing while the book moves.',
             'Your figure is an estimate from the model’s weights and your ticks, not your broker’s P&L, which also counts charges, earlier cycles and anything else in your account.']));
  }

  // ── M8 · the record in numbers (inside #trk-card) ────────────────────────
  function renderRecord(s, hist) {
    var trk = D.getElementById('trk-card');
    var old = D.getElementById('mi-trk'), warn = D.getElementById('mi-trk-warn');
    if (!trk || !hist || !hist.cycles || !s.key) { if (old) old.remove(); if (warn) warn.remove(); return; }
    var cyc = hist.cycles.filter(function (c) { return c.strategies && c.strategies[s.key] && c.strategies[s.key].live_pct != null && c.strategies[s.key].bench_pct != null; });
    if (!cyc.length) { if (old) old.remove(); if (warn) warn.remove(); return; }
    var sealed = cyc.filter(function (c) { return c.sealed; });
    var ahead = sealed.filter(function (c) { var x = c.strategies[s.key]; return x.live_pct - x.bench_pct > 0.05; }).length;
    var m = 1, b = 1, peak = 1, dd = 0, worst = null;
    cyc.forEach(function (c) {
      var x = c.strategies[s.key];
      m *= 1 + x.live_pct / 100; b *= 1 + x.bench_pct / 100;
      peak = Math.max(peak, m); dd = Math.min(dd, m / peak - 1);
      if (worst == null || x.live_pct < worst) worst = x.live_pct;
    });
    // the card's own subtitle already prints the compounded pair; these are the
    // figures it does not
    var tiles = [
      [sealed.length ? ahead + ' of ' + sealed.length : '—', 'Closed cycles ahead of the index'],
      [sgn(worst), 'Weakest cycle']
    ];
    if (cyc.length >= 3) tiles.push([sgn(dd * 100), 'Deepest fall from a peak, cycle to cycle']);
    if (!old) { old = D.createElement('div'); old.id = 'mi-trk'; old.className = 'mi-trk'; }
    var tones = ['', tone(worst), tone(dd * 100)];
    old.innerHTML = tiles.map(function (t, i) {
      return '<div class="mi-stat"><div class="mi-sv ' + tones[i] + '">' + t[0] + '</div><div class="mi-sl">' + t[1] + '</div></div>';
    }).join('');
    if (!warn) { warn = D.createElement('p'); warn.id = 'mi-trk-warn'; warn.className = 'mi-trk-warn'; }
    warn.textContent = sealed.length < 6
      ? sealed.length + ' closed ' + (sealed.length === 1 ? 'cycle is' : 'cycles are') + ' far too few to judge a strategy. Up and down capture against the index is shown from twelve.'
      : (sealed.length < 12 ? 'Up and down capture against the index is shown from twelve closed cycles.' : '');
    var rowsEl = D.getElementById('trk-rows');
    if (rowsEl && rowsEl.parentNode) {
      rowsEl.parentNode.insertBefore(old, rowsEl);
      if (warn.textContent) rowsEl.parentNode.insertBefore(warn, rowsEl); else warn.remove();
    }
    if (sealed.length >= 12) {
      var up = sealed.filter(function (c) { return c.strategies[s.key].bench_pct > 0; }), dn = sealed.filter(function (c) { return c.strategies[s.key].bench_pct < 0; });
      var cap = function (arr) { var a = mean(arr.map(function (c) { return c.strategies[s.key].live_pct; })), bb = mean(arr.map(function (c) { return c.strategies[s.key].bench_pct; })); return bb ? a / bb * 100 : null; };
      var uc = up.length >= 3 ? cap(up) : null, dc = dn.length >= 3 ? cap(dn) : null;
      if (uc != null || dc != null) {
        old.insertAdjacentHTML('beforeend', '<div class="mi-stat"><div class="mi-sv">' + (uc != null ? Math.round(uc) : '—') + ' / ' + (dc != null ? Math.round(dc) : '—') + '</div><div class="mi-sl">Up / down capture (index = 100)</div></div>');
      }
    }
  }

  // ── M9 · context for the names that changed (inside #chg-card) ───────────
  function renderChangeContext(s, sig, closes) {
    var host = D.getElementById('chg-card');
    var old = D.getElementById('mi-ctx');
    var diff = W._bookDiff;
    if (!host || !diff || !diff.known || (!diff.added.length && !diff.removed.length) || !sig || !sig.rows) { if (old) old.remove(); return; }
    var line = function (t, left) {
      var sr = sig.rows[String(t).toUpperCase()] || sig.rows[String(t)];
      var bits = [];
      if (left && diff.prevPos && diff.prevPos[t] && closes && closes.rows && s.rebalIso) {
        var p0 = Number(diff.prevPos[t].rec) || 0, row = closes.rows[String(t).toUpperCase()], ri = closes.dates.indexOf(s.rebalIso);
        if (p0 > 0 && row && ri > -1 && row[ri] > 0) bits.push('moved ' + sgn((row[ri] / p0 - 1) * 100, 1) + ' while in the book');
      }
      if (sr) {
        if (sr[1] != null) bits.push((sr[1] ? 'above' : 'below') + ' its 50-day average');
        if (sr[3] != null) bits.push(sgn(sr[3], 0) + ' from its 52-week high');
      }
      return bits.length ? '<div class="mi-ctx-row"><b>' + esc(t) + '</b><span class="mi-cx">' + bits.join(' · ') + '</span></div>' : '';
    };
    var outRows = diff.removed.map(function (t) { return line(t, true); }).join('');
    var inRows = diff.added.map(function (t) { return line(t, false); }).join('');
    if (!outRows && !inRows) { if (old) old.remove(); return; }
    var med = W._mfData ? W._mfData(s.key + ':median') : '';
    var nOrd = (diff.added.length + diff.removed.length);
    if (!old) { old = D.createElement('details'); old.id = 'mi-ctx'; old.className = 'mi-ctx mi-more'; host.appendChild(old); }
    old.innerHTML = '<summary>Context for the names that changed</summary>' +
      (med ? '<p class="mi-note" style="margin-top:6px">' + plural(nOrd, 'order') + ' this cycle from changes to the list; the typical backtest month needs about ' + esc(med) + '.</p>' : '') +
      (outRows ? '<p class="mi-k">Left the book</p><div class="mi-ctx-list">' + outRows + '</div>' : '') +
      (inRows ? '<p class="mi-k">Joined the book</p><div class="mi-ctx-list">' + inRows + '</div>' : '') +
      '<p class="mi-note">Context, not the model’s reasons. A name joins or leaves when its rank in the model changes; the ranking and its inputs are not published. Trend and 52-week figures are from the MindForge snapshot.</p>';
  }

  // ── M10 · a note from the analyst ────────────────────────────────────────
  function renderNote(s) {
    var el = card('mi-note', 'insight', 'mi-notecard');
    before(el, D.getElementById('profit-card'));
    var narr = D.getElementById('mi-narr'); if (narr) after(el, narr);
    var n = W._mfNote;
    if (s.demo) {
      show(el, '<div class="mi-head"><h2>A note from the analyst<span class="mi-badge">Sample</span></h2></div>' +
        '<p class="mi-p">Each cycle a short note lands here for members: what the market did, how the book behaved, what changed in it and what could matter next. It is written by the analyst who runs the model, it says what went wrong as plainly as what went right, and it is never personal advice.</p>');
      return;
    }
    if (!n || !n.title || !n.body) { hide('mi-note'); return; }
    var paras = String(n.body).split(/\n\s*\n/).map(function (p) { return '<p class="mi-p">' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>'; }).join('');
    var when = n.published_at ? dlong(new Date(n.published_at)) : '';
    show(el, '<div class="mi-head"><h2>A note from the analyst</h2><span class="mi-sub">' + esc(when) + (n.cycle ? ' · ' + esc(n.cycle) : '') + '</span></div>' +
      '<h3>' + esc(n.title) + '</h3>' + paras +
      (n.author ? '<p class="mi-sign">— ' + esc(n.author) + '</p>' : '') +
      '<p class="mi-note">Research for members of this book. Not personalised investment advice.</p>');
  }

  // ── M11 · your months with this book (before a renewal) ──────────────────
  function renderReview(s, hist) {
    var el = card('mi-review', 'insight');
    before(el, D.getElementById('mi-narr') || D.getElementById('profit-card'));
    if (s.demo || !s.key || s.key === 'ma' || !hist || !hist.cycles) { hide('mi-review'); return; }
    var sub = s.sub || {}, now = Date.now();
    var exp = sub.expires_at ? new Date(sub.expires_at) : null, start = sub.subscribed_at ? new Date(sub.subscribed_at) : null;
    if (!exp || isNaN(exp.getTime()) || !start || isNaN(start.getTime())) { hide('mi-review'); return; }
    var daysLeft = Math.ceil((exp.getTime() - now) / 864e5);
    var monthsIn = (now - start.getTime()) / (30.44 * 864e5);
    var anniv = [3, 6, 12].some(function (m) { return monthsIn >= m && monthsIn < m + 0.2; });
    if (!(daysLeft <= 14 && daysLeft >= 0) && !anniv) { hide('mi-review'); return; }
    var startIso = iso(start);
    var cyc = hist.cycles.filter(function (c) { return c.rebalance_date >= startIso.slice(0, 10) && c.strategies && c.strategies[s.key] && c.strategies[s.key].live_pct != null; });
    if (!cyc.length) { hide('mi-review'); return; }
    // ahead/behind counts closed cycles only, as the track record does; a running cycle has no verdict yet
    var m = 1, b = 1, ahead = 0, closed = 0;
    cyc.forEach(function (c) { var x = c.strategies[s.key]; m *= 1 + x.live_pct / 100; b *= 1 + x.bench_pct / 100; if (c.sealed) { closed++; if (x.live_pct - x.bench_pct > 0.05) ahead++; } });
    var months = Math.max(1, Math.round(monthsIn));
    var running = !cyc[cyc.length - 1].sealed;
    show(el, '<div class="mi-head"><h2>Your ' + plural(months, 'month') + ' with ' + esc(s.book) + '</h2><span class="mi-sub">Model portfolio, live record</span></div>' +
      '<p class="mi-p">' + plural(cyc.length, 'cycle') + ' since you joined' + (running ? ' (the newest still running)' : '') + ': the model ' + span((m - 1) * 100, sgn((m - 1) * 100)) + ' against its index ' + span((b - 1) * 100, sgn((b - 1) * 100)) + ', compounded' + (closed ? ', and ahead of it in <b>' + ahead + ' of ' + closed + '</b> closed ' + (closed === 1 ? 'cycle' : 'cycles') : '') + '. ' +
      'Your access runs to <b>' + esc(dlong(exp)) + '</b>' + (daysLeft <= 14 ? ' (' + plural(daysLeft, 'day') + ')' : '') + '.</p>' +
      '<p class="mi-note">The model’s record, not your account’s: your broker’s Tax P&amp;L has your own trades and charges. <a class="mi-link" href="#trk-card">Every cycle so far</a></p>');
  }

  // ── M12 · what happened today ────────────────────────────────────────────
  // A dated card on a session in which the book moved more than ±2.5% against
  // its previous close, or a holding more than ±8%: did it move with the market
  // (the book's own index), with its industry (the book's OTHER holdings in it —
  // no file this page loads carries an industry's day move), or on its own?
  // The book's figure is the profit card's 1D row, same set and arithmetic, so
  // the two can never disagree; every split is printed from PRINTED figures, so
  // its halves add up to that row. Context, not a cause, and nothing in ?demo.
  function istLocal() {
    try { var d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })); return isNaN(d.getTime()) ? null : d; } catch (e) { return null; }
  }
  function pxEq(a, b) { return a > 0 && b > 0 && Math.abs(a - b) <= Math.max(0.011, b * 0.0005); }
  function two(v) { return Number(Number(v).toFixed(2)); }
  function abs2(v) { return Math.abs(v).toFixed(2); }
  function moved(v) { return v < 0 ? 'fell' : 'rose'; }
  function cap1(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }

  // Which session do the quotes belong to? The prices endpoint carries no time,
  // so they are matched against the official closes file (Yahoo's daily closes
  // equal NSE's bhavcopy closes to the paisa). A date that cannot be placed —
  // a holiday inside a lagging file — withholds the card rather than guessing.
  function sessionOf(rows, closes) {
    var now = istLocal(); if (!now) return null;
    var today = iso(now), dow = now.getDay(), mins = now.getHours() * 60 + now.getMinutes();
    var Dd = closes && closes.dates, R = closes && closes.rows;
    var share = function (fn) {
      var n = 0, k = 0;
      rows.forEach(function (x) { var r = R[String(x.t).toUpperCase()]; if (!r) return; n++; if (fn(x, r)) k++; });
      return n >= 2 ? k / n : 0;
    };
    var prevOf = function () {
      if (!Dd || !R) return null;
      for (var j = Dd.length - 1; j >= Math.max(0, Dd.length - 6); j--) { if (share(function (x, r) { return pxEq(x.prev, r[j]); }) >= 0.6) return Dd[j]; }
      return null;
    };
    // (a) the quotes ARE a session in the file: price and previous close equal two consecutive closes
    if (Dd && R && Dd.length > 2) {
      for (var k = Dd.length - 1; k >= Math.max(1, Dd.length - 6); k--) {
        if (share(function (x, r) { return pxEq(x.price, r[k]) && pxEq(x.prev, r[k - 1]); }) >= 0.6) return { day: Dd[k], prevDay: Dd[k - 1], live: false };
      }
    }
    if (typeof W._nseIsOpen === 'function' && W._nseIsOpen()) return { day: today, prevDay: prevOf(), live: true };
    if (!Dd || !R || !Dd.length) return null;
    // the newest session these quotes can be: today once the bell has gone, else the weekday before
    var last = Dd[Dd.length - 1], cand = [], cur = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (!(dow >= 1 && dow <= 5 && mins >= 15 * 60 + 30)) cur.setDate(cur.getDate() - 1);
    for (var g = 0; g < 14 && iso(cur) > last; g++) { var wd = cur.getDay(); if (wd >= 1 && wd <= 5) cand.push(iso(cur)); cur.setDate(cur.getDate() - 1); }
    if (!cand.length) return null;
    // (b) the previous close is the file's last close: the one session after it — unless a holiday hides which
    if (share(function (x, r) { return pxEq(x.prev, r[Dd.length - 1]); }) >= 0.6) return cand.length === 1 ? { day: cand[0], prevDay: last, live: false } : null;
    // (c) the file lags by more than a session: the newest weekday
    return cand.length >= 2 ? { day: cand[0], prevDay: null, live: false } : null;
  }

  // The book's index over the same session: the legs the benchmark pill already
  // priced (their previous closes, kept by _benchLive), else market.json's d1
  // when that file is dated to this very session. Never a second-hand window.
  function indexDay(s, mk, ses) {
    if (typeof W.loadBenchPerf !== 'function' || !s.key) return Promise.resolve(null);
    return W.loadBenchPerf().then(function (d) {
      var b = d && d.strategies && d.strategies[s.key], legs = b && Array.isArray(b.bench_legs) ? b.bench_legs : [];
      if (!legs.length) return null;
      var name = b.bench_name || 'its index';
      var blend = function (get) {
        var r = 0;
        for (var i = 0; i < legs.length; i++) { var q = get(legs[i].t), w = Number(legs[i].w); if (q == null || !isFinite(q) || !isFinite(w)) return null; r += w * q; }
        return r;
      };
      var viaFile = function () {
        if (!mk || !mk.indices || mk.as_of !== ses.day) return null;
        var byT = {};
        Object.keys(mk.indices).forEach(function (k) { var ix = mk.indices[k]; if (ix && ix.t) byT[ix.t] = ix; });
        var r = blend(function (t) { var ix = byT[t]; return ix && ix.d1 != null ? Number(ix.d1) : null; });
        return r == null ? null : { d: r, name: name };
      };
      var live = typeof W._benchLive === 'function' ? W._benchLive(s.key, b) : Promise.resolve(null);
      return live.then(function () {
        var bp = W._benchPx;
        if (bp && bp.key === s.key && bp.px) {
          var r = blend(function (t) { var q = bp.px[t]; return q && q.price > 0 && q.prev > 0 ? (q.price / q.prev - 1) * 100 : null; });
          if (r != null) return { d: r, name: name };
        }
        return viaFile();
      }, viaFile);
    }).catch(function () { return null; });
  }

  // earlier sessions, from official closes at today's model weights (the M5 series)
  function histOf(s, closes, ses) {
    if (!closes || !closes.rows || !closes.dates || closes.dates.length < 21) return null;
    var stocks = (s.stocks || []).filter(function (x) { return Number(x.weight_pct) > 0; });
    var tot = stocks.reduce(function (a, x) { return a + Number(x.weight_pct); }, 0);
    if (!(tot > 0)) return null;
    var out = { book: [], rows: {}, n: 0 };
    for (var d = 1; d < closes.dates.length && closes.dates[d] < ses.day; d++) {
      var wr = 0, ws = 0;
      stocks.forEach(function (x) {
        var t = String(x.ticker).toUpperCase(), r = closes.rows[t];
        if (!r || !(r[d] > 0) || !(r[d - 1] > 0)) return;
        var ret = (r[d] / r[d - 1] - 1) * 100;
        if (Math.abs(ret) > 35) return;                               // a split or bonus, not a move
        (out.rows[t] = out.rows[t] || []).push(ret);
        wr += Number(x.weight_pct) * ret; ws += Number(x.weight_pct);
      });
      if (ws / tot >= 0.8) { out.book.push(wr / ws); out.n++; }
    }
    return out;
  }

  var todayTok = 0;
  function renderToday(s, closes, sig, mk) {
    var el = card('mi-today', 'insight', 'mi-today');
    before(el, D.getElementById('mi-review') || D.getElementById('mi-narr') || D.getElementById('profit-card'));
    if (s.demo) { hide('mi-today'); return; }
    // exactly the 1D row's set: priced = a published price and a quote; the day = those with a previous close
    var px = W._livePx || {}, rows = [], nPriced = 0, dw = 0, dwr = 0, odd = false;
    (s.stocks || []).forEach(function (x) {
      var rec = Number(x.recommended_price) || 0, p = px[x.yahoo_ticker];
      if (!rec || !p) return;
      nPriced++;
      var price = Number(p.price), pv = Number(p.prev) || 0;
      if (!(pv > 0) || !(price > 0)) return;
      var w = Number(x.weight_pct) || 0, dd = (price - pv) / pv * 100;
      dw += w; dwr += w * dd;
      if (Math.abs(dd) > 35) odd = true;
      rows.push({ t: String(x.ticker), w: w, d: dd, price: price, prev: pv, g: typeof W.groupKeyOf === 'function' ? W.groupKeyOf(x) : (x.industry || '') });
    });
    var bookOk = dw > 0 && rows.length >= 2 && rows.length >= Math.ceil(nPriced * 0.8);
    var v = bookOk ? two(dwr / dw) : null;
    var bookHit = bookOk && !odd && Math.abs(v) > 2.5;                // a split in the set makes the book figure a non-move
    var hits = rows.filter(function (x) { return Math.abs(two(x.d)) > 8 && Math.abs(x.d) <= 35; })
      .sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); });
    if (!bookHit && !hits.length) { hide('mi-today'); return; }
    var ses = sessionOf(rows, closes);
    if (!ses) { hide('mi-today'); return; }
    var tok = ++todayTok;
    indexDay(s, mk, ses).then(function (ix) {
      if (tok !== todayTok) return;                                   // a newer price refresh owns the card
      try { paintToday(el, s, rows, dw, v, bookHit, hits, ses, ix, closes, sig); }
      catch (e) { hide('mi-today'); if (W.console && console.warn) console.warn('mfc-insight:', e && e.message); }
    });
  }

  function paintToday(el, s, rows, dw, v, bookHit, hits, ses, ix, closes, sig) {
    var kind = (typeof W.isAssetClassBook === 'function' && W.isAssetClassBook(s.stocks)) ? 'asset class' : 'industry';
    var B = ix ? two(ix.d) : null;
    var half = function (a, mv) { return a != null && a * mv > 0 && Math.abs(a) >= Math.abs(mv) / 2; };
    var hist = histOf(s, closes, ses), lines = [], marketDay = false;
    if (bookHit) {
      var lbl = B == null ? '' : (half(B, v) ? 'a market-wide day' : 'mostly its own names');
      marketDay = lbl === 'a market-wide day';
      var txt = '';
      if (B != null) {
        var o = two(v - B);                                             // index + the book's own = the 1D figure
        txt = 'Its index, the ' + esc(ix.name) + ', ' + moved(B) + ' ' + abs2(B) + '%' +
          (B * v > 0 && Math.abs(B) > Math.abs(v) ? '; the book ' + moved(v) + ' ' + abs2(o) + ' points less.'
            : (B * v >= 0 ? '; the other ' + abs2(o) + ' points were the book’s own.'
              : ' — the book’s own names moved it ' + abs2(o) + ' points the other way.'));
      }
      if (!marketDay) {
        var side = rows.filter(function (x) { return x.w > 0 && x.d * v > 0; })
          .map(function (x) { return { t: x.t, d: x.d, c: x.w * x.d / dw }; })
          .sort(function (a, b) { return Math.abs(b.c) - Math.abs(a.c); });
        var sideTot = two(side.reduce(function (a, x) { return a + x.c; }, 0)), top = [], acc = 0;
        for (var i = 0; i < side.length && top.length < 3; i++) { top.push(side[i]); acc += side[i].c; if (Math.abs(acc) >= Math.abs(sideTot) * 0.5) break; }
        if (top.length && Math.abs(sideTot) > 0.005) {
          var other = two(v - sideTot);                                 // the other side, so the two net to the 1D figure
          var nm = top.map(function (x) { return '<b>' + esc(x.t) + '</b> (' + span(x.d, sgn(x.d)) + ')'; });
          var who = nm.length > 1 ? nm.slice(0, -1).join(', ') + ' and ' + nm[nm.length - 1] : nm[0];
          txt += (txt ? ' ' : '') + who + (v < 0
            ? ' took ' + abs2(acc) + ' of the ' + abs2(sideTot) + ' points the falling holdings took away' + (Math.abs(other) >= 0.005 ? '; the rising ones added ' + abs2(other) + ' back.' : '.')
            : ' added ' + abs2(acc) + ' of the ' + abs2(sideTot) + ' points the rising holdings added' + (Math.abs(other) >= 0.005 ? '; the falling ones took ' + abs2(other) + ' away.' : '.'));
        }
      }
      if (hist && hist.n >= 20) {
        var nb = hist.book.filter(function (r) { return Math.abs(r) >= Math.abs(v); }).length;
        txt += (txt ? ' ' : '') + 'At today’s weights the book moved this much on ' + (nb || 'none') + ' of the ' + hist.n + ' sessions before it.';
      }
      lines.push('<div class="mi-tline"><p class="mi-th">Your book ' + span(v, sgn(v)) + (lbl ? ' <span class="mi-tlbl">— ' + lbl + '</span>' : '') + '</p>' + (txt ? '<p class="mi-p">' + txt + '</p>' : '') + '</div>');
    }
    var also = [], alsoMkt = true, shown = 0;
    hits.forEach(function (h) {
      var d = two(h.d);
      var peers = rows.filter(function (x) { return x.t !== h.t && x.g && x.g === h.g && x.w > 0; });
      var pw = peers.reduce(function (a, x) { return a + x.w; }, 0);
      var P = pw > 0 ? two(peers.reduce(function (a, x) { return a + x.w * x.d; }, 0) / pw) : null;
      var rest = rows.filter(function (x) { return x.t !== h.t && x.w > 0; }), rw = rest.reduce(function (a, x) { return a + x.w; }, 0);
      var Rr = rw > 0 ? two(rest.reduce(function (a, x) { return a + x.w * x.d; }, 0) / rw) : null;
      var lbl = half(B, d) ? 'with the market'
        : (P != null && half(P, d) ? 'with its ' + kind : (B == null && half(Rr, d) ? 'with the rest of the book' : 'on its own'));
      // on a market-wide day the names that simply fell with it are one line, not fifteen paragraphs
      if ((marketDay && lbl === 'with the market') || shown >= 3) {
        if (lbl !== 'with the market') alsoMkt = false;
        also.push('<b>' + esc(h.t) + '</b> ' + span(d, sgn(d)));
        return;
      }
      shown++;
      var bits = [];
      if (B != null) bits.push('its index ' + moved(B) + ' ' + abs2(B) + '%');
      else if (Rr != null) bits.push('the rest of the book ' + moved(Rr) + ' ' + abs2(Rr) + '%');
      if (P != null) bits.push(peers.length === 1
        ? 'the book’s other ' + esc(h.g) + ' holding, ' + esc(peers[0].t) + ', ' + moved(P) + ' ' + abs2(P) + '%'
        : 'the book’s ' + peers.length + ' other ' + esc(h.g) + ' holdings ' + moved(P) + ' ' + abs2(P) + '% (weighted)');
      var txt = bits.length ? cap1(bits.join(', and ')) + '.' : '';
      // the 52-week position only when the snapshot shares a close with this move
      var sr = sig && sig.rows ? (sig.rows[h.t.toUpperCase()] || sig.rows[h.t]) : null;
      if (sr && sr[3] != null && sig.as_of) {
        var fh = sig.as_of === ses.day ? Number(sr[3])
          : (ses.prevDay && sig.as_of === ses.prevDay ? ((1 + Number(sr[3]) / 100) * (1 + h.d / 100) - 1) * 100 : null);
        if (fh != null && isFinite(fh)) txt += (txt ? ' ' : '') + (fh >= -0.05 ? 'That is a new 52-week high.' : 'It is now ' + Math.round(Math.abs(fh)) + '% below its 52-week high.');
      }
      var hr = hist && hist.rows[h.t.toUpperCase()];
      if (hr && hr.length >= 20) {
        var nh = hr.filter(function (r) { return Math.abs(r) >= 8; }).length;
        txt += (txt ? ' ' : '') + 'It has moved 8% or more in a day on ' + (nh || 'none') + ' of the ' + hr.length + ' sessions before it.';
      }
      lines.push('<div class="mi-tline"><p class="mi-th"><b>' + esc(h.t) + '</b> ' + span(d, sgn(d)) + ' <span class="mi-tlbl">— ' + lbl + '</span></p>' + (txt ? '<p class="mi-p">' + txt + '</p>' : '') + '</div>');
    });
    if (also.length) lines.push('<p class="mi-p mi-also">' + (alsoMkt && marketDay ? 'Also with the market: ' : 'Also past 8%: ') + also.join(' · ') + '.</p>');
    var now = istLocal(), isToday = !!now && ses.day === iso(now), d0 = dt(ses.day);
    show(el, '<div class="mi-head"><h2>' + (isToday ? 'What happened today' : 'What happened on ' + esc(dshort(d0))) + '</h2>' +
      '<span class="mi-sub">' + (isToday ? esc(dshort(d0)) + ' · ' : '') + (ses.live ? 'Live prices' : 'Closing prices') + ' against the ' +
        (ses.prevDay ? esc(dshort(dt(ses.prevDay))) + ' close' : 'previous close') + '</span></div>' +
      '<div class="mi-tday">' + lines.join('') + '</div>' +
      learn(['This card appears only on a session in which your book moved more than 2.5%, or a holding more than 8%, against its previous close: the same figures as the 1D line on the profit card. A move of more than 35% in a day is treated as a split or bonus, not a move.',
             '“With the market” means the book’s index moved the same way by at least half as much; “with its ' + kind + '” means the book’s other holdings in the same ' + kind + ' did; “on its own” means neither did. It is context, not a cause: the page does not know why a price moved.',
             'Counts of earlier sessions use official NSE closes at today’s model weights.']));
  }

  // ── orchestration ────────────────────────────────────────────────────────
  var pending = null;
  function renderInsight() {
    var s = st();
    if (!s.key || !(s.stocks || []).length) return;
    var lb = s.demo ? null : liveBook(s);
    Promise.all([
      getJSON('screener/market.json'), getJSON('screener/bench-attr.json'), getJSON('screener/signals.json'),
      closesFor(s.key), getJSON('screener/backtest-months.json'), getJSON('live-history.json'),
      s.demo ? Promise.resolve(null) : benchLive(s)
    ]).then(function (v) {
      var mk = v[0], ba = v[1], sig = v[2], closes = v[3], bm = v[4], hist = v[5], bench = v[6];
      var safe = function (f) { try { f(); } catch (e) { if (W.console && console.warn) console.warn('mfc-insight:', e && e.message); } };
      safe(function () { renderNormal(s, lb, bm, hist); });            // first: the narrative reads its counts
      safe(function () { renderNarrative(s, lb, bench, mk); });
      safe(function () { renderReview(s, hist); });
      safe(function () { renderToday(s, closes, sig, mk); });        // after the review: it sits above it
      safe(function () { renderNote(s); });
      safe(function () { renderVsIndex(s, lb, bench, mk, ba, closes); });
      safe(function () { renderWeather(s, mk, s.key === 'ma' ? closes : null); });
      safe(function () { renderRisk(s, mk, ba, sig, closes); });
      safe(function () { renderYou(s, lb, closes); });
      safe(function () { renderRecord(s, hist); });
    });
  }
  function refresh(stage) {
    var s = st();
    if (!(s.stocks || []).length) return;
    tagCards();
    renderModes(s);
    // context for this cycle's changes lives in the orders view
    if (s.key) Promise.all([getJSON('screener/signals.json'), closesFor(s.key)]).then(function (v) {
      try { renderChangeContext(st(), v[0], v[1]); } catch (e) {}
    });
    if (D.documentElement.getAttribute('data-dmode') === 'insight') {
      clearTimeout(pending);
      pending = setTimeout(renderInsight, stage === 'prices' ? 30 : 120);
    }
  }

  W.mfcInsight = { refresh: refresh };
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', function () { refresh('load'); });
  else refresh('load');
})();

/* MindForge — the deep pages (V42.3)
   One small script for How it works · Track record · Risk · Methodology ·
   Compare · Learn, and for the two homepage additions (the Factor Report form and
   the "since you were last here" strip). Every block switches on only when its
   own element is on the page, and every one fails soft: no element, no data, or a
   failed request leaves the page exactly as its HTML wrote it.

   Data it reads is public and aggregate: /live-history.json, /live-perf.json,
   /screener/market.json and /screener/backtest-months.json. The only request it
   SENDS is an e-mail address the reader typed into a Factor Report form (or an
   unsubscribe key from a link in one of those e-mails). */
(function (w, d) {
  'use strict';
  var GAS = 'https://script.google.com/macros/s/AKfycbxOAkgF6naSDlx8q4mt1n3vJvd1gywpYT_iiYvt94ddYeqaniNI4ggM7idJTJHhA6RH8w/exec';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

  function ready(fn) { if (d.readyState !== 'loading') fn(); else d.addEventListener('DOMContentLoaded', fn); }
  function $(sel, root) { return (root || d).querySelector(sel); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function day(iso, withYear) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); if (!m) return '';
    return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + (withYear ? ' ' + m[1] : '');
  }
  function sgn(v, dp, unit) {
    if (v == null || !isFinite(v)) return '—';
    dp = dp == null ? 2 : dp; unit = unit == null ? '%' : unit;
    var s = Math.abs(v).toFixed(dp);
    if (Number(s) === 0) return (0).toFixed(dp) + unit;
    return (v > 0 ? '+' : '−') + s + unit;
  }
  function tone(v) { return v > 0.05 ? 'dp-up' : (v < -0.05 ? 'dp-down' : ''); }
  function track(e, l) { try { if (typeof w.mfcTrack === 'function') w.mfcTrack(e, l); } catch (x) {} }
  var memo = {};
  function getJSON(p) {
    if (!memo[p]) memo[p] = fetch(p, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return memo[p];
  }
  function post(obj) {
    return fetch(GAS, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(obj) })
      .then(function (r) { return r.json(); });
  }

  // ── 1 · entrance reveal for the deep pages (the calculator family's idiom) ──
  function reveal() {
    if (!d.body || !d.body.classList.contains('dp-page')) return;
    var els = [].slice.call(d.querySelectorAll('.fade-up'));
    if (!els.length) return;
    function all() { els.forEach(function (e) { e.classList.add('in'); }); }
    var reduce = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in w)) { all(); return; }
    var io = new IntersectionObserver(function (en) {
      en.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } });
    }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
    els.forEach(function (e) { io.observe(e); });
    setTimeout(all, 2600);                       // nothing may stay invisible
  }

  // ── 2 · the Factor Report by e-mail ─────────────────────────────────────
  function frForms() {
    [].slice.call(d.querySelectorAll('form[data-fr]')).forEach(function (f) {
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var inp = f.querySelector('input[type="email"]'), btn = f.querySelector('button'), msg = f.querySelector('.dp-fr-msg');
        var email = (inp && inp.value || '').trim();
        var say = function (t, cls) { if (msg) { msg.textContent = t; msg.className = 'dp-fr-msg' + (cls ? ' ' + cls : ''); } };
        if (!/^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(email)) { say('Please enter a valid e-mail address.', 'is-err'); if (inp) inp.focus(); return; }
        if (btn) btn.disabled = true;
        say('Adding you…', '');
        post({ action: 'subscribe_fr', email: email, source: (location.pathname || '/').slice(0, 40) })
          .then(function (r) {
            if (r && r.status === 'ok') {
              say(r.already ? 'You are already on the list.' : 'Done. A short welcome e-mail is on its way, with a one-click unsubscribe.', 'is-ok');
              if (inp) inp.value = '';
              track('fr_subscribe', location.pathname);
            } else say((r && r.error) || 'That did not go through. Please try again in a minute.', 'is-err');
          })
          .catch(function () { say('That did not go through. Please try again in a minute.', 'is-err'); })
          .then(function () { if (btn) btn.disabled = false; });
      });
    });
  }

  // ── 3 · one-click unsubscribe (the key arrives in the URL from an e-mail) ──
  function unsubscribe() {
    var box = $('#dp-unsub'); if (!box) return;
    var m = /[?&]unsub=([a-f0-9]{16,64})/i.exec(location.search || ''); if (!m) return;
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}   // the key leaves the address bar at once
    box.hidden = false;
    box.textContent = 'Taking you off the Factor Report list…';
    post({ action: 'fr_unsubscribe', key: m[1] })
      .then(function (r) {
        box.textContent = (r && r.status === 'ok' && r.unsubscribed)
          ? 'Done: you are off the Factor Report list and nothing more will be sent.'
          : 'That unsubscribe link did not match a subscription. If e-mails keep arriving, reply to one with “unsubscribe”.';
      })
      .catch(function () { box.textContent = 'That did not go through. Please open the link again in a minute, or reply to any of our e-mails with “unsubscribe”.'; });
  }

  // ── 4 · the record, every cycle (aggregate only — never a ticker) ─────────
  var BOOKS = [['ma', 'MultiAsset'], ['lm', 'LargeMidcap 250'], ['sm', 'SmallMicro 500']];
  function ledger() {
    var root = $('#dp-ledger-root'); if (!root) return;
    Promise.all([getJSON('/live-history.json'), getJSON('/live-perf.json')]).then(function (v) {
      var h = v[0], p = v[1];
      if (!h || !h.cycles || !h.cycles.length) return;
      var html = '';
      BOOKS.forEach(function (b) {
        var key = b[0];
        var cyc = h.cycles.filter(function (c) { return c.strategies && c.strategies[key] && c.strategies[key].live_pct != null && c.strategies[key].bench_pct != null; });
        if (!cyc.length) return;
        var sealed = cyc.filter(function (c) { return c.sealed; });
        var ahead = sealed.filter(function (c) { var x = c.strategies[key]; return x.live_pct - x.bench_pct > 0.05; }).length;
        var m = 1, ix = 1, scale = 1;
        cyc.forEach(function (c) { var x = c.strategies[key]; m *= 1 + x.live_pct / 100; ix *= 1 + x.bench_pct / 100; scale = Math.max(scale, Math.abs(x.live_pct), Math.abs(x.bench_pct)); });
        var bname = cyc[cyc.length - 1].strategies[key].bench_name || 'its index';
        var pos = function (v) { return (50 + v / scale * 50).toFixed(2) + '%'; };
        var rows = cyc.map(function (c) {
          var x = c.strategies[key], gap = x.live_pct - x.bench_pct;
          var lo = Math.min(0, x.live_pct), hi = Math.max(0, x.live_pct);
          var bar = '<div class="dp-bar" role="img" aria-label="' + esc('Model ' + sgn(x.live_pct) + ', index ' + sgn(x.bench_pct)) + '"><i class="' + (x.live_pct >= 0 ? 'dp-b-up' : 'dp-b-dn') + '" style="left:' + pos(lo) + ';right:' + (100 - parseFloat(pos(hi))).toFixed(2) + '%"></i><b style="left:' + pos(x.bench_pct) + '"></b></div>';
          return '<tr><td>' + day(c.rebalance_date, true) + '</td><td>' + day(c.data_through) + ' close</td>' +
            '<td class="' + tone(x.live_pct) + '" data-l="Model">' + sgn(x.live_pct) + '</td><td class="' + tone(x.bench_pct) + '" data-l="Index">' + sgn(x.bench_pct) + '</td>' +
            '<td class="' + tone(gap) + '" data-l="Difference">' + sgn(gap, 2, ' pts') + '</td><td>' + bar + '</td>' +
            '<td><span class="dp-tag ' + (c.sealed ? 'is-sealed">Closed' : 'is-open">In progress') + '</span></td></tr>';
        }).join('');
        html += '<div class="dp-ledger-wrap"><table class="dp-ledger"><caption>MindForge ' + b[1] + ' <span class="dp-note" style="font-weight:500">against the ' + esc(bname) + '</span></caption>' +
          '<thead><tr><th scope="col">Rebalance</th><th scope="col">Measured to</th><th scope="col">Model</th><th scope="col">Index</th><th scope="col">Difference</th><th scope="col"><span class="sr-only">Chart</span></th><th scope="col">Status</th></tr></thead>' +
          '<tbody>' + rows + '</tbody></table></div>' +
          '<p class="dp-note">' + (sealed.length ? 'Ahead of the index in <b>' + ahead + ' of ' + sealed.length + '</b> closed ' + (sealed.length === 1 ? 'cycle' : 'cycles') + '. ' : '') +
          'Compounded over all ' + cyc.length + ' ' + (cyc.length === 1 ? 'cycle' : 'cycles') + (cyc[cyc.length - 1].sealed ? '' : ' (the newest still running)') + ': model <span class="' + tone((m - 1) * 100) + '">' + sgn((m - 1) * 100) + '</span>, index <span class="' + tone((ix - 1) * 100) + '">' + sgn((ix - 1) * 100) + '</span>.</p>';
      });
      if (!html) return;
      var nSealed = h.cycles.filter(function (c) { return c.sealed; }).length;
      root.innerHTML = html +
        '<p class="dp-note">' + (nSealed < 6 ? nSealed + ' closed ' + (nSealed === 1 ? 'cycle is' : 'cycles are') + ' far too few to judge a strategy; each month adds one. ' : '') +
        'Bars share one scale per book; the tick is the index.' + (p && p.data_through ? ' Data to the ' + day(p.data_through, true) + ' close.' : '') + '</p>';
      var basis = $('#dp-ledger-basis');
      if (basis && p && p.basis) basis.textContent = p.basis;
    });
  }

  // ── 5 · market weather (Learn hub) ────────────────────────────────────────
  var LONG = {
    'rising-calm': 'Steady, rising markets are the conditions in which strategies that rank stocks on their recent trends have historically done best: leadership tends to persist from one month to the next.',
    'rising-nervous': 'Trends are still up, but daily swings are larger than usual and leadership can rotate quickly.',
    'falling': 'In a falling market most stocks fall together, and a book of recent leaders usually falls too; for such a book the useful number is the gap to its index, not the sign of the return.',
    'rebound': 'Sharp rebounds after a fall are the months in which strategies that rank on recent trends have historically lagged most: the previous quarter’s laggards often lead the bounce (Daniel & Moskowitz, “Momentum Crashes”, 2016).',
    'steadying': 'With the index below its long-run average but no longer falling, leadership is unsettled: trends are shorter and less reliable than in a steady rise.'
  };
  function crore(v) { return v == null || !isFinite(v) ? '—' : '<span style="white-space:nowrap">' + (v < 0 ? '−' : '+') + '₹' + Math.round(Math.abs(v)).toLocaleString('en-IN') + ' cr</span>'; }
  function weather() {
    var root = $('#dp-weather-root'); if (!root) return;
    getJSON('/screener/market.json').then(function (mk) {
      if (!mk || !mk.indices || !mk.indices.nifty50) return;
      var n = mk.indices.nifty50, rows = [];
      if (n.vs200 != null) rows.push(['Trend', 'The Nifty 50 is <b>' + Math.abs(n.vs200).toFixed(1) + '% ' + (n.vs200 >= 0 ? 'above' : 'below') + '</b> its 200-day average.']);
      if (mk.breadth) rows.push(['Breadth', '<b>' + Math.round(mk.breadth.above200) + '%</b> of ' + Number(mk.breadth.n).toLocaleString('en-IN') + ' NSE stocks are above their 200-day average, and ' + Math.round(mk.breadth.above50) + '% above their 50-day.']);
      if (mk.vix && mk.vix.last != null) rows.push(['Volatility', 'India VIX <b>' + mk.vix.last.toFixed(1) + '</b>, higher than ' + mk.vix.pctile_1y + '% of the past year’s readings.']);
      if (mk.flows) rows.push(['Flows', 'Over the last ' + mk.flows.days + ' sessions FIIs sold on <b>' + mk.flows.fii_sell_days + '</b> (net ' + crore(mk.flows.fii_net_cr) + ') and DIIs bought on <b>' + mk.flows.dii_buy_days + '</b> (net ' + crore(mk.flows.dii_net_cr) + ').']);
      var sc = mk.indices.smallcap250;
      if (sc && sc.m1 != null && n.m1 != null) rows.push(['Size', 'Over the last month the Nifty Smallcap 250 moved <span class="' + tone(sc.m1) + '">' + sgn(sc.m1, 1) + '</span> against <span class="' + tone(n.m1) + '">' + sgn(n.m1, 1) + '</span> for the Nifty 50.']);
      var ss = (mk.styles || []).filter(function (x) { return x.m1 != null; }).sort(function (a, b) { return b.m1 - a.m1; });
      if (ss.length) rows.push(['Style', ss.map(function (x) { return esc(x.short) + ' <span class="' + tone(x.m1) + '">' + sgn(x.m1, 1) + '</span>'; }).join(' · ') + ' over the last month, through ETFs that track NSE’s factor indices.']);
      var key = mk.regime && mk.regime.key;
      root.innerHTML = '<p>' + (mk.regime ? 'Today’s reading: <span class="dp-pill is-' + esc(key) + '">' + esc(mk.regime.label) + '</span> ' : '') + '<span class="dp-note">to the ' + day(mk.as_of, true) + ' close</span></p>' +
        '<div class="dp-rows">' + rows.map(function (r) { return '<div class="dp-row"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>'; }).join('') + '</div>' +
        (key && LONG[key] ? '<p>' + LONG[key] + ' <span class="dp-note">General research, not a forecast.</span></p>' : '') +
        '<p class="dp-note">Sources: NSE official closes and FII/DII provisional data; Yahoo Finance for index levels and India VIX; the MindForge stock snapshot for breadth. The label follows published rules: the trend is the Nifty 50 against its 200-session average, “nervous” is India VIX at or above its 70th percentile of the past year, and a rebound is the index at least 5% off a 3-month low after a fall of 8% or more.</p>';
    });
  }

  // ── 6 · the backtest's monthly range (Risk page) ─────────────────────────
  function q(a, p) { var x = (a.length - 1) * p, lo = Math.floor(x), hi = Math.ceil(x); return a[lo] + (a[hi] - a[lo]) * (x - lo); }
  function ranges() {
    var els = [].slice.call(d.querySelectorAll('[data-dp-range]')); if (!els.length) return;
    getJSON('/screener/backtest-months.json').then(function (bm) {
      if (!bm || !bm.books) return;
      els.forEach(function (el) {
        var b = bm.books[el.getAttribute('data-dp-range')]; if (!b || !b.months || b.months.length < 12) return;
        var v = b.months.map(function (m) { return m[1]; }).sort(function (a, c) { return a - c; });
        var lo = v[0], hi = v[v.length - 1], p10 = q(v, 0.1), p50 = q(v, 0.5), p90 = q(v, 0.9), sp = (hi - lo) || 1;
        var neg = v.filter(function (x) { return x < 0; }).length;
        var pos = function (x) { return ((x - lo) / sp * 100).toFixed(2) + '%'; };
        el.innerHTML = '<p>' + b.n + ' backtest months' + (b.range ? ' (' + esc(b.range.replace(/\s*·.*$/, '')) + ')' : '') + ': <b>' + neg + '</b> ended negative; the middle 80% ended between ' + sgn(p10, 1) + ' and ' + sgn(p90, 1) + ', the median month was ' + sgn(p50, 1) + ', the worst <span class="dp-down">' + sgn(lo, 1) + '</span> and the best <span class="dp-up">' + sgn(hi, 1) + '</span>.</p>' +
          '<div class="dp-range" role="img" aria-label="' + esc('Monthly backtest returns from ' + sgn(lo, 1) + ' to ' + sgn(hi, 1) + ', middle 80% between ' + sgn(p10, 1) + ' and ' + sgn(p90, 1)) + '">' +
          '<span class="r-track"></span><span class="r-band" style="left:' + pos(p10) + ';width:' + ((p90 - p10) / sp * 100).toFixed(2) + '%"></span>' +
          '<span class="r-tick" style="left:' + pos(p50) + '"></span>' +
          '<span class="r-lbl" style="left:0">' + sgn(lo, 1) + '</span><span class="r-lbl" style="right:0">' + sgn(hi, 1) + '</span></div>' +
          '<p class="dp-note">Backtest, before tax: the same months the strategy page’s calendar prints. Shaded: the middle 80% of months; the tick is the median.</p>';
      });
    });
  }

  // ── 7 · since you were last here (homepage; never for a member) ───────────
  function since() {
    var root = $('#dp-since-root'); if (!root) return;
    var get = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
    var set = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };
    if (get('mfc_since_off') === '1') return;
    if (/(?:^|;\s*)mfc_dash_token=/.test(d.cookie || '') || get('mfc_dash_token')) return;   // members have their dashboard
    getJSON('/live-history.json').then(function (h) {
      if (!h || !h.cycles || !h.cycles.length) return;
      var last = h.cycles[h.cycles.length - 1];
      var now = Date.now(), prev = null;
      try { prev = JSON.parse(get('mfc_since_v1') || 'null'); } catch (e) { prev = null; }
      set('mfc_since_v1', JSON.stringify({ t: now, rd: last.rebalance_date, dt: last.data_through }));
      if (!prev || !prev.t || (now - prev.t) < 12 * 3600e3) return;              // a refresh is not a return visit
      var when = new Date(prev.t), whenTxt = when.getDate() + ' ' + MONTHS[when.getMonth()];
      var msg = '';
      if (prev.rd && last.rebalance_date > prev.rd) msg = 'Since your last visit on ' + whenTxt + ', a new cycle opened on ' + day(last.rebalance_date) + '. <a href="/track-record/">See every cycle so far</a>';
      else if (prev.dt && last.data_through > prev.dt) msg = 'Since your last visit on ' + whenTxt + ', the live record has moved on to the ' + day(last.data_through) + ' close. <a href="/track-record/">See every cycle so far</a>';
      if (!msg) return;                                                            // nothing changed: say nothing
      root.innerHTML = '<p class="dp-since" role="status">' + msg + '<button type="button" data-since-off>Don’t remember my visits</button></p>';
      root.hidden = false;
      track('return_news', last.rebalance_date > (prev.rd || '') ? 'cycle' : 'data');
      var off = root.querySelector('[data-since-off]');
      if (off) off.addEventListener('click', function () { set('mfc_since_off', '1'); try { localStorage.removeItem('mfc_since_v1'); } catch (e) {} root.hidden = true; root.innerHTML = ''; });
    });
  }

  // ── 8 · hand-raise clicks (page name only, never a message) ───────────────
  function handRaise() {
    d.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[data-track]');
      if (a) track(a.getAttribute('data-track'), location.pathname);
    });
  }

  ready(function () {
    [reveal, frForms, unsubscribe, ledger, weather, ranges, since, handRaise].forEach(function (f) { try { f(); } catch (e) {} });
  });
})(window, document);

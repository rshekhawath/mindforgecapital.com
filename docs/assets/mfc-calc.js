/* ════════════════════════════════════════════════════════════════════════════
   mfc-calc.js — V37.7
   The engine behind /calculators/*. One page declares its fields and a pure
   compute() function; everything else — the inputs, the slider sync, the
   clamping, the result panel, the split bar and the year chart — is here, so
   seven calculators cannot drift into seven behaviours.

   Rules this file holds to, all of them the site's existing ones:
   · Money is formatted in the Indian system (lakh / crore), never a raw float.
   · A field is CLAMPED to its declared range on blur, not while typing — a
     half-typed "1" must not become "1,000" under the member's cursor.
   · compute() is pure: same inputs, same output. Nothing in it touches the DOM,
     so the validation suite can call it directly and compare against arithmetic
     done independently.
   · Every figure the panel prints carries the unit it is in, and every
     assumption the maths makes is stated on the page, not implied.
   · No dependency, no network, no storage. The numbers never leave the browser.
   ════════════════════════════════════════════════════════════════════════════ */
(function (w, d) {
  "use strict";

  /* ── formatting ─────────────────────────────────────────────────────────── */
  function round(n) { return Math.round(Number(n) || 0); }

  // Indian digit grouping: 12,34,567 — Intl does this correctly for en-IN, and
  // falls back to a hand-rolled grouping where Intl is unavailable.
  function group(n) {
    n = round(Math.abs(n));
    try { return n.toLocaleString('en-IN'); } catch (e) {}
    var s = String(n), last3 = s.slice(-3), rest = s.slice(0, -3);
    if (!rest) return last3;
    return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }
  function inr(n) { return (n < 0 ? '−' : '') + '₹' + group(n); }
  // A committed figure keeps two significant decimals of a lakh/crore — ₹3.97L,
  // never ₹4L (the V35.5 preciseMoney rule: a rounded total reads as more than
  // it is).
  function compact(n) {
    var a = Math.abs(Number(n) || 0), sign = n < 0 ? '−' : '';
    if (a >= 1e7) return sign + '₹' + (a / 1e7).toFixed(2).replace(/\.00$/, '') + 'Cr';
    if (a >= 1e5) return sign + '₹' + (a / 1e5).toFixed(2).replace(/\.00$/, '') + 'L';
    if (a >= 1e3) return sign + '₹' + group(a);
    return sign + '₹' + round(a);
  }
  function pct(n, dp) { return (Number(n) || 0).toFixed(dp == null ? 1 : dp) + '%'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* ── the shared finance maths, kept in one place ────────────────────────── */
  var math = {
    // SIP: instalments at the START of each month (the convention every Indian
    // SIP calculator uses, and the one the page states in its assumptions).
    sipFV: function (monthly, annualPct, years) {
      var i = annualPct / 100 / 12, n = Math.round(years * 12);
      if (!n) return 0;
      if (Math.abs(i) < 1e-12) return monthly * n;
      return monthly * ((Math.pow(1 + i, n) - 1) / i) * (1 + i);
    },
    // the monthly instalment that reaches a target — the inverse of sipFV
    sipForTarget: function (target, annualPct, years) {
      var i = annualPct / 100 / 12, n = Math.round(years * 12);
      if (!n) return 0;
      if (Math.abs(i) < 1e-12) return target / n;
      return target * i / ((Math.pow(1 + i, n) - 1) * (1 + i));
    },
    lumpFV: function (amount, annualPct, years) {
      return amount * Math.pow(1 + annualPct / 100, years);
    },
    // EMI, the standard reducing-balance instalment
    emi: function (principal, annualPct, years) {
      var r = annualPct / 100 / 12, n = Math.round(years * 12);
      if (!n) return 0;
      if (Math.abs(r) < 1e-12) return principal / n;
      var f = Math.pow(1 + r, n);
      return principal * r * f / (f - 1);
    },
    real: function (nominal, inflPct, years) {
      return nominal / Math.pow(1 + inflPct / 100, years);
    }
  };

  /* ── input rows ─────────────────────────────────────────────────────────── */
  function fieldHTML(f, id) {
    var pre = f.unit === 'money' ? '₹' : '';
    var suf = f.unit === 'pct' ? '%' : (f.unit === 'years' ? (f.sufLabel || 'yrs') : (f.suffix || ''));
    // A money field is a TEXT input carrying Indian grouping: ₹50,00,000 is
    // readable at a glance and 5000000 is not, and a number input cannot show
    // separators. Everything else stays a real number input so the spinner,
    // the decimal keypad and native validation are kept.
    var money = f.unit === 'money';
    return '' +
      '<div class="cf" data-f="' + esc(f.k) + '">' +
        '<div class="cf-top">' +
          '<label class="cf-lbl" for="' + id + '">' + esc(f.label) +
            (f.hint ? '<span class="cf-hint">' + esc(f.hint) + '</span>' : '') +
          '</label>' +
          '<span class="cf-shell">' +
            (pre ? '<span class="cf-pre" aria-hidden="true">' + pre + '</span>' : '') +
            '<input class="cf-in" id="' + id + '" ' +
              (money ? 'type="text" inputmode="numeric" autocomplete="off"'
                     : 'type="number" inputmode="' + (f.step && f.step < 1 ? 'decimal' : 'numeric') +
                       '" step="' + (f.step || 1) + '" min="' + f.min + '" max="' + f.max + '"') +
              ' value="' + (money ? group(f.value) : f.value) + '">' +
            (suf ? '<span class="cf-suf" aria-hidden="true">' + esc(suf) + '</span>' : '') +
          '</span>' +
        '</div>' +
        '<input class="cf-rng" type="range" min="' + f.min + '" max="' + f.max + '" step="' + (f.step || 1) + '" ' +
          'value="' + f.value + '" tabindex="-1" aria-hidden="true">' +
        '<div class="cf-ends"><span>' + esc(f.minLabel || labelFor(f, f.min)) + '</span>' +
          '<span>' + esc(f.maxLabel || labelFor(f, f.max)) + '</span></div>' +
        '<div class="cf-err" role="status">Enter a value between ' + esc(labelFor(f, f.min)) +
          ' and ' + esc(labelFor(f, f.max)) + '.</div>' +
      '</div>';
  }
  function labelFor(f, v) {
    if (f.unit === 'money') return compact(v);
    if (f.unit === 'pct') return pct(v, v % 1 ? 1 : 0);
    if (f.unit === 'years') return v + (v === 1 ? ' yr' : ' yrs');
    return String(v);
  }

  /* ── the result panel ───────────────────────────────────────────────────── */
  function statHTML(s) {
    return '<div class="co-stat"><div class="k">' + esc(s.k) + '</div>' +
      '<div class="v' + (s.tone ? ' ' + s.tone : '') + '">' + esc(s.v) + '</div>' +
      (s.s ? '<div class="s">' + esc(s.s) + '</div>' : '') + '</div>';
  }

  function barsHTML(bars, keys, tone) {
    if (!bars || !bars.length) return '';
    var max = 0;
    bars.forEach(function (b) { max = Math.max(max, (b.a || 0) + (b.b || 0)); });
    if (max <= 0) return '';
    var n = bars.length;
    var every = n <= 12 ? 1 : (n <= 26 ? 2 : Math.ceil(n / 12));
    var cols = bars.map(function (b, i) {
      var ha = (b.a || 0) / max * 100, hb = (b.b || 0) / max * 100;
      var show = (i === 0 || i === n - 1 || (i + 1) % every === 0);
      return '<span class="cb" title="' + esc(b.label + ': ' + inr((b.a || 0) + (b.b || 0))) + '">' +
        '<span class="cb-stack">' +
          '<i class="cb-b" data-h="' + hb.toFixed(2) + '%" style="height:0%"></i>' +
          '<i class="cb-a" data-h="' + ha.toFixed(2) + '%" style="height:0%"></i>' +
        '</span>' +
        '<span class="cb-x">' + (show ? esc(b.label) : '') + '</span>' +
      '</span>';
    }).join('');
    // An empty key would paint a lone swatch with no label — the orphaned-item
    // shape this codebase has fixed twice. Only labelled series get a legend.
    return '<div class="cbars' + (tone === 'cost' ? ' is-cost' : '') + '" aria-hidden="true">' + cols + '</div>' +
      '<div class="co-keys' + (tone === 'cost' ? ' is-cost' : '') + '" aria-hidden="true">' +
        (keys.a ? '<span class="ka"><i></i>' + esc(keys.a) + '</span>' : '') +
        (keys.b ? '<span class="kb"><i></i>' + esc(keys.b) + '</span>' : '') +
      '</div>';
  }

  function render(host, out) {
    var fig = out.fig || {};
    var html = '' +
      '<div class="co-k">' + esc(fig.k || 'Result') + '</div>' +
      '<div class="co-fig' + (fig.tone ? ' ' + fig.tone : '') + '">' + esc(fig.v || '—') + '</div>' +
      (fig.cap ? '<p class="co-cap">' + fig.cap + '</p>' : '') +
      (out.stats && out.stats.length ? '<div class="co-stats">' + out.stats.map(statHTML).join('') + '</div>' : '');

    if (out.split) {
      var a = Math.max(0, out.split.a.v), b = Math.max(0, out.split.b.v), t = a + b;
      var pa = t > 0 ? (a / t * 100) : 100;
      html += '<div class="co-split' + (out.tone === 'cost' ? ' is-cost' : '') + '">' +
        '<div class="co-bar" role="img" aria-label="' + esc(out.split.a.k + ' ' + inr(a) + ', ' +
          out.split.b.k + ' ' + inr(b)) + '">' +
          '<span class="co-seg is-a" data-w="' + pa.toFixed(2) + '%"></span>' +
          '<span class="co-seg is-b" data-w="' + (100 - pa).toFixed(2) + '%"></span>' +
        '</div>' +
        '<div class="co-keys"><span class="ka"><i></i>' + esc(out.split.a.k) + ' <b>' + esc(inr(a)) + '</b></span>' +
        '<span class="kb"><i></i>' + esc(out.split.b.k) + ' <b>' + esc(inr(b)) + '</b></span></div>' +
      '</div>';
    }
    if (out.bars && out.bars.length) {
      html += '<div class="co-chart"><div class="co-chart-h"><span class="t">' +
        esc(out.barsTitle || 'Year by year') + '</span>' +
        (out.barsNote ? '<span class="n">' + esc(out.barsNote) + '</span>' : '') + '</div>' +
        barsHTML(out.bars, out.barKeys || { a: 'Invested', b: 'Returns' }, out.tone) + '</div>';
    }
    if (out.note) html += '<div class="co-note">' + out.note + '</div>';
    host.innerHTML = html;

    // grow the split bar AND the year columns from zero on the next frame —
    // the site's bar idiom; a bar painted at its final size has a dead
    // transition (V23.5). The year chart shipped without this in V37.7 (only
    // the split bar above got it); same fix, same mechanism, one paint pass.
    var segs = host.querySelectorAll('.co-seg[data-w]');
    var bars = host.querySelectorAll('.cb-a[data-h], .cb-b[data-h]');
    // V38.0: these elements are brand-new (just written via innerHTML above),
    // so their 0% state has never actually been committed to a rendered frame
    // — requestAnimationFrame alone let the browser coalesce the 0% write and
    // the target-size write into one style recalc, so the transition never
    // started (confirmed: bars snapped straight to final size on every load
    // and every input change). Forcing a synchronous layout read commits the
    // 0% state first, so the following rAF write is a genuine second frame.
    void host.offsetHeight;
    var paint = function () {
      segs.forEach(function (s) { s.style.width = s.dataset.w; });
      bars.forEach(function (b) { b.style.height = b.dataset.h; });
    };
    w.requestAnimationFrame ? w.requestAnimationFrame(paint) : paint();
    setTimeout(paint, 160);
  }

  /* ── wiring ─────────────────────────────────────────────────────────────── */
  function init(cfg) {
    var form = d.getElementById(cfg.formId || 'calc-fields');
    var host = d.getElementById(cfg.outId || 'calc-out');
    if (!form || !host) return null;

    var state = {}, fields = cfg.fields.slice(), mode = cfg.modes ? cfg.modes.options[0].k : null;

    function fieldsFor(m) {
      if (!cfg.modes || !m) return fields;
      var o = cfg.modes.options.filter(function (x) { return x.k === m; })[0] || {};
      return fields.map(function (f) {
        var over = (o.fields || {})[f.k];
        return over ? Object.assign({}, f, over) : f;
      });
    }

    function build() {
      var fs = fieldsFor(mode);
      form.innerHTML = fs.map(function (f, i) { return fieldHTML(f, (cfg.key || 'c') + '-f' + i); }).join('');
      fs.forEach(function (f) { state[f.k] = f.value; });
      form.querySelectorAll('.cf').forEach(function (row) {
        var f = fs.filter(function (x) { return x.k === row.dataset.f; })[0];
        var num = row.querySelector('.cf-in'), rng = row.querySelector('.cf-rng');
        var money = f.unit === 'money';
        var read = function () {
          return money ? parseFloat(String(num.value).replace(/[^0-9.]/g, '')) : parseFloat(num.value);
        };
        var show = function (v) { num.value = money ? group(v) : v; };
        var fill = function () {
          var p = (state[f.k] - f.min) / (f.max - f.min) * 100;
          rng.style.setProperty('--fill', clamp(p, 0, 100).toFixed(1) + '%');
        };
        var commit = function (v, fromRange) {
          var bad = !isFinite(v);
          if (!bad && (v < f.min || v > f.max)) bad = true;
          row.classList.toggle('is-bad', bad && !fromRange);
          state[f.k] = clamp(isFinite(v) ? v : f.value, f.min, f.max);
          if (fromRange) show(state[f.k]);
          rng.value = state[f.k];
          fill(); run();
        };
        num.addEventListener('input', function () { commit(read(), false); });
        // Clamped and re-grouped on BLUR, never mid-keystroke: a half-typed "1"
        // must not turn into "1,00,000" under the cursor.
        num.addEventListener('blur', function () {
          show(state[f.k]); row.classList.remove('is-bad'); run();
        });
        rng.addEventListener('input', function () { commit(parseFloat(rng.value), true); });
        fill();
      });
    }

    var sayT = null;
    function announce(out) {
      var el = d.getElementById('calc-status');
      if (!el || !out || !out.fig) return;
      if (sayT) clearTimeout(sayT);
      // A live region on the whole panel re-reads every figure on every
      // keystroke. One sentence, once the typing stops, is the readable form.
      sayT = setTimeout(function () { el.textContent = out.fig.k + ': ' + out.fig.v + '.'; }, 700);
    }
    // Reuses the dashboard's mf106 idiom (size-summary / donut-centre "pop"):
    // the headline result already redraws on every keystroke and every slider
    // pixel, so a pop on EACH render would thrash. Fire it only once the value
    // has actually settled — same 400ms debounce, first paint never pops.
    var popT = null, lastFigV = null, popSeeded = false;
    function maybePop(out) {
      if (!out || !out.fig) return;
      var v = out.fig.v;
      if (!popSeeded) { popSeeded = true; lastFigV = v; return; }
      if (v === lastFigV) return;
      lastFigV = v;
      if (popT) clearTimeout(popT);
      popT = setTimeout(function () {
        var reduce = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce) return;
        var el = host.querySelector('.co-fig');
        if (!el) return;
        el.classList.remove('mfc-pop'); void el.offsetWidth; el.classList.add('mfc-pop');
      }, 400);
    }
    function run() {
      var out;
      try { out = cfg.compute(Object.assign({}, state), mode); }
      catch (e) { return; }
      if (out) { render(host, out); announce(out); maybePop(out); }
      if (typeof cfg.onRender === 'function') { try { cfg.onRender(out, Object.assign({}, state), mode); } catch (e) {} }
    }

    if (cfg.modes) {
      var bar = d.getElementById(cfg.modesId || 'calc-modes');
      if (bar) {
        bar.innerHTML = cfg.modes.options.map(function (o, i) {
          return '<button type="button" data-m="' + esc(o.k) + '" aria-pressed="' + (i === 0) + '">' +
            esc(o.label) + '</button>';
        }).join('');
        bar.addEventListener('click', function (ev) {
          var b = ev.target && ev.target.closest ? ev.target.closest('button[data-m]') : null;
          if (!b || b.dataset.m === mode) return;
          mode = b.dataset.m;
          bar.querySelectorAll('button').forEach(function (x) {
            x.setAttribute('aria-pressed', String(x.dataset.m === mode));
          });
          build(); run();
        });
      }
    }

    build(); run();
    return { run: run, state: function () { return Object.assign({}, state); },
             setMode: function (m) { mode = m; build(); run(); } };
  }

  w.MFCalc = { init: init, inr: inr, compact: compact, pct: pct, group: group, round: round,
               clamp: clamp, esc: esc, math: math };

  /* ── entrance reveal (V19.1's calculator.html idiom, ported here so all
     seven pages share one copy) — defensive, additive, reduced-motion + no-IO
     safe; a safety-net timeout guarantees nothing is left permanently invisible. */
  function ready(fn) { if (d.readyState !== 'loading') fn(); else d.addEventListener('DOMContentLoaded', fn); }
  ready(function () {
    try {
      var els = [].slice.call(d.querySelectorAll('.fade-up'));
      if (!els.length) return;
      function showAll() { els.forEach(function (e) { e.classList.add('in'); }); }
      var reduce = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce || !('IntersectionObserver' in w)) { showAll(); return; }
      var io = new IntersectionObserver(function (ents) {
        ents.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
      }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
      els.forEach(function (e) { io.observe(e); });
      setTimeout(showAll, 2600);
    } catch (e) {}
  });
})(window, document);

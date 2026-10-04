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
   V39.7 added two things every page can opt into: a choice field
   (unit:'choice', a pressed-button row for a short fixed list) and a
   year-by-year table (out.table, rendered into #calc-table when the page has
   one). The section grew from seven calculators to fifteen on this engine.
   V40.4 gave every result the Fee Calculator's "keep it" tools and a few more:
   copy this scenario (the inputs ride in the link and are restored on load),
   pin to compare, the year table as a CSV, print, reset — and, where the result
   sits below the inputs (one column, ≤980px), a strip at the top of the inputs
   that stays in view and carries the live figure while the sliders move.
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
  // V39.7 — a negative rate carries the true minus sign the money figures use
  // (−₹1,200, −0.80%), and a value that rounds to zero never prints "-0.0%".
  function pct(n, dp) {
    n = Number(n) || 0;
    var s = Math.abs(n).toFixed(dp == null ? 1 : dp);
    return (n < 0 && Number(s) !== 0 ? '−' : '') + s + '%';
  }
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
  // V39.7 — a CHOICE field: a short fixed list (compounding frequency, a PPF
  // tenure) as a row of pressed/unpressed buttons, the same control the EMI
  // page's loan-type bar uses. A slider over four discrete values would
  // pretend the values in between exist.
  function choiceHTML(f, id) {
    return '' +
      '<div class="cf cf-choice" data-f="' + esc(f.k) + '">' +
        '<div class="cf-top"><span class="cf-lbl" id="' + id + '-l">' + esc(f.label) +
          (f.hint ? '<span class="cf-hint">' + esc(f.hint) + '</span>' : '') + '</span></div>' +
        '<div class="cmodes cf-opts' + (f.pairs ? ' cf-opts-2' : '') + '" role="group" aria-labelledby="' + id + '-l">' +
          f.options.map(function (o) {
            return '<button type="button" data-v="' + esc(o.v) + '" aria-pressed="' + (o.v === f.value) + '">' +
              esc(o.label) + '</button>';
          }).join('') +
        '</div>' +
      '</div>';
  }
  function fieldHTML(f, id) {
    if (f.unit === 'choice') return choiceHTML(f, id);
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
        (f._scale
          ? '<input class="cf-rng" type="range" min="0" max="1000" step="1" ' +
              'value="' + Math.round(scalePos(f._scale, f.value) * 1000) + '" tabindex="-1" aria-hidden="true">'
          : '<input class="cf-rng" type="range" min="' + f.min + '" max="' + f.max + '" step="' + (f.step || 1) + '" ' +
              'value="' + f.value + '" tabindex="-1" aria-hidden="true">') +
        ticksHTML(f) +
        '<div class="cf-err" role="status">Enter a value between ' + esc(labelFor(f, f.min)) +
          ' and ' + esc(labelFor(f, f.max)) + '.</div>' +
      '</div>';
  }
  /* ── V39.9 · BREAK POINTS AND WHOLE-NUMBER NOTCHES ─────────────────────────
     The owner asked for each slider to have "a break … points in between which
     are whole numbers like 10 L, 25 L, 50L, 1 CR, 5 CR, 10 CR and then finally
     20 CR". So a money slider is now a row of labelled break points spaced
     EVENLY along the track, and between two breaks the thumb moves through a
     ladder of round values (1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 7.5, 8, 9 × each
     power of ten) — clicking from notch to notch, never landing on
     ₹24,87,311. Equal spacing is what lets 10Cr and 20Cr both carry a label (on
     a plain log track they sit 5% apart), and it gives every band — ₹1L–₹10L,
     ₹10L–₹25L, … — the same room. A field may name its own breaks
     (`breaks:[…]`); otherwise they are the powers of ten, then the 5s, then the
     2.5s, up to eight. Typing still takes any exact value; the thumb then sits
     on the nearest notch. Percent and year sliders keep their steps and gain
     labelled whole-number points too. */
  var RUNGS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 7.5, 8, 9];
  function ladder(min, max, step) {
    var out = [min], lo = Math.max(min, step || 1, 1);
    for (var k = Math.floor(Math.log(lo) / Math.LN10); Math.pow(10, k) <= max; k++) {
      RUNGS.forEach(function (m) {
        var v = Math.round(m * Math.pow(10, k));
        if (v > min && v < max && v >= lo) out.push(v);
      });
    }
    out.push(max);
    return out.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
  }
  function nearestIdx(stops, v) {
    var best = 0, bd = Infinity;
    for (var i = 0; i < stops.length; i++) {
      var a = stops[i], d = (a > 0 && v > 0) ? Math.abs(Math.log(a / v)) : Math.abs(a - v) / Math.max(1, Math.abs(v));
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function breaksFor(f, rungs) {
    if (f.breaks) return f.breaks.filter(function (v) { return v >= f.min && v <= f.max; });
    var out = [f.min, f.max], MAX = 8;
    [1, 5, 2.5].forEach(function (m) {
      for (var k = 12; k >= 0; k--) {
        var v = Math.round(m * Math.pow(10, k));
        if (out.length < MAX && v > f.min && v < f.max && rungs.indexOf(v) >= 0) out.push(v);
      }
    });
    return out.sort(function (a, b) { return a - b; });
  }
  // rung values, their positions (0..1) and the labelled breaks
  function moneyScale(f) {
    var rungs = ladder(f.min, f.max, f.step);
    var br = breaksFor(f, rungs);
    br.forEach(function (b) { if (rungs.indexOf(b) < 0) rungs.push(b); });
    rungs.sort(function (a, b) { return a - b; });
    var bi = br.map(function (b) { return rungs.indexOf(b); }), pos = [];
    for (var s = 0; s < bi.length - 1; s++) {
      for (var i = bi[s]; i < bi[s + 1]; i++) pos[i] = (s + (i - bi[s]) / (bi[s + 1] - bi[s])) / (bi.length - 1);
    }
    pos[rungs.length - 1] = 1;
    return { rungs: rungs, pos: pos, ticks: br.map(function (b, i) { return { v: b, p: i / (br.length - 1) }; }) };
  }
  function shortMoney(v) {
    if (v >= 1e7) return '₹' + +(v / 1e7).toFixed(2) + 'Cr';
    if (v >= 1e5) return '₹' + +(v / 1e5).toFixed(2) + 'L';
    if (v >= 1e3) return '₹' + +(v / 1e3).toFixed(1) + 'k';
    return '₹' + round(v);
  }
  // years carry their unit on the two ends only ("1 yr · 10 · 20 · 40 yrs"):
  // "35 yrs · 40 yrs" did not fit side by side on a 320px phone
  function tickLabel(f, v, end) {
    if (f.unit === 'money') return shortMoney(v);
    if (f.unit === 'pct') return +v.toFixed(2) + '%';
    if (f.unit === 'years') return end ? v + (v === 1 ? ' yr' : ' yrs') : String(v);
    return String(v);
  }
  /* Labels that would touch on THIS screen lose their text (the notch mark
     stays). Ends first, then powers of ten, then the rest left to right, each
     kept only with 4px of air on both sides — so a desktop shows all eight
     corpus breaks and a 320px phone drops the one or two that cannot fit. */
  function fitTicks(root) {
    [].forEach.call((root || d).querySelectorAll('.cf-ticks'), function (row) {
      var sp = [].slice.call(row.querySelectorAll('span'));
      sp.forEach(function (x) { x.classList.remove('hx'); });
      if (!row.getClientRects().length) return;
      var order = sp.slice(1, -1).sort(function (a, b) {
        return (b.hasAttribute('data-dec') ? 1 : 0) - (a.hasAttribute('data-dec') ? 1 : 0);
      });
      var kept = [sp[0], sp[sp.length - 1]].map(function (x) { return x.getBoundingClientRect(); });
      order.forEach(function (x) {
        var r = x.getBoundingClientRect();
        var clash = kept.some(function (k) { return r.left < k.right + 4 && r.right > k.left - 4; });
        if (clash) x.classList.add('hx'); else kept.push(r);
      });
    });
  }
  if (!w.__mfcFitTicks) {
    w.__mfcFitTicks = 1;
    var _ft; w.addEventListener('resize', function () { clearTimeout(_ft); _ft = setTimeout(function () { fitTicks(); }, 120); }, { passive: true });
    try { if (d.fonts && d.fonts.ready) d.fonts.ready.then(function () { fitTicks(); }); } catch (e) {}
  }
  // linear sliders: whole-number points on a 1-2-5 step, at most seven, none
  // closer than 12% of the track to another
  function linearTicks(f) {
    var span = f.max - f.min, st = 1, steps = [1, 2, 5];
    for (var e = -2; e < 4 && span / st > 6; e++) for (var j = 0; j < 3 && span / st > 6; j++) st = steps[j] * Math.pow(10, e);
    var kept = [{ v: f.min, p: 0 }, { v: f.max, p: 1 }];
    for (var t = Math.ceil(f.min / st) * st; t < f.max - 1e-9; t += st) {
      var v = Math.round(t * 100) / 100, p = (v - f.min) / span;
      if (v > f.min && kept.every(function (q) { return Math.abs(q.p - p) >= 0.12; })) kept.push({ v: v, p: p });
    }
    return kept.sort(function (a, b) { return a.p - b.p; });
  }
  function ticksHTML(f) {
    var ticks = f._scale ? f._scale.ticks : linearTicks(f), n = ticks.length;
    return '<div class="cf-ends cf-ticks" aria-hidden="true">' + ticks.map(function (q, i) {
      var end = i === 0 ? 's' : (i === n - 1 ? 'e' : '');
      var dec = f.unit === 'money' && q.v > 0 && Math.abs(Math.log(q.v) / Math.LN10 % 1) < 1e-9;
      return '<span' + (end ? ' class="' + end + '"' : '') + (dec ? ' data-dec' : '') + ' style="--p:' + q.p.toFixed(4) + '">' +
        esc(end === 's' && f.minLabel ? f.minLabel : (end === 'e' && f.maxLabel ? f.maxLabel : tickLabel(f, q.v, !!end))) + '</span>';
    }).join('') + '</div>';
  }
  function scalePos(sc, v) { return sc.pos[nearestIdx(sc.rungs, v)]; }

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

  /* V39.7 — THE YEAR-BY-YEAR TABLE. The chart shows the shape; the table is
     where a member checks a particular year ("what do I withdraw in year 12,
     and what is left?"). A <details>, closed by default: forty rows open under
     the result would bury the page below it. Money cells carry the full rupee
     figure AND the lakh/crore form, and the stylesheet shows one per width —
     so five columns fit a 320px phone without a sideways scroll, and a desktop
     still reads ₹12,34,567. A column may also carry `short` (its phone header)
     and `xs:false` (a derivable column dropped below 381px, so five columns
     never scroll sideways on a 320px phone). */
  function tableHTML(t, open) {
    var cols = t.cols || [], rows = t.rows || [];
    if (!cols.length || !rows.length) return '';
    function cell(c, r) {
      var v = r[c.k];
      if (v == null || v === '') return '—';
      if (c.fmt === 'money') return '<span class="tf">' + esc(inr(v)) + '</span><span class="tc">' + esc(compact(v)) + '</span>';
      if (c.fmt === 'pct') return esc(pct(v));
      return esc(v);
    }
    var n = rows.length, unit = t.unit || 'year';
    return '<details class="ctbl"' + (open ? ' open' : '') + '>' +
      '<summary><span class="t">' + esc(t.title || 'Year-by-year table') + '</span>' +
        '<span class="n">' + n + ' ' + unit + (n === 1 ? '' : 's') + '</span></summary>' +
      '<div class="ctbl-wrap"><table class="ctbl-t">' +
        '<caption>' + esc(t.caption || t.title || 'Year-by-year table') + '</caption>' +
        '<thead><tr>' + cols.map(function (c, i) {
          // a column may carry a phone label ("Balance" for "Balance at year end"):
          // the longest word in a header sets its column's minimum width
          var lab = c.short ? '<span class="tf">' + esc(c.label) + '</span><span class="tc">' + esc(c.short) + '</span>' : esc(c.label);
          var cls = (i && c.fmt ? 'r' : '') + (c.xs === false ? ' hx' : '');
          return '<th scope="col"' + (cls.trim() ? ' class="' + cls.trim() + '"' : '') + '>' + lab + '</th>';
        }).join('') + '</tr></thead>' +
        '<tbody>' + rows.map(function (r) {
          return '<tr' + (r._cls ? ' class="' + esc(r._cls) + '"' : '') + '>' + cols.map(function (c, i) {
            return i === 0 ? '<th scope="row">' + cell(c, r) + '</th>'
                           : '<td' + ((c.fmt || c.xs === false) ? ' class="' + ((c.fmt ? 'r' : '') + (c.xs === false ? ' hx' : '')).trim() + '"' : '') + '>' + cell(c, r) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>' +
      (t.note ? '<p class="ctbl-note">' + t.note + '</p>' : '') +
    '</details>';
  }
  // the house scroll cue (V34.0): a right-edge fade only while columns are
  // hidden past the edge — a safety net here, since the table is sized to fit
  function tableCue(wrap) {
    if (!wrap) return;
    var max = wrap.scrollWidth - wrap.clientWidth;
    wrap.classList.toggle('mfx-more-r', max > 8 && wrap.scrollLeft < max - 4);
  }
  function wireTable(tblHost) {
    var det = tblHost.querySelector('details.ctbl'), wrap = tblHost.querySelector('.ctbl-wrap');
    if (!det || !wrap) return;
    wrap.addEventListener('scroll', function () { tableCue(wrap); }, { passive: true });
    det.addEventListener('toggle', function () { tableCue(wrap); });
    tableCue(wrap);
  }
  if (!w.__mfcTblCue) {
    w.__mfcTblCue = 1;
    w.addEventListener('resize', function () {
      [].forEach.call(d.querySelectorAll('.ctbl-wrap'), tableCue);
    }, { passive: true });
  }

  function render(host, out, tblHost) {
    var fig = out.fig || {};
    // the table's open/closed state is the member's, so a re-render keeps it
    var tblOpen = !!(tblHost ? tblHost : host).querySelector('details.ctbl[open]');
    var tbl = out.table ? tableHTML(out.table, tblOpen) : '';
    if (tblHost) { tblHost.innerHTML = tbl; tblHost.hidden = !tbl; if (tbl) wireTable(tblHost); }
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
    if (tbl && !tblHost) html += tbl;
    host.innerHTML = html;
    if (tbl && !tblHost) wireTable(host);

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
    var tblHost = d.getElementById(cfg.tableId || 'calc-table');   // V39.7 — optional, full width
    if (!form || !host) return null;

    var state = {}, fields = cfg.fields.slice(), mode = cfg.modes ? cfg.modes.options[0].k : null;
    var setters = {}, lastOut = null, pinned = null;
    // V40.4 — a shared link carries the inputs; read it before anything renders
    var q0 = readQuery();
    if (q0.mode) mode = q0.mode;

    function fieldsFor(m) {
      if (!cfg.modes || !m) return fields;
      var o = cfg.modes.options.filter(function (x) { return x.k === m; })[0] || {};
      return fields.map(function (f) {
        var over = (o.fields || {})[f.k];
        return over ? Object.assign({}, f, over) : f;
      });
    }

    /* V40.2 — a book or loan-type switch rebuilds the fields, and used to put
       EVERY field back to its default: a reader who typed their own ₹10,00,000
       into "MindForge vs your fund" and switched books was quietly back at
       ₹2,00,000. Now a switch (keep) carries each field's current value across
       unless the new mode sets that field's value itself (the EMI page's loan
       types do, on purpose), clamped to the new range. */
    function build(keep) {
      var opt = cfg.modes && mode ? (cfg.modes.options.filter(function (x) { return x.k === mode; })[0] || {}) : {};
      var fs = fieldsFor(mode).map(function (f) {
        var ov = (opt.fields || {})[f.k] || {};
        if (keep && Object.prototype.hasOwnProperty.call(state, f.k) && !('value' in ov)) {
          var cur = state[f.k];
          if (f.unit === 'choice') {
            if (f.options.some(function (x) { return x.v === cur; })) f = Object.assign({}, f, { value: cur });
          } else if (isFinite(cur)) {
            f = Object.assign({}, f, { value: clamp(cur, f.min, f.max) });
          }
        }
        return f.unit === 'money' ? Object.assign({}, f, { _scale: moneyScale(f) }) : f;
      });
      form.innerHTML = fs.map(function (f, i) { return fieldHTML(f, (cfg.key || 'c') + '-f' + i); }).join('');
      fs.forEach(function (f) { state[f.k] = f.value; });
      form.querySelectorAll('.cf').forEach(function (row) {
        var f = fs.filter(function (x) { return x.k === row.dataset.f; })[0];
        if (f.unit === 'choice') {
          var btns = row.querySelectorAll('button[data-v]');
          // V40.4 — a setter the link, reset and pin share (quiet: no re-run)
          setters[f.k] = function (v, quiet) {
            var o = f.options.filter(function (x) { return String(x.v) === String(v); })[0];
            if (!o) return false;
            state[f.k] = o.v;
            [].forEach.call(btns, function (x) { x.setAttribute('aria-pressed', String(x.dataset.v === String(o.v))); });
            if (!quiet) run();
            return true;
          };
          [].forEach.call(btns, function (b) {
            b.addEventListener('click', function () {
              var o = f.options.filter(function (x) { return String(x.v) === b.dataset.v; })[0];
              if (!o || state[f.k] === o.v) return;
              state[f.k] = o.v;
              [].forEach.call(btns, function (x) { x.setAttribute('aria-pressed', String(x === b)); });
              run();
            });
          });
          return;
        }
        var num = row.querySelector('.cf-in'), rng = row.querySelector('.cf-rng');
        var money = f.unit === 'money';
        var read = function () {
          return money ? parseFloat(String(num.value).replace(/[^0-9.]/g, '')) : parseFloat(num.value);
        };
        var show = function (v) { num.value = money ? group(v) : v; };
        var sc = f._scale;
        /* V40.2 — A WHOLE-YEAR FIELD TAKES WHOLE YEARS. The input is
           type=number step=1, but typing "12.5" was committed as 12.5: the
           step-up SIP then compounded twelve years of instalments under a
           "Corpus after 12.5 years" label (and deflated by 12.5), and the EMI
           table stopped at year 12 with half a year of the loan still owed.
           A years field whose step is a whole number rounds to that step; one
           with a fractional step (CAGR's "Over", 0.5) still takes any value. */
        var whole = f.unit === 'years' && f.step >= 1 && f.step % 1 === 0;
        var snap = function (v) { return whole && isFinite(v) ? f.min + Math.round((v - f.min) / f.step) * f.step : v; };
        var fill = function () {
          var p = sc ? scalePos(sc, state[f.k]) * 100
                        : (state[f.k] - f.min) / (f.max - f.min) * 100;
          rng.style.setProperty('--fill', clamp(p, 0, 100).toFixed(1) + '%');
        };
        var commit = function (v, fromRange) {
          var bad = !isFinite(v);
          if (!bad && (v < f.min || v > f.max)) bad = true;
          row.classList.toggle('is-bad', bad && !fromRange);
          state[f.k] = clamp(isFinite(v) ? snap(v) : f.value, f.min, f.max);
          if (fromRange) show(state[f.k]);
          rng.value = sc ? Math.round(scalePos(sc, state[f.k]) * 1000) : state[f.k];
          fill(); run();
        };
        num.addEventListener('input', function () { commit(read(), false); });
        // Clamped and re-grouped on BLUR, never mid-keystroke: a half-typed "1"
        // must not turn into "1,00,000" under the cursor.
        num.addEventListener('blur', function () {
          show(state[f.k]); row.classList.remove('is-bad'); run();
        });
        rng.addEventListener('input', function () {
          var raw = parseFloat(rng.value);
          if (!sc) { commit(raw, true); return; }
          // the notch nearest the thumb; commit() then parks the thumb ON it
          var p = raw / 1000, best = 0;
          for (var i = 1; i < sc.pos.length; i++) if (Math.abs(sc.pos[i] - p) < Math.abs(sc.pos[best] - p)) best = i;
          commit(sc.rungs[best], true);
        });
        // V40.4 — the same clamp and snap a typed value gets, without a re-run
        // per field when a link restores several at once
        setters[f.k] = function (v, quiet) {
          v = Number(v);
          if (!isFinite(v)) return false;
          state[f.k] = clamp(snap(v), f.min, f.max);
          show(state[f.k]);
          rng.value = sc ? Math.round(scalePos(sc, state[f.k]) * 1000) : state[f.k];
          row.classList.remove('is-bad');
          fill();
          if (!quiet) run();
          return true;
        };
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
      if (out) { render(host, out, tblHost); announce(out); maybePop(out); lastOut = out; afterRender(out); }
      if (typeof cfg.onRender === 'function') { try { cfg.onRender(out, Object.assign({}, state), mode); } catch (e) {} }
    }

    /* ── V40.4 · THE SCENARIO IS THE READER'S ─────────────────────────────────
       The Fee Calculator has let a reader keep what they built since V34.8
       ("Copy this scenario" puts every input in the link and the page restores
       it on load). The other fifteen threw it away on refresh. Same idea, same
       wording, for every engine page — plus a pin to compare two scenarios, the
       year table as a spreadsheet, print, and a reset. A link holds only the
       inputs that differ from the page's defaults, so an unchanged page keeps
       its clean address; a junk or out-of-range value is clamped or ignored,
       never trusted. Nothing is stored and nothing is sent. */
    function readQuery() {
      var out = { mode: null, vals: {} };
      try {
        var p = new URLSearchParams(w.location.search);
        if (cfg.modes) {
          var m = p.get('mode');
          if (m && cfg.modes.options.some(function (x) { return x.k === m; })) out.mode = m;
        }
        cfg.fields.forEach(function (f) {
          var raw = p.get(f.k);
          if (raw !== null && raw !== '') out.vals[f.k] = raw;
        });
      } catch (e) {}
      return out;
    }
    function applyQuery(q) {
      Object.keys(q.vals).forEach(function (k) { if (setters[k]) setters[k](q.vals[k], true); });
    }
    function defaultsFor(m) {
      var out = {};
      fieldsFor(m).forEach(function (f) { out[f.k] = f.value; });
      return out;
    }
    function scenarioURL() {
      var u;
      try { u = new URL(w.location.href); } catch (e) { return String(w.location.href); }
      u.search = ''; u.hash = '';
      var def = defaultsFor(mode);
      if (cfg.modes && mode && mode !== cfg.modes.options[0].k) u.searchParams.set('mode', mode);
      Object.keys(def).forEach(function (k) {
        var a = state[k], b = def[k];
        if (a == null) return;
        var same = (typeof a === 'number' && typeof b === 'number') ? Math.abs(a - b) < 1e-9 : String(a) === String(b);
        if (!same) u.searchParams.set(k, typeof a === 'number' ? String(Math.round(a * 1e6) / 1e6) : String(a));
      });
      return u.toString();
    }

    // the headline as a number, when it is one: ₹1,26,14,400 · −₹1,200 · ₹1.26Cr · 12.4%
    function moneyNum(s) {
      var m = String(s || '').match(/^\s*([−-])?₹\s?([\d,]+(?:\.\d+)?)\s*(Cr|L|k)?\s*$/);
      if (!m) return null;
      var n = parseFloat(m[2].replace(/,/g, ''));
      n *= m[3] === 'Cr' ? 1e7 : m[3] === 'L' ? 1e5 : m[3] === 'k' ? 1e3 : 1;
      return m[1] ? -n : n;
    }
    function pctNum(s) {
      var m = String(s || '').match(/^\s*([−-])?(\d+(?:\.\d+)?)%\s*$/);
      return m ? (m[1] ? -1 : 1) * parseFloat(m[2]) : null;
    }
    // Pinned: the figure, what it was a figure OF, and how far the current one
    // has moved from it. No green or red: on the EMI page "more" is worse.
    function pinHTML(out) {
      if (!pinned || !out || !out.fig) return '';
      var now = out.fig.v, diff = '';
      var n0 = moneyNum(pinned.v), n1 = moneyNum(now), p0 = pctNum(pinned.v), p1 = pctNum(now);
      if (n0 != null && n1 != null) {
        var dl = n1 - n0;
        diff = Math.abs(dl) < 0.5 ? 'Same as now' :
          'Now ' + (dl > 0 ? '+' : '−') + compact(Math.abs(dl)) +
          (Math.abs(n0) >= 1 ? ' (' + (dl > 0 ? '+' : '−') + Math.abs(dl / Math.abs(n0) * 100).toFixed(1) + '%)' : '');
      } else if (p0 != null && p1 != null) {
        var dp = p1 - p0;
        diff = Math.abs(dp) < 0.005 ? 'Same as now' : 'Now ' + (dp > 0 ? '+' : '−') + Math.abs(dp).toFixed(2) + ' pts';
      } else if (now !== pinned.v) {
        diff = 'Now ' + now;
      } else {
        diff = 'Same as now';
      }
      return '<p class="co-pin"><span class="pk">Pinned</span><b>' + esc(pinned.v) + '</b>' +
        '<span class="pl">' + esc(pinned.k) + '</span><span class="pd">' + esc(diff) + '</span></p>';
    }

    var reduceMotion = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var outPanel = host.closest ? host.closest('.cout') : null;
    if (outPanel && !outPanel.id) outPanel.id = 'calc-result';
    var SVGA = ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
    var ICON = {
      share: '<svg' + SVGA + '><path d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v14"/></svg>',
      pin: '<svg' + SVGA + '><path d="M12 17v5"/><path d="M9 3h6l-1 6 4 4H6l4-4z"/></svg>',
      csv: '<svg' + SVGA + '><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
      print: '<svg' + SVGA + '><path d="M6 9V3h12v6"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M8 14h8v7H8z"/></svg>',
      reset: '<svg' + SVGA + '><path d="M3 12a9 9 0 103-6.7"/><path d="M3 4v5h5"/></svg>'
    };
    function toolBtn(act, label) {
      return '<button type="button" class="ctool" data-act="' + act + '"' + (act === 'pin' ? ' aria-pressed="false"' : '') + '>' +
        ICON[act] + '<span class="t">' + label + '</span></button>';
    }
    var tools = d.createElement('div');
    tools.className = 'ctools';
    tools.setAttribute('role', 'group');
    tools.setAttribute('aria-label', 'Keep, compare or reset this result');
    tools.innerHTML = toolBtn('share', 'Copy this scenario') + toolBtn('pin', 'Pin to compare') +
      toolBtn('csv', 'Download table (CSV)') + toolBtn('print', 'Print') + toolBtn('reset', 'Reset');
    host.parentNode.insertBefore(tools, host.nextSibling);
    var bShare = tools.querySelector('[data-act="share"]'), bPin = tools.querySelector('[data-act="pin"]'),
        bCsv = tools.querySelector('[data-act="csv"]');

    function flash(btn, text, ms, done) {
      var t = btn.querySelector('.t'), was = btn._label || (btn._label = t.textContent);
      btn.classList.toggle('done', !!done); t.textContent = text;
      clearTimeout(btn._t);
      btn._t = setTimeout(function () { btn.classList.remove('done'); t.textContent = was; }, ms || 2200);
    }
    bShare.addEventListener('click', function () {
      var url = scenarioURL();
      // the address bar follows either way, so there is always a link to copy by hand
      try { w.history.replaceState(null, '', url); } catch (e) {}
      var ok = function () { flash(bShare, 'Link copied', 2200, true); };
      var fallback = function () { flash(bShare, 'Link is in the address bar', 2600, false); };
      try {
        if (w.navigator.clipboard && w.navigator.clipboard.writeText) w.navigator.clipboard.writeText(url).then(ok, fallback);
        else fallback();
      } catch (e) { fallback(); }
    });
    bPin.addEventListener('click', function () {
      if (pinned) { pinned = null; }
      else if (lastOut && lastOut.fig) { pinned = { k: lastOut.fig.k, v: lastOut.fig.v }; }
      bPin.setAttribute('aria-pressed', String(!!pinned));
      bPin.querySelector('.t').textContent = pinned ? 'Unpin' : 'Pin to compare';
      if (lastOut) afterRender(lastOut);
    });
    function csvCell(s) { s = String(s == null ? '' : s); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
    bCsv.addEventListener('click', function () {
      var t = lastOut && lastOut.table;
      if (!t || !t.cols || !t.rows || !t.rows.length) return;
      var lines = [t.cols.map(function (c) {
        return csvCell(c.label + (c.fmt === 'money' ? ' (Rs)' : c.fmt === 'pct' ? ' (%)' : ''));
      }).join(',')];
      t.rows.forEach(function (r) {
        lines.push(t.cols.map(function (c) {
          var v = r[c.k];
          if (v == null || v === '') return '';
          if (c.fmt === 'money') return String(Math.round(v));
          if (c.fmt === 'pct') return String(Math.round(v * 100) / 100);
          return csvCell(v);
        }).join(','));
      });
      try {
        var blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
        var a = d.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (cfg.key || 'calculator') + '-year-by-year.csv';
        d.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
        flash(bCsv, 'Downloaded', 1800, true);
      } catch (e) { flash(bCsv, 'Could not download here', 2600, false); }
    });
    tools.querySelector('[data-act="print"]').addEventListener('click', function () {
      // a closed year table would print as one line; open it for the printout only
      var det = (tblHost || host).querySelector('details.ctbl'), was = det ? det.open : true;
      if (det) det.open = true;
      var restore = function () { if (det && !was) det.open = false; w.removeEventListener('afterprint', restore); };
      w.addEventListener('afterprint', restore);
      try { w.print(); } catch (e) { restore(); }
    });
    tools.querySelector('[data-act="reset"]').addEventListener('click', function () {
      if (cfg.modes) { mode = cfg.modes.options[0].k; syncModeBar(); }
      pinned = null; bPin.setAttribute('aria-pressed', 'false'); bPin.querySelector('.t').textContent = 'Pin to compare';
      build(); run(); fitTicks(form);
      // the address bar too, or a refresh would quietly undo the reset
      try { w.history.replaceState(null, '', w.location.pathname); } catch (e) {}
    });

    /* Where the result sits BELOW the inputs (one column, ≤980px), a reader
       moving a slider could not see what it did — the figure was a screen
       further down. This strip sits at the top of the inputs card and, being
       sticky INSIDE that card, stays under the nav while the inputs scroll and
       leaves with them: it never floats over the result, the footer or the
       WhatsApp button. Its link takes the reader to the full result. */
    var live = null, formPanel = form.closest ? form.closest('.cpanel') : null;
    if (formPanel) {
      live = d.createElement('div');
      live.className = 'clive';
      live.innerHTML = '<span class="clive-t" aria-hidden="true"><span class="clive-k"></span><b class="clive-v"></b></span>' +
        '<a class="clive-go" href="#calc-result">Full result<span aria-hidden="true">&nbsp;&darr;</span></a>';
      formPanel.insertBefore(live, form);
      live.querySelector('.clive-go').addEventListener('click', function (e) {
        if (!outPanel) return;
        e.preventDefault();
        outPanel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      });
    }
    function navTop() {
      var n = d.querySelector('body > nav');
      var h = n ? Math.round(n.getBoundingClientRect().height) : 0;
      d.documentElement.style.setProperty('--clive-top', h + 'px');
    }
    navTop();
    var navT; w.addEventListener('resize', function () { clearTimeout(navT); navT = setTimeout(navTop, 120); }, { passive: true });

    function afterRender(out) {
      if (!out) return;
      if (pinned && out.fig) {
        var anchor = host.querySelector('.co-cap') || host.querySelector('.co-fig');
        if (anchor) anchor.insertAdjacentHTML('afterend', pinHTML(out));
      }
      bCsv.hidden = !(out.table && out.table.rows && out.table.rows.length);
      if (live && out.fig) {
        live.querySelector('.clive-k').textContent = out.fig.k || 'Result';
        live.querySelector('.clive-v').textContent = out.fig.v || '—';
      }
    }

    var bar = cfg.modes ? d.getElementById(cfg.modesId || 'calc-modes') : null;
    function syncModeBar() {
      if (!bar) return;
      [].forEach.call(bar.querySelectorAll('button[data-m]'), function (x) {
        x.setAttribute('aria-pressed', String(x.dataset.m === mode));
      });
    }
    if (cfg.modes) {
      if (bar) {
        // V40.4 — pressed from `mode`, not "the first": a shared link may open on the second
        bar.innerHTML = cfg.modes.options.map(function (o) {
          return '<button type="button" data-m="' + esc(o.k) + '" aria-pressed="' + (o.k === mode) + '">' +
            esc(o.label) + '</button>';
        }).join('');
        bar.addEventListener('click', function (ev) {
          var b = ev.target && ev.target.closest ? ev.target.closest('button[data-m]') : null;
          if (!b || b.dataset.m === mode) return;
          mode = b.dataset.m;
          bar.querySelectorAll('button').forEach(function (x) {
            x.setAttribute('aria-pressed', String(x.dataset.m === mode));
          });
          build(true); run(); fitTicks(form);
        });
      }
    }

    build(); applyQuery(q0); run(); fitTicks(form);
    return { run: run, state: function () { return Object.assign({}, state); },
             setMode: function (m) { mode = m; build(true); run(); fitTicks(form); },
             scenarioURL: scenarioURL };
  }

  w.MFCalc = { init: init, scale: moneyScale, inr: inr, compact: compact, pct: pct, group: group, round: round,
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

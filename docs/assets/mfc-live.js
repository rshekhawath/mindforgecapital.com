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
     data-live="mc:alpha"       → live − bench, in POINTS (signed, 2dp, "pts")
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
  /* V27.9: the gap between the strategy and its benchmark is a difference of two
     percentages, so its unit is POINTS, not per cent — writing "+0.71%" there
     would claim a relative outperformance the number does not describe. The
     backtest comparison right below it already says "pts"; this matches it. */
  function fmtPts(v) {
    if (v == null || !isFinite(v)) return null;
    var sign = v > 0 ? "+" : v < 0 ? "−" : "±";
    return sign + Math.abs(v).toFixed(2) + " pts";
  }

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
  /* V37.0 — A DATE THIS FUNCTION WRITES MUST NEVER BREAK ACROSS TWO LINES.
     Every date on the site that a human typed is bound with &nbsp; ("Jul&nbsp;2026",
     "backtest&nbsp;CAGR", "28&nbsp;Aug&nbsp;2026"); this one is written at runtime and
     came out with plain U+0020, so the same sentence carried both conventions and
     only the machine-written half broke. Measured across 24 pages x 11 viewports x
     2 themes: "31 Aug 2026" split into "31 Aug" / "2026" on the homepage hero, the
     strategies KPI foot and its fund strip, and "9 Sept 2026" split on all three
     strategy pages at 320px — five surfaces, one formatter. Joining with U+00A0
     here fixes every one of them and any future surface that declares data-live,
     which is the point of formatting in one place. The day-month space is bound
     too: "31" alone at the end of a line is the same defect one token earlier. */
  var NB = "\u00a0";
  function fmtDate(iso) {
    try {
      var d = new Date(iso + "T00:00:00");
      return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
              .replace(/\s+/g, NB);
    } catch (e) { return iso; }
  }
  // V39.3 — day and month only, for a date read beside a full one ("since 31 Aug
  // 2026 · to the 24 Sept close"); same NBSP binding as fmtDate.
  function fmtDayMonth(iso) {
    try {
      var d = new Date(iso + "T00:00:00");
      return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }).replace(/\s+/g, NB);
    } catch (e) { return iso; }
  }

  /* V39.3 — A1. The date each paid strategy's Zerodha account became dedicated to
     its model. EMPTY until the owner supplies it (V39.3 handover, D3), and an empty
     value renders nothing — never a placeholder. The member dashboard carries the
     same two dates in its VERIFIED_ACCOUNTS (`since`): set both together, then bump
     this file's ?v on every page that loads it. */
  var DEDICATED_SINCE = { lm: "", sm: "" };

  /* V40.1 — A8. THE FIRST DAYS OF A CYCLE. On the evening a new book is
     published its baseline IS the last measured close, so every figure is
     0.00 against 0.00 — and the morning refresh measures one session behind,
     so the site said "+0.00% THIS CYCLE … to the 30 Sept close" for days (a
     holiday and a weekend followed the September publish). A cycle with no
     completed session has no figure: nothing prints +0.00%, the live surfaces
     stay in their fail-soft (hidden) state, and only the surfaces that opt in
     with data-live-new (the homepage hero) say what is happening instead.
     SHOW_LAST_CYCLE (owner switch, D5 in the V40.1 handover) additionally
     puts the last FINISHED cycle there, from live-history.json.
     V40.2 — ON, at the owner's request: the hero box must carry a number, not
     only a sentence. In the gap it now shows the last sealed cycle's figure
     against its index, labelled LAST CYCLE with its own dates, and the "new
     book" line moves underneath it. A sealed row is final, so this is the one
     figure that can stand in for the open cycle without being a guess; with no
     sealed cycle yet (the very first book) the box keeps the sentence alone.
     V44.2 — OFF, at the owner's request: the landing page speaks for the current
     cycle only ("Past month is not needed"); the track record and the broker's own
     Live P&L carry the months before it. */
  var SHOW_LAST_CYCLE = false;
  function zeroSession(d) {
    return !!(d && d.baseline_date && d.data_through && String(d.data_through) <= String(d.baseline_date));
  }
  function fillDedicated() {
    document.querySelectorAll("[data-dedicated]").forEach(function (el) {
      var d = DEDICATED_SINCE[el.getAttribute("data-dedicated")] || "";
      el.textContent = d ? "Dedicated to this model since " + d +
        ". Trades before that date are in Zerodha\u2019s total." : "";
      el.hidden = !d;
    });
  }

  function fill(data) {
    var els = document.querySelectorAll("[data-live]");
    if (!els.length) return;
    var any = false, zero = zeroSession(data);
    els.forEach(function (el) {
      var spec = (el.getAttribute("data-live") || "").split(":");
      var val = null, isPct = false, num = null;
      if (spec[0] === "rebal") val = fmtDate(data.rebalance_date);
      else if (spec[0] === "asof") val = fmtDate(data.data_through);
      // V40.1 — what the hero says while a new book has no completed session
      else if (spec[0] === "newbook") {
        if (!zero) { el.textContent = ""; return; }
        val = "New book published " + fmtDate(data.rebalance_date) + NB + "· its first figure comes after the next close.";
      }
      // V38.9 — HOW YOUNG THE LIVE RECORD IS, beside the live figure itself.
      // Every surface on this site prints a cycle % with no sample size, and on
      // the homepage that number is the first thing a first-time reader meets.
      // One cycle of −0.04% reads as performance; it is a sample of one, and
      // the page has to say so in the same breath rather than hope the reader
      // infers it. Derived in live_perf.py from the history file, so it cannot
      // go stale the way a hand-typed count would; absent payload (an older
      // live-perf.json, a cached one from before this release) simply leaves
      // the slot's authored fallback text alone.
      else if (spec[0] === "record") {
        var rec = data.record;
        if (!rec || !(rec.count > 0)) return;
        if (spec[1] === "count") val = String(rec.count);
        else if (spec[1] === "since") val = fmtDate(rec.first_rebalance);
        // V39.0 — the noun, agreeing with the count. V38.9 pluralised the
        // `phrase` slot and left the one place where the number and its noun
        // are separate elements reading "1 cycles published". A slot for the
        // word is the only version of this that cannot drift: the alternative
        // is a hand-typed "cycles" beside a machine-written "1", which is the
        // seam this project keeps finding.
        else if (spec[1] === "countword") val = (rec.count === 1 ? "cycle" : "cycles");
        else if (spec[1] === "phrase") {
          // V39.4 — two bound phrases that may break only after the dot:
          // "since 31 Aug 2026 ·" / "to the 24 Sept close". With plain spaces the
          // homepage card ended a line on "to" (390px) or "the" (414px), began one
          // with "·" (360px), and left "close" alone on a line at 1024.
          val = "Live record: " + rec.count + NB + (rec.count === 1 ? "cycle" : "cycles") +
                (rec.first_rebalance ? ", since" + NB + fmtDate(rec.first_rebalance) : "") +
                // V39.3 — A2.5: WHICH close the figure runs to. live_perf.py now
                // counts completed sessions only, so this is always a real close.
                // V40.1 — not while the open cycle has no close of its own.
                (data.data_through && !zero ? NB + "· to" + NB + "the" + NB + fmtDayMonth(data.data_through) + NB + "close" : "");
        }
      }
      else {
        var s = (data.strategies || {})[spec[0]];
        if (!s) return;
        if (zero && (spec[1] === "live" || spec[1] === "bench" || spec[1] === "alpha")) return;
        if (spec[1] === "live")  { num = s.live_pct;  val = fmtPct(s.live_pct);  isPct = true; }
        if (spec[1] === "bench") { num = s.bench_pct; val = fmtPct(s.bench_pct); isPct = true; }
        if (spec[1] === "benchname") val = s.bench_name;
        // NOT isPct: countTo's tween renders its intermediate frames as "x.xx%",
        // so animating this slot would flash a per-cent unit for 750ms before
        // landing on "pts". It still gets the up/down tint below.
        if (spec[1] === "alpha" && s.live_pct != null && s.bench_pct != null) {
          num = s.live_pct - s.bench_pct; val = fmtPts(num);
        }
      }
      if (val == null) return;
      // tint first so the number counts up already wearing its final colour
      if (num != null) {
        el.classList.remove("up", "down", "flat");
        el.classList.add(cls(num));
      }
      if (isPct) countTo(el, num, val);
      else el.textContent = val;
      any = true;
    });
    if (!any) return;
    if (zero) {
      // V40.1 — only the surfaces built to say "new book" are revealed
      document.querySelectorAll("[data-live-wrap][data-live-new]").forEach(function (w) {
        w.classList.add("live-ready", "is-new");
      });
      if (SHOW_LAST_CYCLE) showLastCycle(data);
      return;          // no mfc-live-ready: listeners would paint the zeros

    }
    document.querySelectorAll("[data-live-wrap]").forEach(function (w) {
      w.classList.add("live-ready");
      w.classList.remove("is-new");
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
    return true;
  }

  // Shared CSS for the .live-strip (strategy pages) and .live-chip
  // (strategies index cards) — injected here so seven pages share one
  // implementation, same pattern as mfc-offer.js. The homepage hero's bespoke
  // .hv-live rules stay inline in index.html.


  /* Render every [data-live-meter="<key>"] as a two-bar model-vs-index compare.
     Bars are scaled to the LARGER of the two magnitudes so the shorter bar is
     always a true fraction of the longer one — the gap is read by eye, and the
     caption states it in points so it is never read wrong. Painted at width:0
     and grown on the next frame; a bar written straight to its final width has
     a dead transition. */
  function fillMeters(data) {
    var nodes = document.querySelectorAll("[data-live-meter]");
    if (!nodes.length) return;
    var pending = [];
    nodes.forEach(function (el) {
      var s = (data.strategies || {})[el.getAttribute("data-live-meter")];
      if (!s || s.live_pct == null || s.bench_pct == null) return;   // coverage guard published null
      var live = s.live_pct, bench = s.bench_pct;
      /* Half the track per side, so the larger of the two magnitudes always
         reaches its end and the pair stays directly comparable. */
      var scale = Math.max(Math.abs(live), Math.abs(bench), 0.01);
      var half = function (v) { return Math.abs(v) / scale * 50; };
      var side = function (v) { return v < 0 ? "is-neg" : "is-pos"; };
      var gap = live - bench, ahead = gap >= 0;
      var bn = s.bench_name || "the benchmark";
      /* The track is decorative: the signed number sits beside it and the gap
         sentence states the verdict, so a reader on a screen reader loses
         nothing by skipping it. */
      el.innerHTML =
        '<div class="lvm-row"><span class="lvm-key">Model</span>' +
          '<span class="lvm-track" aria-hidden="true"><i class="lvm-mid"></i>' +
            '<i class="lvm-fill lvm-model ' + side(live) + '"></i></span>' +
          '<span class="lvm-val ' + cls(live) + '">' + fmtPct(live) + "</span></div>" +
        '<div class="lvm-row"><span class="lvm-key">Index</span>' +
          '<span class="lvm-track" aria-hidden="true"><i class="lvm-mid"></i>' +
            '<i class="lvm-fill lvm-bench ' + side(bench) + '"></i></span>' +
          '<span class="lvm-val ' + cls(bench) + '">' + fmtPct(bench) + "</span></div>" +
        '<div class="lvm-gap' + (ahead ? "" : " behind") + '"><b>' +
          (ahead ? "+" : "−") + Math.abs(gap).toFixed(2) + " pts</b> " +
          (ahead ? "ahead of " : "behind ") + bn + " this cycle</div>";
      /* V34.9's rule: a non-zero move must always paint at least one visible
         pixel. A benchmark at +0.05% against a −5% model is 0.5% of the track —
         under a pixel — and an empty half says "flat", which is a different
         claim. Gated on non-zero, so a genuinely flat cycle still paints
         nothing. */
      pending.push([el.querySelector(".lvm-model"), half(live), live !== 0]);
      pending.push([el.querySelector(".lvm-bench"), half(bench), bench !== 0]);
      el.classList.add("live-ready");
    });
    var grow = function () {
      pending.forEach(function (p) {
        p[0].style.width = p[1].toFixed(1) + "%";
        if (p[2]) p[0].style.minWidth = "2px";
      });
    };
    // rAF for the paint-at-zero frame, timeout as the frame-starved fallback
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(grow);
    setTimeout(grow, 160);
    /* Same backstop contract as countTo(): an empty bar on a performance card
       does not read as "not animated yet", it reads as ZERO — a wrong number. If
       the transition clock is starved (throttled tab, frame-starved renderer)
       the width stays at its from-value indefinitely, so once the tween should
       long since have finished, force any still-empty bar to its final width
       with the transition off. */
    setTimeout(function () {
      pending.forEach(function (p) {
        if (p[1] > 0.5 && p[0].getBoundingClientRect().width < 1) {
          p[0].style.transition = "none";
          p[0].style.width = p[1].toFixed(1) + "%";
        }
      });
    }, 1400);
  }

  /* V40.1 — D5. The last FINISHED cycle, for the surfaces that opt in with
     data-live-new, only when SHOW_LAST_CYCLE is on. Sealed rows in
     live-history.json are final.
     V40.2 — the figure is now a NUMBER in the card's own big-figure layout, not
     a sentence: the cycle is published as window.MFCLive.last_cycle and the
     wrap gains .has-last; the homepage hero (which owns its tab switching)
     listens for "mfc-live-last" and paints the selected book from it. Only the
     opted-in wraps are touched — every other live surface keeps its fail-soft
     hidden state, so no "this cycle" label anywhere carries last month's move. */
  function lastSealed(h) {
    var sealed = ((h && h.cycles) || []).filter(function (c) {
      return c && c.sealed && c.strategies && c.rebalance_date && c.data_through;
    });
    return sealed[sealed.length - 1] || null;
  }
  function showLastCycle(data) {
    fetch("/live-history.json?t=" + Math.floor(Date.now() / 3600000), { credentials: "omit" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (h) {
        var c = lastSealed(h);
        if (!c) return;
        var any = false;
        ["sm", "lm", "ma"].forEach(function (k) {
          var s = c.strategies[k];
          if (s && s.live_pct != null && isFinite(s.live_pct) && s.bench_pct != null && isFinite(s.bench_pct)) any = true;
        });
        if (!any) return;
        if (window.MFCLive === data) data.last_cycle = c;
        document.querySelectorAll("[data-live-wrap][data-live-new]").forEach(function (w) {
          w.classList.add("has-last");
        });
        try {
          document.dispatchEvent(new CustomEvent("mfc-live-last", { detail: c }));
        } catch (e) {}
      })
      .catch(function () {});
  }
  // the cycle's own dates, "31 Aug → 30 Sept", for a LAST CYCLE label
  window.MFCLiveSpan = function (c) {
    return c ? fmtDayMonth(c.rebalance_date) + NB + "\u2192" + NB + fmtDayMonth(c.data_through) : "";
  };

  /* V44.3 — see the note at the top of mfc-live.css. Only ever called once. */
  var settled = false;
  function settle(live) {
    if (settled) return;
    settled = true;
    if (!live) {
      document.querySelectorAll("[data-live-static]").forEach(function (el) {
        el.classList.remove("live-ready", "has-live");
      });
    }
    document.documentElement.classList.add("mf-live-settled");
  }

  function boot() {
    fillDedicated();
    setTimeout(function () { settle(false); }, 8000);   // a hung request must not keep the slots blank
    // cache-bust hourly — fresh enough for a twice-daily data pipeline without
    // defeating the CDN entirely
    var bust = Math.floor(Date.now() / 3600000);
    fetch("/live-perf.json?t=" + bust, { credentials: "omit" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        if (!d || !d.strategies) { settle(false); return; }
        d.zero_session = zeroSession(d);
        window.MFCLive = d;
        var live = fill(d);
        if (!d.zero_session) fillMeters(d);
        settle(!!live);
        // V44.2 — always, zero session or not: the homepage hero paints its column from this
        try { document.dispatchEvent(new CustomEvent("mfc-live-data", { detail: d })); } catch (e) {}
      })
      .catch(function () { settle(false); /* fail-soft: page stays in its pre-pivot state */ });
  }

  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();

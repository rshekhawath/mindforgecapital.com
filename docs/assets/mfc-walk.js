/* ════════════════════════════════════════════════════════════════════════════
   mfc-walk.js — V40.6 · the homepage's #get-started walkthrough
   Three steps beside a phone that plays each one (mfc-walk.css explains the
   look). This file:
     · writes every price from the page's own STRAT_MONTHLY / DURATIONS, so the
       walkthrough cannot quote a different price from the pricing cards;
     · plays each step's little script — screens, a hand that taps, the
       keyboard — on one clock, with a progress bar under the active step;
     · plays only while the section is on screen and the tab is visible, stops
       by itself after two rounds, and has Previous / Pause / Next controls
       (WCAG 2.2.2); a step button jumps straight to that step;
     · under prefers-reduced-motion never plays: each step shows its finished
       screen, and the step buttons move between them.
   The phone is aria-hidden (an illustration); the step list carries the words.
   No storage, no network. A page without #get-started is left untouched.

   V41.4 — a tap is what a person does, not a dot that slides: a beat to look,
   a reach along a slight arc that slows as it arrives (and overshoots by a
   hair), the press (the hand sinks, the control goes down, a ripple spreads
   from the fingertip), the release (the control answers), and the hand easing
   off to watch. Reach time grows with distance; where a finger lands inside a
   control varies a little from tap to tap, the same way on every round. The
   list keeps the height of its tallest step, so nothing below it jumps when the
   step changes (V40.6 moved the phone 23–47px on a phone, 12px on a desktop).
   ════════════════════════════════════════════════════════════════════════════ */
(function (w, d) {
  "use strict";
  var root = d.getElementById("get-started");
  if (!root) return;
  var screen = root.querySelector(".mfw-screen"), hand = root.querySelector(".mfw-hand"),
      ripple = root.querySelector(".mfw-ripple"), list = root.querySelector(".mfw-steps");
  var steps = [].slice.call(root.querySelectorAll(".mfw-step"));
  if (!screen || !hand || !ripple || !list || steps.length !== 3) return;
  root.classList.add("mfw-js");
  var bars = steps.map(function (s) { return s.querySelector(".mfw-bar i"); });
  var frames = [].slice.call(root.querySelectorAll(".mfw-fr"));
  var rows = [].slice.call(root.querySelectorAll(".mfw-ord"));
  var ctx = root.querySelector(".mfw-ctx"), bPause = root.querySelector('[data-act="pause"]');
  var mq = null, reduce = false;
  try { mq = w.matchMedia("(prefers-reduced-motion: reduce)"); reduce = mq.matches; } catch (e) {}

  /* ── prices, from the page that sells the plans ───────────────────────── */
  function inr(n) { return "₹" + Math.round(n).toLocaleString("en-IN"); }
  try {
    var M = w.STRAT_MONTHLY, DUR = w.DURATIONS;
    if (M) {
      [].forEach.call(root.querySelectorAll("[data-mfw-month]"), function (el) {
        var v = M[el.getAttribute("data-mfw-month")];
        if (typeof v === "number" && v > 0) el.textContent = inr(v) + "/month";
      });
      if (DUR) [].forEach.call(root.querySelectorAll("[data-mfw-term]"), function (el) {
        var p = el.getAttribute("data-mfw-term").split(":"), v = M[p[0]], t = DUR[p[1]];
        if (typeof v === "number" && v > 0 && t) el.textContent = inr(v * t.months * (1 - t.disc));
      });
      if (DUR) [].forEach.call(root.querySelectorAll("[data-mfw-off]"), function (el) {
        var t = DUR[el.getAttribute("data-mfw-off")];
        if (t && t.disc > 0) el.textContent = Math.round(t.disc * 100) + "% off";
      });
    }
  } catch (e) {}

  /* ── the keyboard's keys (written here so the page carries none of them) ─ */
  var keys = root.querySelector(".mfw-keys");
  if (keys && !keys.firstChild) {
    var KEY = { "^": ["mfw-kw mfw-kshift", ""], "<": ["mfw-kw mfw-kdel", ""], "#": ["mfw-kw", "123"],
                " ": ["mfw-ksp", "space"], "_": ["mfw-kw mfw-kret", "return"] };
    var kf = d.createDocumentFragment();
    ["qwertyuiop", "asdfghjkl", "^zxcvbnm<", "#@ ._"].forEach(function (row) {
      var r = d.createElement("div"); r.className = "mfw-kr";
      row.split("").forEach(function (c) {
        var k = d.createElement("span"), s = KEY[c];
        if (s) { k.className = s[0]; k.textContent = s[1]; } else k.textContent = c;
        r.appendChild(k);
      });
      kf.appendChild(r);
    });
    keys.appendChild(kf);
  }

  /* ── each step's script ───────────────────────────────────────────────────
     ["tap", target, effect]: the effect lands on RELEASE, as a real control's
     does — show:<screen>, open:/close:<screen> (its sheet), kbd:open|close,
     fill:<field> (from the keyboard's suggestion), busy:<button>. */
  var SCRIPT = [
    [["show", "books"], ["wait", 650], ["tap", "lm", "show:book"], ["wait", 1150], ["tap", "choose"], ["leave"]],
    [["show", "form"], ["wait", 450], ["tap", "email", "kbd:open"], ["wait", 150], ["tap", "suggest", "fill:email"], ["wait", 250],
     ["tap", "kdone", "kbd:close"], ["wait", 120], ["tap", "dur12"], ["tap", "agree"], ["tap", "register", "busy:register"],
     ["leave"], ["wait", 350], ["show", "done"], ["wait", 2500]],
    [["show", "dash"], ["wait", 1250], ["tap", "review", "open:dash"], ["wait", 450], ["tap", "placeall", "close:dash"],
     ["leave"], ["ticks", 1800], ["wait", 250], ["show", "placed"], ["wait", 2400]]
  ];
  // one tap, in ms: a beat to look, the reach (by distance), settle, press, hold, release, ease off
  var THINK = 120, SETTLE = 100, PRESS = 80, HOLD = 90, RELEASE = 110, EASE = 170, LEAVE = 520, ROUNDS = 2, HOLD_END = 500;
  var RIPPLE = 560, ROT = -12;
  // the fingertip inside the 46x74.75 hand (viewBox 64x104, tip at 22.5,4) — the transform pivots here
  var TX = 16.17, TY = 2.88;

  var aimCache = {};
  function $(k) { return aimCache[k] || (aimCache[k] = root.querySelector('[data-mfw-t="' + k + '"]')); }
  function frameEl(name) { for (var i = 0; i < frames.length; i++) if (frames[i].getAttribute("data-f") === name) return frames[i]; return null; }
  function onFrame() { for (var i = 0; i < frames.length; i++) if (frames[i].classList.contains("on")) return frames[i]; return null; }

  // a screen is cleaned just before it slides in, so a replay never shows the last round's taps
  function prime(f) {
    f.classList.remove("is-open", "is-kbd");
    [].forEach.call(f.querySelectorAll(".is-picked, .is-down, .is-placed, .is-live, .is-busy"), function (el) {
      el.classList.remove("is-picked", "is-down", "is-placed", "is-live", "is-busy");
    });
    [].forEach.call(f.querySelectorAll("[data-mfw-typed]"), function (el) { el.textContent = ""; });
  }
  function show(name) {
    var fe = frameEl(name), was = onFrame();
    if (!fe) return;
    if (ctx && fe.getAttribute("data-ctx")) ctx.textContent = fe.getAttribute("data-ctx");
    if (fe === was) return;
    prime(fe);
    if (was) {
      // park the incoming screen at the right edge without animating (it may have
      // left to the left last time), then push it in over the outgoing one
      fe.classList.add("mfw-now"); fe.classList.remove("on", "out"); void fe.offsetWidth; fe.classList.remove("mfw-now");
      was.classList.remove("on"); was.classList.add("out");
    }
    fe.classList.add("on");             // the very first screen just appears: no reflow at page load
  }
  function effect(spec) {
    if (!spec) return;
    var p = spec.split(":"), k = p[0], v = p[1], f, el;
    if (k === "show") show(v);
    else if (k === "open" || k === "close") { f = frameEl(v); if (f) f.classList.toggle("is-open", k === "open"); }
    else if (k === "kbd") {
      f = frameEl("form"); if (f) f.classList.toggle("is-kbd", v === "open");
      el = $("email"); if (el) el.classList.toggle("is-live", v === "open");
    } else if (k === "fill") {
      el = $(v); var out = el && el.querySelector("[data-mfw-typed]"), sug = $("suggest");
      if (out) out.textContent = sug ? sug.textContent : "";
    } else if (k === "busy") { el = $(v); if (el) el.classList.add("is-busy"); }
  }

  /* ── where a finger goes ──────────────────────────────────────────────── */
  // position relative to the screen from offsets, which ignore the screens' and
  // sheets' slide transforms — so a target is found where it will be, not mid-slide
  function spot(el) {
    var x = el.offsetWidth / 2, y = el.offsetHeight / 2, n = el;
    while (n && n !== screen) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x: x, y: y, w: el.offsetWidth, h: el.offsetHeight };
  }
  function rnd(n) { var x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); }
  function aim(k, seed) {
    var el = $(k); if (!el) return null;
    var a = el.querySelector("[data-mfw-aim]") || el, s = spot(a);
    // a person lands near the middle, not on it: a few px either way, the same every round
    return { x: s.x + (rnd(seed) - 0.5) * Math.min(s.w * 0.36, 16), y: s.y + (rnd(seed + 0.5) - 0.5) * Math.min(s.h * 0.3, 7) };
  }
  function entry() { return { x: screen.clientWidth * 0.74, y: screen.clientHeight + 52 }; }
  function exitPt() { return { x: screen.clientWidth * 0.88, y: screen.clientHeight + 70 }; }
  function dist(a, b) { var x = b.x - a.x, y = b.y - a.y; return Math.sqrt(x * x + y * y); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function jerk(t) { return t * t * t * (10 + t * (-15 + 6 * t)); }       // minimum-jerk: how a hand reaches
  function outQ(t) { return 1 - (1 - t) * (1 - t); }
  function inQ(t) { return t * t; }

  var H = { x: 0, y: 0, on: false }, poseStr = "", rip = null;
  function pose(x, y, s, r) {
    H.x = x; H.y = y;
    var str = "translate(" + (x - TX).toFixed(1) + "px," + (y - TY).toFixed(1) + "px) rotate(" + r.toFixed(2) + "deg) scale(" + s.toFixed(3) + ")";
    if (str !== poseStr) { poseStr = str; hand.style.transform = str; }
    if (!H.on) { H.on = true; hand.classList.add("is-on"); }
  }
  function handOff() { H.on = false; hand.classList.remove("is-on"); }
  function drawRipple(now) {
    if (!rip) return;
    var q = (now - rip.t0) / RIPPLE;
    if (q >= 1 || q < 0) { ripple.style.opacity = "0"; rip = null; return; }
    var s = 0.25 + 0.85 * (1 - Math.pow(1 - q, 3)), o = q < 0.2 ? 0.95 : 0.95 * (1 - (q - 0.2) / 0.8);
    ripple.style.transform = "translate(" + rip.x.toFixed(1) + "px," + rip.y.toFixed(1) + "px) scale(" + s.toFixed(3) + ")";
    ripple.style.opacity = o.toFixed(3);
  }

  /* ── one clock: begin / update(p) / finish per action ─────────────────── */
  // measure=false (page load, reduced motion) plans without reading layout: every
  // reach gets a middling length, and the step is planned again, measured, when it plays
  function compile(list, n, measure) {
    var out = [], at = 0, pos = null, seed = n * 10;
    list.forEach(function (a) {
      var it = { a: a, at: at, dur: 0, begun: false, done: false };
      if (a[0] === "wait" || a[0] === "ticks") it.dur = a[1];
      else if (a[0] === "leave") { it.dur = LEAVE; pos = null; }
      else if (a[0] === "tap") {
        it.seed = ++seed;
        var to = measure ? aim(a[1], it.seed) || entry() : null, from = pos || (measure ? entry() : null);
        it.mv = to && from ? clamp(260 + 1.25 * dist(from, to), 300, 640) : 460;
        it.dur = THINK + it.mv + SETTLE + PRESS + HOLD + RELEASE + EASE;
        pos = to ? { x: to.x + 12, y: to.y + 16 } : null;
      }
      out.push(it); at += it.dur;
    });
    return { items: out, total: at };
  }
  function begin(it, quiet) {
    var a = it.a;
    if (a[0] === "show") show(a[1]);
    else if (a[0] === "open" || a[0] === "close") effect(a[0] + ":" + a[1]);
    else if (a[0] === "tap" && !quiet) {
      it.to = aim(a[1], it.seed) || entry();
      it.from = H.on ? { x: H.x, y: H.y } : entry();
      var dx = it.to.x - it.from.x, dy = it.to.y - it.from.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      // the reach bows a little to the right, as an arm swinging from the elbow does
      var px = -dy / len, py = dx / len; if (px < 0) { px = -px; py = -py; }
      var amp = Math.min(26, 0.14 * len), ov = Math.min(3, 0.02 * len);
      it.c = { x: (it.from.x + it.to.x) / 2 + px * amp, y: (it.from.y + it.to.y) / 2 + py * amp };
      it.over = { x: it.to.x + dx / len * ov, y: it.to.y + dy / len * ov };
    } else if (a[0] === "leave" && !quiet) { it.from = H.on ? { x: H.x, y: H.y } : null; it.to = exitPt(); }
  }
  function down(it, quiet) {
    if (it.downed) return; it.downed = true;
    var el = $(it.a[1]); if (el && !quiet) el.classList.add("is-down");
    if (!quiet) rip = { x: it.to.x, y: it.to.y, t0: it.at + THINK + it.mv + SETTLE };
  }
  function up(it, quiet) {
    if (it.upped) return; down(it, quiet); it.upped = true;
    var el = $(it.a[1]); if (el) { el.classList.remove("is-down"); el.classList.add("is-picked"); }
    effect(it.a[2]);
  }
  function update(it, p, el, quiet) {
    var a = it.a;
    if (a[0] === "tap") {
      var t1 = THINK, t2 = t1 + it.mv, t3 = t2 + SETTLE, t4 = t3 + PRESS, t5 = t4 + HOLD, t6 = t5 + RELEASE;
      if (quiet) { up(it, true); return; }
      if (el >= t3) down(it);
      if (el >= t5) up(it);
      var f = it.from, o = it.over, q, x, y;
      if (el < t1) pose(f.x, f.y, 1.05, ROT);
      else if (el < t2) {                                   // the reach
        q = (el - t1) / it.mv; var s = jerk(q), u = 1 - s;
        x = u * u * f.x + 2 * u * s * it.c.x + s * s * o.x;
        y = u * u * f.y + 2 * u * s * it.c.y + s * s * o.y;
        pose(x, y, 1.05 - 0.05 * s, ROT + 4 * Math.sin(Math.PI * q));
      } else if (el < t3) {                                 // settle onto the spot
        q = outQ((el - t2) / SETTLE);
        pose(o.x + (it.to.x - o.x) * q, o.y + (it.to.y - o.y) * q, 1, ROT);
      } else if (el < t4) pose(it.to.x, it.to.y, 1 - 0.1 * inQ((el - t3) / PRESS), ROT + 1);       // press
      else if (el < t5) pose(it.to.x, it.to.y, 0.9, ROT + 1);                                       // hold
      else if (el < t6) pose(it.to.x, it.to.y, 0.9 + 0.1 * outQ((el - t5) / RELEASE), ROT);         // release
      else {                                                                                       // ease off
        q = outQ(Math.min(1, (el - t6) / EASE));
        pose(it.to.x + 12 * q, it.to.y + 16 * q, 1 + 0.04 * q, ROT);
      }
    } else if (a[0] === "leave") {
      if (quiet || !it.from) return;
      var k = inQ(p);
      pose(it.from.x + (it.to.x - it.from.x) * k, it.from.y + (it.to.y - it.from.y) * k, 1.04 + 0.03 * k, ROT - 4 * k);
    } else if (a[0] === "ticks") {
      var n = Math.round(p * rows.length);
      if (n !== it.n) { it.n = n; for (var i = 0; i < rows.length; i++) rows[i].classList.toggle("is-placed", i < n); }
    }
  }
  function finish(it, quiet) {
    if (it.a[0] === "leave" && !quiet) handOff();
  }

  var cur = 0, items = [], total = 1, t = 0, playing = false, userPaused = false, visible = false, raf = 0, last = 0, rounds = 0, planned = false;
  function run(upTo) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.done) continue;
      if (upTo < it.at) break;
      if (!it.begun) { begin(it); it.begun = true; }
      var p = it.dur ? Math.min(1, (upTo - it.at) / it.dur) : 1;
      update(it, p, upTo - it.at);
      if (p >= 1) { finish(it); it.done = true; } else break;
    }
    drawRipple(upTo);
    if (bars[cur]) bars[cur].style.transform = "scaleX(" + Math.min(1, upTo / total).toFixed(4) + ")";
  }
  function still() {          // the finished screen, no hand: reduced motion
    items.forEach(function (it) { begin(it, true); update(it, 1, it.dur, true); finish(it, true); it.done = true; });
    if (bars[cur]) bars[cur].style.transform = "scaleX(1)";
  }
  function go(n) {
    cur = (n + steps.length) % steps.length;
    steps.forEach(function (s, i) {
      var on = i === cur, b = s.querySelector(".mfw-sbtn");
      s.classList.toggle("is-on", on);
      if (b) { if (on) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current"); }
      if (bars[i]) bars[i].style.transform = "scaleX(0)";
    });
    handOff(); rip = null; ripple.style.opacity = "0";
    // a step replayed from its own first screen starts that screen clean too
    var first = SCRIPT[cur][0], f0 = first[0] === "show" ? frameEl(first[1]) : null;
    if (f0 && f0 === onFrame()) prime(f0);
    var c = compile(SCRIPT[cur], cur, false);
    items = c.items; total = c.total || 1; t = 0; last = 0; planned = false;
    if (reduce) still(); else run(0);
  }
  function tick(now) {
    raf = 0;
    if (!playing) return;
    if (!planned) {                     // the step's first frame on screen: plan its reaches from real positions
      planned = true;
      var c = compile(SCRIPT[cur], cur, true);
      items = c.items; total = c.total || 1;
    }
    var dt = last ? Math.min(100, now - last) : 16;
    last = now; t += dt;
    run(t);
    if (t >= total + HOLD_END) {
      if (cur === steps.length - 1 && ++rounds >= ROUNDS) { go(0); setPaused(true); return; }
      go(cur + 1);
    }
    raf = w.requestAnimationFrame(tick);
  }
  function sync() {
    var should = !reduce && !userPaused && visible && !d.hidden;
    if (should && !playing) { playing = true; last = 0; if (!raf) raf = w.requestAnimationFrame(tick); }
    else if (!should && playing) { playing = false; if (raf) { w.cancelAnimationFrame(raf); raf = 0; } }
  }
  function setPaused(p) {
    userPaused = p;
    if (bPause) bPause.setAttribute("aria-pressed", String(p));
    sync();
  }

  /* ── the list keeps the height of its tallest step ─────────────────────
     Measured on three invisible copies, one per state, in a single layout, so the
     real list never changes state (or starts a transition) to be measured. Again
     on resize, when the width moved. */
  var eqW = -1, rq = 0;
  function equalise() {
    var wd = list.getBoundingClientRect().width;
    if (!wd || wd === eqW) return;
    eqW = wd;
    var host = list.parentNode, cs = [], max = 0, i;
    for (i = 0; i < steps.length; i++) {
      var c = list.cloneNode(true), lis = c.children;
      for (var j = 0; j < lis.length; j++) lis[j].classList.toggle("is-on", i === j);
      c.setAttribute("aria-hidden", "true");
      c.style.cssText = "position:absolute;left:0;top:0;width:" + wd + "px;min-height:0;margin:0;visibility:hidden;pointer-events:none";
      host.appendChild(c); cs.push(c);
    }
    // fractional heights: offsetHeight rounds, and that left a 1px jump at 340px
    for (i = 0; i < cs.length; i++) max = Math.max(max, cs[i].getBoundingClientRect().height);
    for (i = 0; i < cs.length; i++) host.removeChild(cs[i]);
    list.style.minHeight = max ? Math.ceil(max) + "px" : "";
  }
  equalise();
  w.addEventListener("resize", function () {
    if (!rq) rq = w.requestAnimationFrame(function () { rq = 0; equalise(); });
  }, { passive: true });

  /* ── wiring ───────────────────────────────────────────────────────────── */
  steps.forEach(function (s, i) {
    var b = s.querySelector(".mfw-sbtn");
    if (b) b.addEventListener("click", function () { rounds = 0; go(i); if (!reduce) setPaused(false); });
  });
  root.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!b) return;
    var act = b.getAttribute("data-act");
    if (act === "prev" || act === "next") { rounds = 0; go(cur + (act === "next" ? 1 : -1)); if (!reduce) setPaused(false); }
    else if (act === "pause") { rounds = 0; setPaused(!userPaused); }
  });
  if (bPause) bPause.hidden = reduce;      // nothing moves, so nothing to pause
  if (mq) {                                // the setting can change while the page is open
    var onMq = function () { reduce = mq.matches; if (bPause) bPause.hidden = reduce; rounds = 0; go(cur); sync(); };
    if (mq.addEventListener) mq.addEventListener("change", onMq); else if (mq.addListener) mq.addListener(onMq);
  }
  d.addEventListener("visibilitychange", sync);
  // plays while the PHONE is at least half on screen — on a phone the steps come
  // first, and the walkthrough should not run through unseen above the fold
  var watch = root.querySelector(".mfw-device") || root;
  if ("IntersectionObserver" in w) {
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting && es[0].intersectionRatio >= 0.5; sync(); },
      { threshold: [0, 0.5, 0.8] }).observe(watch);
  } else { visible = true; }
  go(0);
  sync();
})(window, document);

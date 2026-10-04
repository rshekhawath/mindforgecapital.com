/* ════════════════════════════════════════════════════════════════════════════
   mfc-walk.js — V40.6 · the homepage's #get-started walkthrough
   Three steps beside a phone that plays each one (mfc-walk.css explains the
   look). This file:
     · writes every price from the page's own STRAT_MONTHLY / DURATIONS, so the
       walkthrough cannot quote a different price from the pricing cards;
     · plays each step's little script — frames, a simulated finger, typing —
       on one clock, with a progress bar under the active step;
     · plays only while the section is on screen and the tab is visible, stops
       by itself after two rounds, and has Previous / Pause / Next controls
       (WCAG 2.2.2); a step button jumps straight to that step;
     · under prefers-reduced-motion never plays: each step shows its finished
       screen, and the step buttons move between them.
   The phone is aria-hidden (an illustration); the step list carries the words.
   No storage, no network. A page without #get-started is left untouched.
   ════════════════════════════════════════════════════════════════════════════ */
(function (w, d) {
  "use strict";
  var root = d.getElementById("get-started");
  if (!root) return;
  var screen = root.querySelector(".mfw-screen"), finger = root.querySelector(".mfw-tap");
  var steps = [].slice.call(root.querySelectorAll(".mfw-step"));
  if (!screen || !finger || steps.length !== 3) return;
  var bars = steps.map(function (s) { return s.querySelector(".mfw-bar i"); });
  var frames = [].slice.call(root.querySelectorAll(".mfw-fr"));
  var bPause = root.querySelector('[data-act="pause"]');
  var reduce = false;
  try { reduce = w.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

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

  /* ── each step's script ───────────────────────────────────────────────── */
  var SCRIPT = [
    [["show", "books"], ["wait", 1100], ["tap", "lm"], ["show", "book"], ["wait", 1500], ["tap", "choose"], ["wait", 400]],
    [["show", "form"], ["wait", 350], ["type", "email", "you@example.com", 1300], ["wait", 250], ["tap", "dur12"],
     ["tap", "agree"], ["tap", "register"], ["show", "done"], ["wait", 2700]],
    [["show", "dash"], ["wait", 1500], ["tap", "review"], ["open", "dash"], ["wait", 900], ["tap", "placeall"],
     ["close", "dash"], ["ticks", 2000], ["wait", 300], ["show", "placed"], ["wait", 2500]]
  ];
  var TAP = 900, HOLD = 500, ROUNDS = 2;

  function $(k) { return root.querySelector('[data-mfw-t="' + k + '"]'); }
  function frameEl(name) { return root.querySelector('.mfw-fr[data-f="' + name + '"]'); }
  var ctx = root.querySelector(".mfw-ctx");
  function show(name) {
    var fe = frameEl(name);
    if (ctx && fe && fe.getAttribute("data-ctx")) ctx.textContent = fe.getAttribute("data-ctx");
    frames.forEach(function (f) {
      var on = f.getAttribute("data-f") === name;
      if (!on && f.classList.contains("on")) f.classList.add("out");
      if (on) f.classList.remove("out");
      f.classList.toggle("on", on);
    });
  }
  // position relative to the screen from offsets, which ignore the frames'
  // slide transform — a rect taken mid-slide would aim the finger 16px off
  function spot(el) {
    var x = el.offsetWidth / 2, y = el.offsetHeight / 2, n = el;
    while (n && n !== screen) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return [x, y];
  }
  function reset() {
    frames.forEach(function (f) { f.classList.remove("on", "out", "is-open"); });
    [].forEach.call(root.querySelectorAll(".is-picked, .is-placed, .is-live"), function (el) {
      el.classList.remove("is-picked", "is-placed", "is-live");
    });
    [].forEach.call(root.querySelectorAll("[data-mfw-typed]"), function (el) { el.textContent = ""; });
    finger.classList.remove("is-on", "is-press");
  }

  /* ── one clock: begin / update(p) / finish per action ─────────────────── */
  function compile(list) {
    var out = [], at = 0;
    list.forEach(function (a) {
      var dur = a[0] === "wait" ? a[1] : a[0] === "tap" ? TAP : a[0] === "type" ? a[3] : a[0] === "ticks" ? a[1] : 0;
      out.push({ a: a, at: at, dur: dur, begun: false, done: false, pressed: false });
      at += dur;
    });
    return { items: out, total: at };
  }
  function begin(it, quiet) {
    var a = it.a;
    if (a[0] === "show") show(a[1]);
    else if (a[0] === "open" || a[0] === "close") { var f = frameEl(a[1]); if (f) f.classList.toggle("is-open", a[0] === "open"); }
    else if (a[0] === "tap" && !quiet) {
      var el = $(a[1]); if (!el) return;
      var p = spot(el);
      finger.style.transform = "translate(" + p[0].toFixed(1) + "px," + p[1].toFixed(1) + "px)";
      finger.classList.add("is-on");
    } else if (a[0] === "type") { var t = $(a[1]); if (t) t.classList.add("is-live"); }
  }
  function update(it, p, quiet) {
    var a = it.a;
    if (a[0] === "tap" && (p >= 0.55 || quiet) && !it.pressed) {
      it.pressed = true;
      var el = $(a[1]); if (el) el.classList.add("is-picked");
      if (!quiet) { finger.classList.remove("is-press"); void finger.offsetWidth; finger.classList.add("is-press"); }
    } else if (a[0] === "type") {
      var t = $(a[1]), out = t && t.querySelector("[data-mfw-typed]");
      if (out) out.textContent = a[2].slice(0, Math.ceil(p * a[2].length));
    } else if (a[0] === "ticks") {
      var rows = root.querySelectorAll(".mfw-ord"), n = Math.round(p * rows.length);
      for (var i = 0; i < rows.length; i++) rows[i].classList.toggle("is-placed", i < n);
    }
  }
  function finish(it) {
    if (it.a[0] === "type") { var t = $(it.a[1]); if (t) t.classList.remove("is-live"); }
    if (it.a[0] === "tap") finger.classList.remove("is-on", "is-press");   // the finger lifts after each tap
  }

  var cur = 0, items = [], total = 1, t = 0, playing = false, userPaused = false, visible = false, raf = 0, last = 0, rounds = 0;
  function run(upTo) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.done) continue;
      if (upTo < it.at) break;
      if (!it.begun) { begin(it); it.begun = true; }
      var p = it.dur ? Math.min(1, (upTo - it.at) / it.dur) : 1;
      update(it, p);
      if (p >= 1) { finish(it); it.done = true; } else break;
    }
    if (bars[cur]) bars[cur].style.transform = "scaleX(" + Math.min(1, upTo / total).toFixed(4) + ")";
  }
  function still() {          // the finished screen, no finger: reduced motion
    items.forEach(function (it) { begin(it, true); update(it, 1, true); finish(it); it.done = true; });
    finger.classList.remove("is-on");
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
    var c = compile(SCRIPT[cur]);
    items = c.items; total = c.total || 1; t = 0; last = 0;
    reset();
    if (reduce) still(); else run(0);
  }
  function tick(now) {
    raf = 0;
    if (!playing) return;
    var dt = last ? Math.min(100, now - last) : 16;
    last = now; t += dt;
    run(t);
    if (t >= total + HOLD) {
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
  if (reduce && bPause) bPause.hidden = true;      // nothing moves, so nothing to pause
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

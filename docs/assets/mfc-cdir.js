/* ════════════════════════════════════════════════════════════════════════════
   mfc-cdir.js — V40.4 · the calculator directory and the hub's search
   The markup is written into every page (mfc-cdir.css explains why); this only
   makes it behave:
     · in a sideways rail, the page you are on is scrolled to the middle of the
       row — without moving the page itself — so "where am I" is never off-screen;
     · a fade marks whichever edge still hides chips (the house scroll cue);
     · "Show all" swaps the rail for the grouped grid, and back;
     · on the hub, the search box filters the grouped cards as you type.
   No storage, no network. A page without the markup is left untouched.
   ════════════════════════════════════════════════════════════════════════════ */
(function (w, d) {
  "use strict";
  function ready(fn) { if (d.readyState !== 'loading') fn(); else d.addEventListener('DOMContentLoaded', fn); }

  function wireDirectory(nav) {
    var list = nav.querySelector('.cdir-list'), tog = nav.querySelector('.cdir-tog');
    if (!list) return;
    function cue() {
      var max = list.scrollWidth - list.clientWidth;
      list.classList.toggle('cdir-more-r', max > 4 && list.scrollLeft < max - 4);
      list.classList.toggle('cdir-more-l', max > 4 && list.scrollLeft > 4);
    }
    function centre() {
      var cur = list.querySelector('[aria-current="page"]');
      var max = list.scrollWidth - list.clientWidth;
      if (!cur || max <= 0) { cue(); return; }
      var lr = list.getBoundingClientRect(), cr = cur.getBoundingClientRect();
      var x = list.scrollLeft + (cr.left - lr.left) - (list.clientWidth - cr.width) / 2;
      list.scrollLeft = Math.max(0, Math.min(max, x));
      cue();
    }
    list.addEventListener('scroll', cue, { passive: true });
    var rt; w.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(cue, 120); }, { passive: true });
    if (tog) {
      tog.addEventListener('click', function () {
        var open = nav.getAttribute('data-mode') === 'rail';
        nav.setAttribute('data-mode', open ? 'grid' : 'rail');
        tog.setAttribute('aria-expanded', String(open));
        var t = tog.querySelector('.t'); if (t) t.textContent = open ? 'Show less' : 'Show all';
        list.classList.remove('cdir-more-l', 'cdir-more-r');
        if (!open) centre(); else cue();
      });
    }
    centre();
    // fonts can change chip widths after first paint
    try { if (d.fonts && d.fonts.ready) d.fonts.ready.then(function () { if (nav.getAttribute('data-mode') === 'rail') centre(); }); } catch (e) {}
  }

  /* The hub's search. A card matches when every word typed appears in its name,
     its one-line description or its keywords (data-k: "emi loan home car…"),
     so "home loan", "tax" or "retire" all find something. A group whose cards
     are all filtered out loses its heading too; nothing matching says so. */
  function wireSearch(input) {
    var hub = d.querySelector('.crel-hub'); if (!hub) return;
    var cards = [].slice.call(hub.querySelectorAll('.crel-card'));
    var none = d.getElementById('cdir-none');
    function text(c) { return ((c.textContent || '') + ' ' + (c.getAttribute('data-k') || '')).toLowerCase(); }
    var hay = cards.map(text);
    function apply() {
      var words = String(input.value || '').toLowerCase().replace(/[^a-z0-9₹%+ -]/g, ' ').split(/\s+/).filter(Boolean);
      var shown = 0;
      cards.forEach(function (c, i) {
        var ok = words.every(function (wd) { return hay[i].indexOf(wd) >= 0; });
        c.classList.toggle('is-out', !ok);
        if (ok) shown++;
      });
      [].forEach.call(hub.querySelectorAll('.crel-grid'), function (g) {
        var any = g.querySelector('.crel-card:not(.is-out)');
        g.classList.toggle('is-out', !any);
        var h = g.previousElementSibling;
        if (h && h.tagName === 'H3') h.classList.toggle('is-out', !any);
      });
      if (none) {
        none.hidden = shown > 0;
        var q = none.querySelector('q'); if (q) q.textContent = input.value.trim();
      }
    }
    input.addEventListener('input', apply);
    input.addEventListener('keydown', function (e) { if (e.key === 'Escape' && input.value) { input.value = ''; apply(); } });
    if (input.value) apply();
  }

  ready(function () {
    try { [].forEach.call(d.querySelectorAll('.cdir'), wireDirectory); } catch (e) {}
    try { var q = d.getElementById('cdir-q'); if (q) wireSearch(q); } catch (e) {}
  });
})(window, document);

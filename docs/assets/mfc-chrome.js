/*! mfc-chrome.js — shared page chrome: scroll-progress bar + back-to-top control.
   Additive & fully self-contained. Brings the polished top-of-page scroll
   indicator and the return-to-top affordance (previously only on index.html /
   strategies.html) to every long page — dashboard, strategy details, calculator,
   factor-report, fii-dii, scores, legal & auth surfaces — for site-wide
   consistency. V20.9.

   Design notes:
   • NO-OP on pages that already ship their own (#scroll-progress / #back-to-top),
     so the already-saturated flagships are never touched or double-rendered.
   • Distinct class names (mfc-sp / mfc-btt) → zero CSS collision with those inline
     implementations.
   • Themed purely through existing design tokens (var(--accent…/--ink2/--border2)),
     which flip under html[data-theme="dark"], so it is correct in both themes with
     no per-page overrides.
   • Contextual vertical placement: lifts clear of the floating WhatsApp button and
     the mobile sticky CTA bar when those are present.
   • Respects prefers-reduced-motion (no width tween, instant scroll-to-top). */
(function () {
  var D = document, W = window;
  if (D.getElementById('mfc-chrome-style')) return;                                 // idempotent
  if (D.getElementById('scroll-progress') || D.getElementById('back-to-top')) return; // page ships its own

  var reduce = W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // — scoped styles (distinct classes; theme-aware via tokens with safe fallbacks) —
  var css = [
    '.mfc-sp{position:fixed;top:0;left:0;height:2.5px;width:0;z-index:1000;pointer-events:none;',
      'background:linear-gradient(90deg,var(--accent,#1a50d8),var(--accent3,#3b82f6));',
      'box-shadow:0 0 12px rgba(26,80,216,.5);', (reduce ? '' : 'transition:width .05s linear;'), '}',
    '.mfc-btt{position:fixed;right:24px;bottom:var(--mfc-btt-b,24px);width:44px;height:44px;border-radius:50%;',
      'background:var(--ink2,#fff);border:0.5px solid var(--border2,rgba(37,99,235,.2));color:var(--accent2,#2563eb);',
      'display:inline-flex;align-items:center;justify-content:center;cursor:pointer;z-index:89;opacity:0;',
      'pointer-events:none;transform:translateY(8px);',
      'transition:opacity .25s ease,transform .25s ease,background .25s ease,color .25s ease,border-color .25s ease;',
      'box-shadow:0 8px 24px -8px rgba(26,80,216,.20),inset 0 1px 0 rgba(255,255,255,.7);}',
    '.mfc-btt.visible{opacity:1;pointer-events:auto;transform:translateY(0);}',
    '.mfc-btt:hover{transform:translateY(-2px);background:var(--accent,#1a50d8);color:#fff;',
      'border-color:var(--accent,#1a50d8);box-shadow:0 12px 28px -8px rgba(26,80,216,.45);}',
    '.mfc-btt:focus-visible{outline:2px solid var(--accent2,#2563eb);outline-offset:3px;}',
    'html[data-theme="dark"] .mfc-btt{box-shadow:0 8px 24px -8px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.06);}',
    '@media(max-width:768px){.mfc-btt{right:16px;width:40px;height:40px;bottom:var(--mfc-btt-bm,24px);}}'
  ].join('');
  var st = D.createElement('style'); st.id = 'mfc-chrome-style'; st.textContent = css;
  D.head.appendChild(st);

  // — inject elements —
  var bar = D.createElement('div');
  bar.className = 'mfc-sp'; bar.setAttribute('aria-hidden', 'true');
  var btn = D.createElement('button');
  btn.type = 'button'; btn.className = 'mfc-btt'; btn.setAttribute('aria-label', 'Back to top');
  btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="18 15 12 9 6 15"/></svg>';
  D.body.appendChild(bar); D.body.appendChild(btn);

  // — contextual vertical placement: clear the WhatsApp FAB + mobile sticky CTA —
  // Mirrors the homepage's proven offsets (desktop 90px / mobile 150px) so the
  // control never lands on top of the WhatsApp button, but keeps the clean 24px
  // corner on pages that have neither obstacle.
  function place() {
    var fab  = D.querySelector('.fab-wa');
    var mcta = D.querySelector('.mobile-cta-bar');
    var mctaOn = !!(mcta && getComputedStyle(mcta).display !== 'none' &&
                    mcta.getBoundingClientRect().height > 4);
    var root = D.documentElement.style;
    root.setProperty('--mfc-btt-b',  fab ? '90px' : '24px');            // desktop
    root.setProperty('--mfc-btt-bm', (fab || mctaOn) ? '150px' : '24px'); // mobile
  }

  // — scroll wiring —
  function onScroll() {
    var doc = D.documentElement, y = W.scrollY || W.pageYOffset || 0;
    var max = (doc.scrollHeight - doc.clientHeight) || 1;
    bar.style.width = Math.min(100, Math.max(0, (y / max) * 100)) + '%';
    btn.classList.toggle('visible', y > 600);
  }
  btn.addEventListener('click', function () {
    W.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); btn.blur();
  });

  place(); onScroll();
  W.addEventListener('scroll', onScroll, { passive: true });
  W.addEventListener('resize', function () { place(); onScroll(); }, { passive: true });
})();

/*! mfc-chrome.js — shared page chrome, injected only where missing. V20.9.

   PRIMARY PURPOSE — the return-to-top control: a back-to-top button was present
   on only index.html & strategies.html; this brings it to every other long page
   (dashboard, the 5 strategy details, calculator, factor-report, fii-dii, scores
   + company scorecard, privacy, terms, 404, login, signup, recover) for site-wide
   consistency.

   SECONDARY — scroll-progress parity: the site-standard bar (.mf-scroll-prog v3.4)
   already ships on 15 of those pages, so this NEVER duplicates it. It injects a
   byte-identical .mf-scroll-prog ONLY on the two pages that lack one (404,
   scores/company.html), so every page ends up with exactly one.

   Design:
   • Each control is injected independently and ONLY if the page has none — guards
     cover the site-standard (.mf-scroll-prog / #mf-scroll-prog), the legacy
     index/strategies bar (#scroll-progress), and any back-to-top (.back-to-top).
     A page that already has both (index, strategies) is left untouched.
   • The injected progress bar reuses the exact .mf-scroll-prog look; the back-to-top
     is themed purely through existing tokens (--ink2/--border2/--accent…), which
     flip under html[data-theme="dark"], so it's correct in both themes.
   • Contextual placement clears the floating WhatsApp button + mobile sticky CTA.
   • Respects prefers-reduced-motion (no width tween, instant scroll-to-top). */
(function () {
  var D = document, W = window;
  if (D.getElementById('mfc-chrome-style')) return;                       // idempotent

  var hasProg = D.querySelector('.mf-scroll-prog, #mf-scroll-prog, #scroll-progress, .scroll-progress');
  var hasTop  = D.querySelector('.back-to-top, #back-to-top, .mfc-btt');
  if (hasProg && hasTop) return;                                          // already fully equipped

  var reduce = W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // — scoped styles (only for what we actually inject) —
  var css = '';
  if (!hasProg) {
    // verbatim site-standard MF-SCROLL-PROG v3.4 look, so the two bar-less pages match
    css += '.mf-scroll-prog{position:fixed;top:0;left:0;height:3px;width:0;z-index:9999;pointer-events:none;'
        +  'background:linear-gradient(90deg,#1a50d8 0%,#2563eb 45%,#0891b2 80%,#2dd4bf 100%);'
        +  'box-shadow:0 1px 8px rgba(37,99,235,.35);' + (reduce ? '' : 'transition:width .08s linear;') + '}';
  }
  if (!hasTop) {
    css += [
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
  }
  var st = D.createElement('style'); st.id = 'mfc-chrome-style'; st.textContent = css;
  D.head.appendChild(st);

  // — inject: scroll-progress bar (only where the site has none) —
  var bar = null;
  if (!hasProg) {
    bar = D.createElement('div');
    bar.className = 'mf-scroll-prog'; bar.id = 'mfc-sp';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'Page scroll progress');
    bar.setAttribute('aria-hidden', 'true');
    D.body.appendChild(bar);
  }

  // — inject: back-to-top button (everywhere it's missing) —
  var btn = null;
  if (!hasTop) {
    btn = D.createElement('button');
    btn.type = 'button'; btn.className = 'mfc-btt'; btn.setAttribute('aria-label', 'Back to top');
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<polyline points="18 15 12 9 6 15"/></svg>';
    btn.addEventListener('click', function () {
      W.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); btn.blur();
    });
    D.body.appendChild(btn);

    // contextual vertical placement: clear the WhatsApp FAB + mobile sticky CTA.
    // Mirrors the homepage's proven offsets (desktop 90px / mobile 150px) so the
    // control never lands on the WhatsApp button, but keeps the clean 24px corner
    // on pages that have neither obstacle.
    var place = function () {
      var fab  = D.querySelector('.fab-wa');
      var mcta = D.querySelector('.mobile-cta-bar');
      var mctaOn = !!(mcta && getComputedStyle(mcta).display !== 'none' &&
                      mcta.getBoundingClientRect().height > 4);
      var root = D.documentElement.style;
      root.setProperty('--mfc-btt-b',  fab ? '90px' : '24px');            // desktop
      root.setProperty('--mfc-btt-bm', (fab || mctaOn) ? '150px' : '24px'); // mobile
    };
    place();
    W.addEventListener('resize', place, { passive: true });
  }

  // — scroll wiring (drive only the elements we own) —
  function onScroll() {
    var doc = D.documentElement, y = W.scrollY || W.pageYOffset || 0;
    if (bar) {
      var max = (doc.scrollHeight - doc.clientHeight) || 1;
      bar.style.width = Math.min(100, Math.max(0, (y / max) * 100)) + '%';
    }
    if (btn) btn.classList.toggle('visible', y > 600);
  }
  onScroll();
  W.addEventListener('scroll', onScroll, { passive: true });
  W.addEventListener('resize', onScroll, { passive: true });
})();

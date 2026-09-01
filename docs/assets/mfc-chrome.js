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
  // V21.3: also recognise the dashboard's own back-to-top (#mf-fab-top / .mf-fab-top),
  // which previously slipped past this guard → a SECOND injected .mfc-btt stacked on
  // top of it in the bottom-right corner. Detect every known variant so no page ends
  // up with two return-to-top controls.
  var hasTop  = D.querySelector('.back-to-top, #back-to-top, .mfc-btt, .mf-fab-top, #mf-fab-top');
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
      '@media(max-width:768px){.mfc-btt{right:16px;width:40px;height:40px;bottom:var(--mfc-btt-bm,24px);}}',
      /* V33.7 — keep this button off the page's last line. It is fixed to the
         viewport corner, so at the very end of the document there is no scroll
         left to move content out from under it: measured on recover/signup/login
         at 320-375, the 40px circle sat on the footer's centred "Terms" link and
         swallowed the tap. margin (not padding) so it ADDS to whatever the page
         already reserves and can never shrink it. Gated on a CLASS rather than a
         variable for two reasons: `margin-bottom:var(--x,0px)` still emits a
         declaration when the value is 0, which would have flattened the footer
         margins of pages that need no clearance; and `html.mfc-footclear footer`
         (0,1,1) outranks the page-level `.dir-foot` / `.scan-legal` / `.site-foot`
         rules (0,1,0) that swallowed the first attempt on four pages. */
      '@media(max-width:768px){html.mfc-footclear footer{margin-bottom:80px;}}'
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
      // V27.8: 150px left only a 6px gap above a 56px FAB sitting at bottom:88px,
      // and that FAB's pulse ring expands 14px past its edge — so the ring washed
      // over this button. 162px gives a clean 18px gap. Pages with only the
      // sticky CTA bar (no FAB) keep the original clearance.
      root.setProperty('--mfc-btt-bm', fab ? '162px' : (mctaOn ? '150px' : '24px')); // mobile
      /* V33.7 — footer clearance for the injected button, mobile only.
         Only when this button is the ONLY thing in the corner: a page with a
         WhatsApp FAB or a sticky CTA bar already reserves its own bottom space,
         and stacking another 200px of blank on top of that would be worse than
         the overlap. 24px offset + 40px button + 16px gap = 80px. */
      D.documentElement.classList.toggle('mfc-footclear', !fab && !mctaOn);
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

  // — PWA install/offline (V22.4) —
  // The website IS the iOS/Android app now (installed via Add to Home Screen /
  // Install app), so it must register the service worker on every page — not just
  // the dashboard. This shared chrome loads on 17 pages, so registering here makes
  // the whole site installable + offline-capable in one place. register() de-dupes
  // by URL (idempotent), the scope is the whole origin, and it fails silently.
  if ('serviceWorker' in navigator) {
    W.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }
})();

/* — Mobile nav drawer dismissal (V28.0) — deliberately its OWN IIFE.
   The block above returns early on any page that already ships both a
   scroll-progress bar and a back-to-top (dashboard, screener, …), so anything
   appended inside it silently never runs on exactly the busiest pages. This
   was caught by testing Escape on all eight surfaces rather than on one. */
(function () {
  var D = document;
  // — Mobile nav drawer: dismissal (V28.0) —
  // Every page ships its own hamburger IIFE and all of them wire exactly one
  // way to close the drawer: the hamburger itself (plus a click on a link).
  // The drawer is a fixed overlay covering most of the screen, so a visitor who
  // opens it and then wants the page back has to find the same small button
  // again — Escape does nothing and a tap on the page behind does nothing.
  // Added once here rather than in fifteen per-page copies. It drives the same
  // `.open` class and the same aria-expanded the page scripts use, so the two
  // stay in sync whichever one does the closing, and it no-ops on any page that
  // has no drawer.
  function mfcCloseNav() {
    var links = D.querySelector('.nav-links.open');
    if (!links) return false;
    var btn = D.querySelector('.nav-hamburger');
    links.classList.remove('open');
    if (btn) {
      btn.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-label', 'Open menu');
    }
    return true;
  }

  /* — V34.1: SIZE THE DRAWER TO THE SPACE THAT IS ACTUALLY BELOW IT —
     mfc-finish.css bounds the open drawer with `max-height: calc(100dvh -
     var(--mfc-navdrawer-top, 100px))`. 100px was picked in V28.0 as an upper
     bound on the drawer's own top, with a note that CSS cannot read the real
     one. It is not an upper bound: the offer bar is 60px tall, not 44, so the
     drawer starts at 116px on every width where that bar renders on one line
     and at 142px at 568, where its copy wraps. The box therefore ended 16px
     below the fold at 320x568 and 42px below at 568x320 — and a box that
     overflows the viewport cannot be scrolled back into it, so the last item
     ("Get Started") kept 15px of itself off-screen with the drawer already at
     its end.

     Script CAN read it. Measure the drawer's own top in viewport coordinates
     and publish it; the literal in the CSS stays as the fallback, so nothing
     moves if this never runs. Written on :root rather than the element so the
     value survives the class toggle and one read serves both max-height rules.

     Measured with the drawer OPEN — while it is display:none it has no box —
     so the sequence is: let the page's own handler flip .open, then measure on
     the next frame. Re-measured on resize and orientationchange because the
     offer bar's height changes with width, and on scroll because the nav is
     sticky and the drawer rides up with it as the bar leaves. */
  function mfcSizeNavDrawer() {
    try {
      var links = D.querySelector('.nav-links.open');
      if (!links) return;
      var r = links.getBoundingClientRect();
      if (!r.height && !r.width) return;                  // not laid out yet
      var top = Math.max(0, Math.round(r.top));
      D.documentElement.style.setProperty('--mfc-navdrawer-top', top + 'px');
    } catch (_) {}
  }
  // The per-page IIFEs flip `.open` inside their own click handler, so a frame
  // later the drawer is laid out and measurable. rAF twice: once for the class,
  // once for the layout it causes.
  function mfcSizeSoon() {
    if (typeof requestAnimationFrame !== 'function') { mfcSizeNavDrawer(); return; }
    requestAnimationFrame(function () { requestAnimationFrame(mfcSizeNavDrawer); });
  }
  D.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.nav-hamburger')) mfcSizeSoon();
  }, true);
  var _ndT;
  function mfcSizeDebounced() { clearTimeout(_ndT); _ndT = setTimeout(mfcSizeNavDrawer, 60); }
  addEventListener('resize', mfcSizeDebounced);
  addEventListener('orientationchange', mfcSizeDebounced);
  addEventListener('scroll', mfcSizeDebounced, { passive: true });

  // capture phase for both: a page-level keydown handler that calls
  // stopPropagation (the dashboard has one) would otherwise swallow Escape
  // before it ever reached a bubble-phase listener here.
  D.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    // return focus to the control that opened it, so the keyboard user is not
    // dropped back at the top of the document
    if (mfcCloseNav()) {
      var btn = D.querySelector('.nav-hamburger');
      if (btn && typeof btn.focus === 'function') btn.focus();
    }
  }, true);
  D.addEventListener('click', function (e) {
    var links = D.querySelector('.nav-links.open');
    if (!links) return;
    if (links.contains(e.target)) return;                 // inside the drawer
    if (e.target.closest && e.target.closest('.nav-hamburger')) return; // its own toggle
    mfcCloseNav();
  }, true);

  /* — V32.3: the drawer's OPEN half, for pages that never got one —
     The comment above says "every page ships its own hamburger IIFE". Twenty-
     eight of them do not. `/screener/stocks/*.html` are written by
     screener/export_static.py, and that template emits the button, the
     `#primary-nav` drawer and the whole `.nav-links.open{display:flex}` rule in
     mfc-dir.css — but no script binds the click. Measured at 390px: pressing it
     left aria-expanded at "false" and the drawer at display:none/height 0, while
     every other page opened a 446–505px drawer. So on the 28 pages that ARE the
     search-engine landing surface for 2,126 stocks, a phone visitor had no
     navigation at all beyond the logo.
     Binding it here rather than adding a 46th copy of the same IIFE also stops
     the next generated page inheriting the same hole. It cannot double-toggle:
     the per-page scripts flip `aria-expanded` synchronously inside their own
     click handler, so by the time this deferred check runs the attribute has
     already moved and we do nothing. Only a page where NOTHING handled the
     click falls through to the fallback. */
  function mfcOpenNav() {
    var btn = D.querySelector('.nav-hamburger');
    var links = D.querySelector('.nav-links');
    if (!btn || !links) return;
    var open = !links.classList.contains('open');
    links.classList.toggle('open', open);
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (!links.__mfcNavLinks) {                 // close on navigation, once
      links.__mfcNavLinks = 1;
      Array.prototype.forEach.call(links.querySelectorAll('a'), function (a) {
        a.addEventListener('click', function () { mfcCloseNav(); });
      });
    }
  }
  // CAPTURE phase is load-bearing. The per-page IIFEs bind on the BUTTON, so a
  // bubble-phase listener on document reads `before` AFTER they have already
  // flipped aria-expanded — the check then compares "true" with "true", decides
  // nothing handled the click, and toggles the drawer straight back shut. That
  // is exactly what happened on the first cut: the 28 broken pages started
  // working and four working pages started closing on open. Capturing on
  // document runs before any target-phase handler, so `before` is the true pre-click
  // state on every page.
  D.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.nav-hamburger');
    if (!btn) return;
    var before = btn.getAttribute('aria-expanded');
    setTimeout(function () {
      if (btn.getAttribute('aria-expanded') === before) mfcOpenNav();
    }, 0);
  }, true);

  /* — V32.3: a region that scrolls must be reachable from the keyboard —
     WCAG 2.1.1. Two containers on this site scroll horizontally with no
     focusable descendant at all, so there is no way to reach their hidden
     columns without a pointer: `.tbl-scroll` on /fii-dii/ (the cash-market and
     participant tables — 870px of content in a 664px box at 768, 708 in 310 at
     390) and `.disc-scroll` on /disclosures.html (401 in 290 at 320). The
     Scanner's own `.tbl-scroll` is exempt and stays untouched, because every row
     holds a link and Tab already lands inside it.
     Applied here rather than as a static attribute because a tab stop that
     leads nowhere is its own defect: the container only becomes focusable while
     it actually overflows, and loses it again when the viewport is wide enough
     that it does not. Re-evaluated on resize. */
  function mfcScrollRegions() {
    var els = D.querySelectorAll('.tbl-scroll, .disc-scroll, .scn-scroll, [data-scroll-region]');
    Array.prototype.forEach.call(els, function (el) {
      var overflows = el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2;
      var reachable = el.querySelector('a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"])');
      if (overflows && !reachable) {
        if (el.getAttribute('data-mfc-sr') === '1') return;
        el.setAttribute('data-mfc-sr', '1');
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'group');
        if (!el.getAttribute('aria-label')) {
          var t = el.querySelector('caption');
          var label = t && t.textContent.trim();
          if (!label) {                                   // nearest heading above
            var n = el.previousElementSibling, hops = 0;
            while (n && hops++ < 6) {
              if (/^H[1-6]$/.test(n.tagName)) { label = n.textContent.trim(); break; }
              var h = n.querySelector && n.querySelector('h1,h2,h3,h4');
              if (h) { label = h.textContent.trim(); break; }
              n = n.previousElementSibling;
            }
          }
          if (!label) {                                   // else the section it lives in
            var sec = el.closest('section,.card,.panel,.sec,article');
            var sh = sec && sec.querySelector('h1,h2,h3,h4');
            if (sh) label = sh.textContent.trim();
          }
          el.setAttribute('aria-label', (label ? label.slice(0, 60) + ' — ' : '') + 'scrollable table');
        }
      } else if (el.getAttribute('data-mfc-sr') === '1') {
        el.removeAttribute('data-mfc-sr');
        el.removeAttribute('tabindex');
        el.removeAttribute('role');
      }
    });
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', mfcScrollRegions);
  else mfcScrollRegions();
  var _srT;
  addEventListener('resize', function () {
    clearTimeout(_srT); _srT = setTimeout(mfcScrollRegions, 150);
  });
  // the FII/DII and disclosures tables are painted by script after load
  setTimeout(mfcScrollRegions, 900);
  setTimeout(mfcScrollRegions, 2600);
})();

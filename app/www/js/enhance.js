/* ============================================================================
   MindForge Capital — Member App · V13.1 "living light" interactions
   ----------------------------------------------------------------------------
   Touch-spotlight on primary CTAs: a soft white gloss blooms at the finger on
   touch (and tracks the cursor on desktop), matching the website's V13.0 polish.
   One delegated, passive document listener so it survives the app's frequent
   re-renders. White-on-white → imperceptible on the label, only glosses the
   gradient. Pointer Events with a graceful fallback; inert for reduced-motion
   isn't needed (a static fade isn't "motion"), but the CSS removes its transition.
   ========================================================================== */
(function () {
  "use strict";
  var SEL = '.btn-primary';

  function btnOf(e) { return (e.target && e.target.closest) ? e.target.closest(SEL) : null; }
  function place(b, x, y) {
    var r = b.getBoundingClientRect();
    if (!r.width || !r.height) return;
    b.style.setProperty('--bx', (((x - r.left) / r.width) * 100).toFixed(1) + '%');
    b.style.setProperty('--by', (((y - r.top) / r.height) * 100).toFixed(1) + '%');
  }
  function light(b, x, y) { place(b, x, y); b.classList.add('lit'); }
  function dim(b) { if (b) b.classList.remove('lit'); }

  if ('PointerEvent' in window) {
    // press (touch tap / mouse down) → bloom at the contact point
    document.addEventListener('pointerdown', function (e) {
      var b = btnOf(e); if (b) light(b, e.clientX, e.clientY);
    }, { passive: true });
    // follow while pressing (touch drag) or while hovering (desktop)
    document.addEventListener('pointermove', function (e) {
      var b = btnOf(e); if (!b) return;
      if (e.pointerType === 'touch' && !(e.buttons || e.pressure)) return; // touch: only while held
      light(b, e.clientX, e.clientY);
    }, { passive: true });
    document.addEventListener('pointerup', function (e) { dim(btnOf(e)); }, { passive: true });
    document.addEventListener('pointercancel', function (e) { dim(btnOf(e)); }, { passive: true });
    // desktop: fade out when the cursor leaves the button
    document.addEventListener('pointerout', function (e) {
      var b = btnOf(e); if (b && !(e.relatedTarget && b.contains(e.relatedTarget))) dim(b);
    }, { passive: true });
  } else {
    // legacy touch fallback (old Android WebViews)
    document.addEventListener('touchstart', function (e) {
      var b = btnOf(e), t = e.touches && e.touches[0]; if (b && t) light(b, t.clientX, t.clientY);
    }, { passive: true });
    document.addEventListener('touchend', function (e) { dim(btnOf(e)); }, { passive: true });
  }
})();

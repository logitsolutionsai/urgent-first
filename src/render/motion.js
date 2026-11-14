/* board.html motion: disclosure springs, press feedback and the sticky bar material.
 * A classic browser script, inlined after fluid.js (read as text by html.js, never imported).
 * The page reads fully without it: every card and group renders open, and the toggles stay hidden.
 * Height springs (damping 1, response 0.35) reverse from their live height and velocity when clicked
 * again mid-flight; chevrons rotate on their own spring (damping 0.8, response 0.4). Under
 * prefers-reduced-motion every spring jumps straight to its target. */
(function () {
  'use strict';
  document.documentElement.classList.add('js');

  function rotate(svg, deg) { svg.style.transform = 'rotate(' + deg.toFixed(2) + 'deg)'; }

  /** o: { body, open, chev, show(), hide(), set(open) }. body's first child fades and settles 6px. */
  function disclosure(o) {
    var body = o.body, inner = body.firstElementChild || body, open = o.open, full = 0;
    function paint(x) {
      var c = x < 0 ? 0 : x > 1 ? 1 : x;
      body.style.height = (c * full).toFixed(2) + 'px';
      body.style.overflow = 'hidden';
      inner.style.opacity = c.toFixed(3);
      inner.style.transform = 'translateY(' + (-6 * (1 - c)).toFixed(2) + 'px)';
    }
    function rest(x) {
      body.style.height = body.style.overflow = inner.style.opacity = inner.style.transform = '';
      if (x === 0) o.hide();
    }
    var h = Fluid.spring({ value: open ? 1 : 0, response: 0.35, damping: 1, onUpdate: paint, onRest: rest });
    var chev = o.chev && Fluid.spring({ value: open ? 90 : 0, response: 0.4, damping: 0.8, onUpdate: function (d) { rotate(o.chev, d); } });
    if (o.chev) rotate(o.chev, open ? 90 : 0);
    var api = {
      get open() { return open; },
      toggle: function () {
        open = !open;
        if (open) o.show();
        full = body.scrollHeight;
        if (!body.style.height) paint(h.value); // at rest: pin the live height before animating
        h.to(open ? 1 : 0);
        if (chev) chev.to(open ? 90 : 0);
        o.set(open);
      },
      /** Follow a change made outside the toggle (find-in-page opening a details element). */
      jump: function (v) {
        open = v;
        h.set(v ? 1 : 0);
        rest(v ? 1 : 0);
        if (chev) chev.set(v ? 90 : 0);
        o.set(v);
      },
    };
    return api;
  }

  // Cards and the "No rule matched" group: a chevron button controls the body named in aria-controls.
  document.querySelectorAll('button.tog[aria-controls]').forEach(function (btn) {
    var body = document.getElementById(btn.getAttribute('aria-controls'));
    if (!body) return;
    btn.hidden = false;
    var d = disclosure({
      body: body,
      open: btn.getAttribute('aria-expanded') !== 'false',
      chev: btn.querySelector('.chev'),
      show: function () { body.hidden = false; },
      hide: function () { body.hidden = true; },
      set: function (v) { btn.setAttribute('aria-expanded', String(v)); },
    });
    btn.addEventListener('click', d.toggle);
    Fluid.pressable(btn, { scale: 0.88 });
  });

  // Item text and other text fields: native <details>, kept open while the body springs shut.
  document.querySelectorAll('details.disc').forEach(function (det) {
    var sum = det.querySelector(':scope > summary'), body = det.querySelector(':scope > .dbody');
    if (!sum || !body) return;
    var d = disclosure({
      body: body,
      open: det.open,
      chev: sum.querySelector('.chev'),
      show: function () { det.open = true; },
      hide: function () { det.open = false; },
      set: function () {},
    });
    sum.addEventListener('click', function (e) { e.preventDefault(); d.toggle(); });
    det.addEventListener('toggle', function () { if (det.open !== d.open && !body.style.height) d.jump(det.open); });
    Fluid.pressable(sum);
  });

  // Summary chips jump to their sections (native smooth scroll, instant under reduced motion).
  document.querySelectorAll('.summary .chip').forEach(function (chip) { Fluid.pressable(chip); });

  // The sticky bar turns into a translucent material once the board scrolls under it.
  var bar = document.getElementById('bar'), sentinel = document.getElementById('bar-sentinel');
  if (bar) {
    var measure = function () { document.documentElement.style.setProperty('--bar-h', bar.offsetHeight + 'px'); };
    measure();
    addEventListener('resize', measure);
    if (sentinel && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (e) { bar.classList.toggle('stuck', !e[e.length - 1].isIntersecting); }).observe(sentinel);
    }
  }
})();

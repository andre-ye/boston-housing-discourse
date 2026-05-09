// tour/runner — declarative beats; each enter(ctx) returns its own cleanup().

import { store } from '../core/store.js';

const STEP_CHROME_CLASSES = [
  'tour-step-show-nav',
  'tour-step-show-pins',
  'tour-step-show-random',
  'tour-step-show-shift',
  'tour-step-show-time',
  'tour-step-show-cards',
];

// ── Tour pointer arrow (#44 #46) ────────────────────────────────────────
// Each step beat with `pulse: 'tour-pulse-...'` already attaches a glow
// to the click target. The arrow is a separate visual that points AT
// that same target from off-screen so the user actually finds the
// element they need to click — the small "Continue →" / "Back" glyphs
// inside the tour card never pointed at the affordance, just confused
// users (#44).
//
// Bar-seg pulse classes (#stack-l1/l2/l3 .bar-seg[data-key="…"]) follow a
// strict pattern, so we derive the selector from the class name itself —
// no manual table maintenance when a new cluster target is added. Other
// pulses (search, time, pins, spotlight) have specific one-off selectors
// and stay in this small lookup. `null` means "no arrow for this pulse".
const PULSE_TARGETS = {
  'tour-pulse-search':     '#search-input',
  'tour-pulse-time':       '#tl-toggle',
  'tour-pulse-random':     '#random-hint',
  'tour-pulse-shift':      '#shift-hint',
  'tour-pulse-pin-P2':     '.pin[data-id="P2"] .pin-id',
  'tour-pulse-pin-P18':    '.pin[data-id="P18"] .pin-id',
  // Spotlight is a transient — DOM markers aren't reliably present, so
  // we skip the arrow rather than pointing it at empty space.
  'tour-pulse-spotlight':  null,
};

// Resolves a pulse class to a CSS selector. Bar-seg pulses are derived
// from the class name; everything else falls back to the lookup.
function resolvePulseSelector(pulseClass) {
  if (!pulseClass || typeof pulseClass !== 'string') return null;
  const m = pulseClass.match(/^tour-pulse-(l[123])-(.+)$/);
  if (m) {
    const lvl = m[1];     // "l1" | "l2" | "l3"
    const key = m[2];     // e.g. "8", "8_2", "32_1"
    return `#stack-${lvl} .bar-seg[data-key="${key}"]`;
  }
  // Use hasOwnProperty so an explicit `null` (e.g. spotlight) still
  // disables the arrow rather than falling through to a default.
  return Object.prototype.hasOwnProperty.call(PULSE_TARGETS, pulseClass)
    ? PULSE_TARGETS[pulseClass]
    : null;
}

function ensureArrowEl() {
  let el = document.getElementById('tour-arrow');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'tour-arrow';
  el.className = 'tour-arrow hidden';
  el.setAttribute('aria-hidden', 'true');
  // Curved-tail SVG so the arrow has clear directionality at any rotation.
  // The path is drawn pointing right (tail at left, head at right) and
  // we rotate the whole element via CSS transform to aim it at the target.
  el.innerHTML = `
    <svg width="120" height="64" viewBox="0 0 120 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 36 C 28 8, 60 8, 96 32" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" fill="none"/>
      <polygon points="96,32 84,22 88,34 78,42" fill="currentColor"/>
    </svg>`;
  document.body.appendChild(el);
  return el;
}

function positionArrow(arrow, targetEl) {
  if (!arrow || !targetEl) return;
  const r = targetEl.getBoundingClientRect();
  if (!r.width || !r.height) { arrow.classList.add('hidden'); return; }
  const tx = r.left + r.width / 2;
  const ty = r.top + r.height / 2;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Arrow renders at width 120 / height 64 — its "head" is at roughly
  // (96,32) inside that box. We want the head to land just outside the
  // target, biased toward whichever screen edge has the most room.
  const arrowW = 120, arrowH = 64;
  const padOff = 18;       // gap between the arrow head and the target
  // Decide which side to come from based on viewport position. We come
  // from the side opposite the largest empty quadrant so the arrow feels
  // like it's flying from the open space toward the chip.
  const fromLeft  = tx > vw * 0.35;          // target is far enough right that we can come from the left
  const fromAbove = ty > vh * 0.35;          // target sits low enough that we can come from above
  let headX, headY, ax, ay, rotateDeg;
  if (fromLeft && fromAbove) {
    // Diagonal arrow from top-left → target.
    headX = tx - padOff; headY = ty - padOff;
    ax = headX - 96; ay = headY - 32;
    rotateDeg = 0;
  } else if (!fromLeft && fromAbove) {
    // From top-right (mirror horizontally).
    headX = tx + padOff; headY = ty - padOff;
    ax = headX - (arrowW - 96); ay = headY - 32;
    rotateDeg = 0; // we'll mirror via scaleX(-1) in CSS via class
  } else if (fromLeft && !fromAbove) {
    // From bottom-left (mirror vertically).
    headX = tx - padOff; headY = ty + padOff;
    ax = headX - 96; ay = headY - (arrowH - 32);
    rotateDeg = 0;
  } else {
    // From bottom-right.
    headX = tx + padOff; headY = ty + padOff;
    ax = headX - (arrowW - 96); ay = headY - (arrowH - 32);
    rotateDeg = 0;
  }
  arrow.style.left = `${Math.round(ax)}px`;
  arrow.style.top = `${Math.round(ay)}px`;
  arrow.classList.toggle('tour-arrow--mirror-x', !fromLeft);
  arrow.classList.toggle('tour-arrow--mirror-y', !fromAbove);
  arrow.classList.remove('hidden');
}

function clearArrow() {
  const el = document.getElementById('tour-arrow');
  if (el) el.classList.add('hidden');
}

export function createTourRunner({ BEATS, ctx, ui }) {
  let _idx = 0;
  let _active = false;
  let _cleanup = null;
  let _activePulseClass = null;
  // Arrow tracking: an interval-based poll re-finds the target each tick
  // because pulse targets can mount asynchronously (e.g. nav rebuilds the
  // bar segments after a focus change). The poll is cheap (one
  // querySelector + one getBoundingClientRect) and only runs while a beat
  // is active.
  let _arrowPollId = null;
  let _arrowResizeHandler = null;

  function clearStepChromeClasses() {
    STEP_CHROME_CLASSES.forEach(c => document.body.classList.remove(c));
    if (_activePulseClass) {
      document.body.classList.remove(_activePulseClass);
      _activePulseClass = null;
    }
  }

  function applyStepChrome(beat) {
    clearStepChromeClasses();
    const list = Array.isArray(beat.showChrome) ? beat.showChrome : [];
    for (const key of list) {
      switch (key) {
        case 'nav':    document.body.classList.add('tour-step-show-nav'); break;
        case 'pins':   document.body.classList.add('tour-step-show-pins'); break;
        case 'random': document.body.classList.add('tour-step-show-random'); break;
        case 'shift':  document.body.classList.add('tour-step-show-shift'); break;
        case 'time':   document.body.classList.add('tour-step-show-time'); break;
        case 'cards':  document.body.classList.add('tour-step-show-cards'); break;
      }
    }
    if (typeof beat.pulse === 'string' && beat.pulse) {
      document.body.classList.add(beat.pulse);
      _activePulseClass = beat.pulse;
    }
    startArrowFor(beat);
  }

  function startArrowFor(beat) {
    stopArrow();
    if (beat?.arrow === false) return;       // beats can opt out
    const sel = (typeof beat.arrowTarget === 'string' && beat.arrowTarget)
      ? beat.arrowTarget
      : resolvePulseSelector(beat.pulse);
    if (!sel) return;
    const arrow = ensureArrowEl();
    const tick = () => {
      const t = document.querySelector(sel);
      if (t && !document.body.classList.contains('tour-step-done')) {
        positionArrow(arrow, t);
      } else {
        arrow.classList.add('hidden');
      }
    };
    tick();
    // The 200ms poll already catches movement from layout shifts /
    // async-mounted targets. The tour overlay is fixed-position so
    // window 'scroll' wouldn't move it — only resize warrants an
    // immediate re-layout.
    _arrowPollId = setInterval(tick, 200);
    _arrowResizeHandler = () => tick();
    window.addEventListener('resize', _arrowResizeHandler);
  }

  function stopArrow() {
    if (_arrowPollId) { clearInterval(_arrowPollId); _arrowPollId = null; }
    if (_arrowResizeHandler) {
      window.removeEventListener('resize', _arrowResizeHandler);
      _arrowResizeHandler = null;
    }
    clearArrow();
  }

  function teardown() {
    if (_cleanup) {
      try { _cleanup(); } catch (e) { console.error('[tour cleanup]', e); }
      _cleanup = null;
    }
    clearStepChromeClasses();
    stopArrow();
    document.body.classList.remove('tour-step-mode');
    document.body.classList.remove('tour-step-done');
  }

  function applyBodyClasses(beat) {
    // chrome-off when the beat is purely narration (no user action, no chrome
    // whitelist). Step beats opt back into chrome via showChrome[].
    const chromeOff =
      (beat.kind === 'hero' || beat.kind === 'card' || beat.kind === 'outro' || beat.kind === 'opener')
      && !(Array.isArray(beat.showChrome) && beat.showChrome.length > 0)
      && !beat.keepChrome;
    document.body.classList.toggle('tour-chrome-off', chromeOff);
    document.body.classList.toggle('tour-at-hero', beat.kind === 'hero');
    // The 3-page opener wears a distinct body class so its card chrome can
    // breathe (longer max-width, generous leading) without leaking into the
    // tighter mid-tour narration cards.
    document.body.classList.toggle('tour-at-opener', beat.kind === 'opener');

    if (beat.kind === 'step') {
      document.body.classList.add('tour-step-mode');
    } else {
      document.body.classList.remove('tour-step-mode');
    }
  }

  function render() {
    teardown();
    const beat = BEATS[_idx];
    if (!beat) return;

    applyBodyClasses(beat);
    applyStepChrome(beat);

    // Step counter ("Step N of M") indexes against the step beats only —
    // not against hero/opener/outro — so the user sees "Step 1 of 8"
    // when they hit the first interaction beat, not "Step 5 of 13".
    let stepIdx = -1;
    let stepTotal = 0;
    for (let i = 0; i < BEATS.length; i++) {
      if (BEATS[i].kind !== 'step') continue;
      if (i === _idx) stepIdx = stepTotal;
      stepTotal++;
    }

    // Ask the UI layer to draw the appropriate card/hero/outro.
    ui.renderCardForBeat(beat, {
      idx: _idx,
      total: BEATS.length,
      stepIdx,
      stepTotal,
      hasPrev: _idx > 0,
      isLastBeforeOutro: _idx === BEATS.length - 2,
    });

    // advance() is rebound per render so beats can ask the runner to move
    // forward when a user action completes.
    const _renderId = ++renderToken;
    const advance = () => {
      // Ignore stale advance() calls from a beat that's been torn down.
      if (!_active || _renderId !== renderToken) return;
      next();
    };
    const beatCtx = { ...ctx, advance };

    let cleanup;
    try {
      cleanup = beat.enter(beatCtx);
    } catch (e) {
      console.error('[tour] beat.enter threw', beat.id, e);
      cleanup = () => {};
    }
    if (typeof cleanup !== 'function') {
      console.error('[tour] beat.enter must return cleanup() — got', typeof cleanup, 'for beat', beat.id);
      cleanup = () => {};
    }
    _cleanup = cleanup;
  }

  // Token used by render() to detect stale advance() calls from beats whose
  // cleanup hasn't run yet but whose listeners are still wired.
  let renderToken = 0;

  function start() {
    if (_active) return;
    _active = true;
    _idx = 0;
    try { store.set({ tour: { active: true, beat: 0 } }); } catch {}
    ui.onTourStart();
    render();
  }

  function close() {
    if (!_active && !ui.isVisible()) return;
    _active = false;
    teardown();
    document.body.classList.remove('tour-at-hero');
    document.body.classList.remove('tour-at-opener');
    document.body.classList.remove('tour-chrome-off');
    document.body.classList.remove('tour-morphing');
    try { store.set({ tour: { active: false, beat: 0 } }); } catch {}
    ui.onTourClose();
  }

  function next() {
    if (!_active) return;
    if (_idx >= BEATS.length - 1) { close(); return; }
    _idx += 1;
    try { store.set({ tour: { beat: _idx } }); } catch {}
    render();
  }

  function prev() {
    if (!_active || _idx <= 0) return;
    _idx -= 1;
    try { store.set({ tour: { beat: _idx } }); } catch {}
    render();
  }

  return {
    start, close, next, prev,
    isActive: () => _active || ui.isVisible(),
    get index() { return _idx; },
    get active() { return _active; },
  };
}

// tour/runner — declarative beats; each enter(ctx) returns its own cleanup().

import { store } from '../core/store.js';
import { mountTourLayout } from './layout.js';

const STEP_CHROME_CLASSES = [
  'tour-step-show-nav',
  'tour-step-show-pins',
  'tour-step-show-random',
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
  'tour-pulse-pin-P1':     '.pin[data-id="P1"] .pin-id',
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

// Straight-line pointer (Stage 1.3, P8). One <line> from the tour-card
// edge nearest the target to a point just outside the target's bounding
// box, plus one <polygon> arrowhead seated on the line's terminal end.
// The SVG element spans the full viewport so we can express both
// endpoints in screen coordinates without juggling per-quadrant offsets.
// Bumped to read as a confident pointer rather than a thin scribble (#46).
const ARROW_HEAD_LEN = 24;   // head length along the line direction
const ARROW_HEAD_HALF = 14;  // head half-width perpendicular to the line
const ARROW_TARGET_PAD = 10; // gap between head tip and target edge
const ARROW_CARD_PAD = 8;    // gap between line tail and tour card edge

function ensureArrowEl() {
  let el = document.getElementById('tour-arrow');
  if (el) return el;
  el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.id = 'tour-arrow';
  el.setAttribute('class', 'tour-arrow hidden');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('class', 'tour-arrow__line');
  line.setAttribute('stroke', 'currentColor');
  line.setAttribute('stroke-width', '5');
  line.setAttribute('stroke-linecap', 'round');
  const head = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  head.setAttribute('class', 'tour-arrow__head');
  head.setAttribute('fill', 'currentColor');
  el.appendChild(line);
  el.appendChild(head);
  document.body.appendChild(el);
  return el;
}

// Returns the point on rect's perimeter where a ray from (cx,cy)
// inward intersects, so the arrow stops at the visible edge of the
// target rather than sinking into its centre.
function edgePointOnRect(rect, cx, cy, fromX, fromY) {
  const dx = cx - fromX;
  const dy = cy - fromY;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  // Scale the ray (fromX→cx,cy) backward from the centre until it hits
  // either the vertical or horizontal half-extent — whichever is reached
  // first defines the perimeter intersection on that side of the rect.
  const tX = hw / Math.abs(dx || 1e-6);
  const tY = hh / Math.abs(dy || 1e-6);
  const t = Math.min(tX, tY);
  return { x: cx - dx * t, y: cy - dy * t };
}

function positionArrow(arrow, targetEl) {
  if (!arrow || !targetEl) return;
  const r = targetEl.getBoundingClientRect();
  if (!r.width || !r.height) { arrow.classList.add('hidden'); return; }
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Origin: nearest edge of the tour card (so the arrow visibly leaves
  // the card and points at the affordance). Fall back to the viewport
  // centre if the card isn't on screen.
  const cardEl = document.querySelector('.tour-card:not(.hidden)');
  const cardR = cardEl ? cardEl.getBoundingClientRect() : null;
  const tCx = r.left + r.width / 2;
  const tCy = r.top + r.height / 2;
  let originX, originY;
  if (cardR && cardR.width && cardR.height) {
    // Pick the card's edge midpoint nearest the target.
    const cCx = cardR.left + cardR.width / 2;
    const cCy = cardR.top + cardR.height / 2;
    const dx = tCx - cCx;
    const dy = tCy - cCy;
    if (Math.abs(dx) > Math.abs(dy)) {
      originX = dx > 0 ? cardR.right + ARROW_CARD_PAD : cardR.left - ARROW_CARD_PAD;
      originY = cCy;
    } else {
      originX = cCx;
      originY = dy > 0 ? cardR.bottom + ARROW_CARD_PAD : cardR.top - ARROW_CARD_PAD;
    }
  } else {
    originX = vw / 2;
    originY = vh / 2;
  }

  // Tip: just outside the target perimeter, on the ray from origin to
  // the target's centre. This makes the head sit cleanly against the
  // target rather than overlapping it.
  const edge = edgePointOnRect(r, tCx, tCy, originX, originY);
  const ux = edge.x - originX;
  const uy = edge.y - originY;
  const len = Math.hypot(ux, uy) || 1;
  const nx = ux / len;
  const ny = uy / len;
  const tipX = edge.x + nx * ARROW_TARGET_PAD;
  const tipY = edge.y + ny * ARROW_TARGET_PAD;

  // Line ends at the head's BASE so stroke and fill meet without overlap.
  const baseX = tipX - nx * ARROW_HEAD_LEN;
  const baseY = tipY - ny * ARROW_HEAD_LEN;

  // SVG spans the viewport; positions are absolute screen coords.
  arrow.setAttribute('width', vw);
  arrow.setAttribute('height', vh);
  arrow.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
  const line = arrow.querySelector('.tour-arrow__line');
  if (line) {
    line.setAttribute('x1', originX);
    line.setAttribute('y1', originY);
    line.setAttribute('x2', baseX);
    line.setAttribute('y2', baseY);
  }
  // Arrowhead: triangle with base centred at (baseX,baseY), tip at (tipX,tipY).
  // Perpendicular unit vector for the base width.
  const px = -ny;
  const py = nx;
  const head = arrow.querySelector('.tour-arrow__head');
  if (head) {
    const ax = baseX + px * ARROW_HEAD_HALF;
    const ay = baseY + py * ARROW_HEAD_HALF;
    const bx = baseX - px * ARROW_HEAD_HALF;
    const by = baseY - py * ARROW_HEAD_HALF;
    head.setAttribute('points', `${tipX},${tipY} ${ax},${ay} ${bx},${by}`);
  }
  arrow.classList.remove('hidden');
}

function clearArrow() {
  const el = document.getElementById('tour-arrow');
  if (el) el.classList.add('hidden');
}

export function createTourRunner({ BEATS, ctx, ui }) {
  let _idx = 0;
  // Tracks where render() came from so beats can branch on direction
  // (forward / backward / initial). Set just before _idx changes.
  let _prevIdx = -1;
  let _active = false;
  let _cleanup = null;
  let _activePulseClass = null;
  let _layoutMount = null;
  let _currentArrowSelector = null;

  // ── State persistence (Back / Forward-into-completed) ────────────────
  // _completedBeats: ids of step beats whose interactive task the user has
  //   already finished. On forward re-entry we mark the step done at once
  //   (Continue button live, no re-pulse) instead of forcing the user to
  //   redo the action.
  // _snapshots: per-beat exit-state snapshot, captured at the moment the
  //   user clicks Next out of that beat. On Back we restore the previous
  //   beat's snapshot; on Forward into a completed beat we restore that
  //   beat's snapshot. Snapshot shape:
  //     { lat, lon, distance,
  //       focus: { cl, gid, posIdx } | null,
  //       pinnedIdx: number | -1,
  //       spotlight: number[] | null,
  //       dimLayer: number[] | null,
  //       searchValue: string,
  //       monthRange: { lo, hi } | null,
  //       sproutsLaunched: boolean }
  const _completedBeats = new Set();
  const _snapshots = new Map();
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
    // Pointer arrows were removed across the interface — they crossed the
    // canvas, drew the eye away from the prose, and were redundant with
    // the chip pulse. Function kept as a no-op so the call sites in
    // applyStepChrome / render don't need surgery.
    stopArrow();
    _currentArrowSelector = null;
  }

  function stopArrow() {
    if (_arrowPollId) { clearInterval(_arrowPollId); _arrowPollId = null; }
    if (_arrowResizeHandler) {
      window.removeEventListener('resize', _arrowResizeHandler);
      _arrowResizeHandler = null;
    }
    clearArrow();
  }

  // ── Snapshot helpers ─────────────────────────────────────────────────
  // Read THE CURRENT VISIBLE STATE (not in-flight tween targets) into a
  // serializable bag. Camera reads `worldQuat` and `distance` (the live
  // values), not `worldQuatTarget` / `distanceTarget` — that's what the
  // user actually sees.
  function _captureSnapshot(beatId) {
    const App = ctx.App;
    const globe = ctx.globe;
    const nav = ctx.nav;
    const snap = {
      lat: null, lon: null, distance: null,
      focus: null, pinnedIdx: -1,
      spotlight: null, dimLayer: null,
      searchValue: '', monthRange: null,
      sproutsLaunched: false,
    };
    try {
      // Recover lat/lon from worldQuatTarget. rotateTo computes
      //   q = setFromUnitVectors(P_latlon, +Z)
      // where P_latlon is the unit-sphere point at (lat, lon). So
      // P_latlon = q^{-1} * +Z. Apply v' = q^* * v * q (conjugate
      // since q is unit) using the formula
      //   v' = v + 2 * qw * cross(q_inv.xyz, v) + 2 * cross(q_inv.xyz,
      //        cross(q_inv.xyz, v))
      // with q_inv.xyz = -q.xyz.
      const q = globe?.worldQuatTarget;
      if (q) {
        const qx = -q.x, qy = -q.y, qz = -q.z, qw = q.w;
        // v = (0, 0, 1)
        // cross(q.xyz, v) = (qy*1 - qz*0, qz*0 - qx*1, qx*0 - qy*0)
        //                 = (qy, -qx, 0)
        const cx = qy, cy = -qx, cz = 0;
        // cross(q.xyz, cross(q.xyz, v))
        const dx = qy * cz - qz * cy;
        const dy = qz * cx - qx * cz;
        const dz = qx * cy - qy * cx;
        const x = 0 + 2 * qw * cx + 2 * dx;
        const y = 0 + 2 * qw * cy + 2 * dy;
        const z = 1 + 2 * qw * cz + 2 * dz;
        snap.lat = Math.atan2(y, Math.hypot(x, z));
        snap.lon = Math.atan2(z, x);
      }
      snap.distance = globe?.distanceTarget ?? null;
    } catch {}
    try {
      snap.focus = {
        cl: nav?.focusCl ?? null,
        gid: nav?.focusGid ?? null,
        posIdx: nav?.focusPosIdx ?? null,
      };
    } catch {}
    try {
      const f = globe?._filter;
      if (f?.spotlight && f.spotlight.size > 0) snap.spotlight = Array.from(f.spotlight);
      if (f?.dimLayer && f.dimLayer.size > 0) snap.dimLayer = Array.from(f.dimLayer);
      if (f?.monthRange) snap.monthRange = { lo: f.monthRange.lo, hi: f.monthRange.hi };
    } catch {}
    try {
      const input = document.getElementById('search-input');
      if (input) snap.searchValue = input.value || '';
    } catch {}
    try {
      const sel = App?._selection;
      if (sel?.pinnedIdx != null && sel.pinnedIdx >= 0) snap.pinnedIdx = sel.pinnedIdx;
      else if (typeof globe?.pinnedIdx === 'number' && globe.pinnedIdx >= 0) snap.pinnedIdx = globe.pinnedIdx;
    } catch {}
    try {
      const sproutEl = document.getElementById('sprouts')?.querySelector?.('.sprout, .sprout-anchor');
      snap.sproutsLaunched = !!sproutEl;
    } catch {}
    try {
      snap.timelineOpen = document.body.classList.contains('has-timeline-open');
    } catch {}
    _snapshots.set(beatId, snap);
  }

  // Apply snapshot. Camera snaps (no slerp). Search input value is set
  // without firing the input event so the suggestions dropdown doesn't
  // pop open. Beat-specific re-paint (re-spawn sprouts, re-paint topic
  // spotlight after a search query) is the beat's responsibility — see
  // its enter() branch on ctx.isCompleted / ctx.snapshot.
  function _restoreSnapshot(beatId) {
    const snap = _snapshots.get(beatId);
    if (!snap) return false;
    const App = ctx.App;
    const globe = ctx.globe;
    const nav = ctx.nav;
    try {
      if (snap.lat != null && snap.lon != null) {
        if (typeof globe?.snapTo === 'function') globe.snapTo(snap.lat, snap.lon, snap.distance);
        else globe?.rotateTo?.(snap.lat, snap.lon, snap.distance);
      }
    } catch {}
    try {
      if (snap.focus) nav?.focus?.({
        cl: snap.focus.cl,
        gid: snap.focus.gid,
        posIdx: snap.focus.posIdx,
      });
    } catch {}
    try {
      if (snap.spotlight && snap.spotlight.length > 0) {
        globe?.setSpotlight?.(new Set(snap.spotlight));
      }
      if (snap.dimLayer && snap.dimLayer.length > 0) {
        globe?.setDimLayer?.(new Set(snap.dimLayer));
      }
    } catch {}
    try {
      const input = document.getElementById('search-input');
      // Set value WITHOUT firing input — we don't want suggestions to
      // pop. The visible spotlight paint is restored above directly via
      // setSpotlight / setDimLayer, no nav search re-run needed.
      if (input) input.value = snap.searchValue || '';
    } catch {}
    try {
      if (snap.pinnedIdx >= 0) {
        globe?.setPinnedPoint?.(snap.pinnedIdx);
      }
    } catch {}
    try {
      if (snap.timelineOpen && !document.body.classList.contains('has-timeline-open')) {
        // Click the toggle to open the timeline scrubber. Cheaper than
        // duplicating the open/close mounting logic from features/timeline.
        // Done before setMonthRange so the scrubber UI exists when the
        // range lands.
        document.getElementById('tl-toggle')?.click();
      }
    } catch {}
    try {
      if (snap.monthRange) globe?.setMonthRange?.(snap.monthRange);
    } catch {}
    return true;
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
    document.body.classList.remove('tour-cam-snappy');
    try {
      document.querySelectorAll('.pin.selected').forEach((el) => el.classList.remove('selected'));
    } catch {}
    try {
      for (const c of [...document.body.classList]) {
        if (c.startsWith('tour-pulse-')) document.body.classList.remove(c);
      }
    } catch {}
    _activePulseClass = null;
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

    // Pre-apply tour-step-done if the user already completed this beat,
    // so that applyStepChrome's pulse class lands already gated-off (CSS
    // pulses are `body.tour-pulse-…:not(.tour-step-done)`). Without this
    // we'd see a one-frame pulse flash on Forward into a completed beat.
    const isCompletedEarly = _completedBeats.has(beat.id);
    if (isCompletedEarly) document.body.classList.add('tour-step-done');

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
    // Direction tells beats whether they were entered going forward, going
    // backward, or as the initial beat. Opener beats use this to decide
    // whether to reset the camera (backward only) — forward entry preserves
    // the spinning hero camera so the globe doesn't snap back on advance.
    const direction = _prevIdx < 0 ? 'start'
      : _prevIdx < _idx ? 'forward'
      : 'backward';

    // isCompleted is captured pre-applyStepChrome (above) so the pulse
    // doesn't flash; re-bind here for the beat ctx.
    const isCompleted = isCompletedEarly;

    // markStepDone wrapper: records completion before delegating to the
    // ui-layer markStepDone so a future re-entry knows to short-circuit.
    const wrappedMarkStepDone = () => {
      _completedBeats.add(beat.id);
      try { ctx.markStepDone?.(); } catch {}
    };

    const snapshot = _snapshots.get(beat.id) || null;
    const beatCtx = {
      ...ctx,
      advance,
      direction,
      prevIdx: _prevIdx,
      isCompleted,
      snapshot,
      markStepDone: wrappedMarkStepDone,
    };

    let cleanup;
    try {
      cleanup = beat.enter(beatCtx);
    } catch (e) {
      console.error('[tour] beat.enter threw', beat.id, e);
      cleanup = () => {};
    }
    if (typeof cleanup !== 'function') {
      console.error('[tour] beat.enter must return cleanup(); got', typeof cleanup, 'for beat', beat.id);
      cleanup = () => {};
    }
    _cleanup = cleanup;

    // Restore snapshot AFTER beat.enter() so we overwrite any defensive
    // resets the beat performed (clearPinnedPoint, nav.focus({}),
    // rotateTo to a centroid). Only on backward / forward-into-completed
    // navigation — initial / forward-first-visit get the beat's normal
    // first-time framing. Only step beats are snapshotted (see
    // _maybeCaptureExit); other kinds own their own camera lifecycle.
    if (snapshot && beat.kind === 'step' &&
        (direction === 'backward' || (direction === 'forward' && isCompleted))) {
      _restoreSnapshot(beat.id);
    }

    // For a completed beat re-entered going forward, mark the step done
    // so Continue is live without requiring the user to redo the action.
    // (The beat may have already done this in its own enter() — calling
    // again is idempotent for the UI layer.)
    if (isCompleted) wrappedMarkStepDone();

    if (_layoutMount) _layoutMount.schedule();
  }

  // Token used by render() to detect stale advance() calls from beats whose
  // cleanup hasn't run yet but whose listeners are still wired.
  let renderToken = 0;

  function start() {
    if (_active) return;
    _active = true;
    _idx = 0;
    _prevIdx = -1;
    // Fresh tour run: any state from a previous tour is irrelevant.
    _completedBeats.clear();
    _snapshots.clear();
    try { store.set({ tour: { active: true, beat: 0 } }); } catch {}
    ui.onTourStart();
    // Layout engine — shadow mode (per Stage 1.7 design §6 step 1).
    if (!_layoutMount) {
      _layoutMount = mountTourLayout({ runner: runnerApi, ui, shadow: true });
    }
    render();
    if (_layoutMount) _layoutMount.schedule();
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

  function _maybeCaptureExit() {
    // Snapshots are only meaningful for step beats — opener / hero / outro
    // beats own their own spinning / hero-framing camera and re-init it
    // each enter(); a snapshot would either freeze the spin or fight the
    // direction-aware logic those beats already implement.
    const cur = BEATS[_idx];
    if (!cur || cur.kind !== 'step') return;
    try { _captureSnapshot(cur.id); } catch (e) { console.error('[tour snapshot]', e); }
  }

  function next() {
    if (!_active) return;
    if (_idx >= BEATS.length - 1) { close(); return; }
    // Capture the exit-state snapshot of the beat we're leaving BEFORE
    // teardown runs (teardown clears spotlight / search input / etc.).
    // This is what Back will restore us to when the user returns.
    _maybeCaptureExit();
    _prevIdx = _idx;
    _idx += 1;
    try { store.set({ tour: { beat: _idx } }); } catch {}
    render();
  }

  function prev() {
    if (!_active || _idx <= 0) return;
    // Symmetric capture so a user who Back-then-Forwards still lands on
    // the state they had when they hit Back.
    _maybeCaptureExit();
    _prevIdx = _idx;
    _idx -= 1;
    try { store.set({ tour: { beat: _idx } }); } catch {}
    render();
  }

  // Layout engine reads runner._currentBeat() and beat._arrowSelector to
  // route the pointer arrow without duplicating the beat→selector lookup.
  const runnerApi = {
    start, close, next, prev,
    isActive: () => _active || ui.isVisible(),
    get index() { return _idx; },
    get active() { return _active; },
    _currentBeat: () => {
      const b = BEATS[_idx];
      if (b) b._arrowSelector = _currentArrowSelector;
      return b;
    },
  };
  return runnerApi;
}

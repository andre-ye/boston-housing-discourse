// Tour runner — declarative beats with mandatory cleanup.
//
// Each beat exports an `enter(ctx)` returning a cleanup() function. The
// runner calls cleanup() before advancing/retreating to the next beat,
// ensuring every listener / RAF / DOM element / body class is unbound.
// Spotlight markers and per-beat state live inside the beat that needs
// them, never as runner state.
//
// State the runner owns:
//   _idx       — current beat index
//   _cleanup   — cleanup fn returned by the active beat's enter()
//   _active    — whether the tour is currently running
//
// Public API: { start, close, next, prev, isActive(), index() }

const STEP_CHROME_CLASSES = [
  'tour-step-show-nav',
  'tour-step-show-pins',
  'tour-step-show-random',
  'tour-step-show-shift',
  'tour-step-show-time',
  'tour-step-show-cards',
];

export function createTourRunner({ BEATS, ctx, ui }) {
  let _idx = 0;
  let _active = false;
  let _cleanup = null;
  let _activePulseClass = null;

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
  }

  function teardown() {
    if (_cleanup) {
      try { _cleanup(); } catch (e) { console.error('[tour cleanup]', e); }
      _cleanup = null;
    }
    clearStepChromeClasses();
    document.body.classList.remove('tour-step-mode');
    document.body.classList.remove('tour-step-done');
  }

  function applyBodyClasses(beat) {
    // chrome-off when the beat is purely narration (no user action, no chrome
    // whitelist). Step beats opt back into chrome via showChrome[].
    const chromeOff =
      (beat.kind === 'hero' || beat.kind === 'card' || beat.kind === 'outro')
      && !(Array.isArray(beat.showChrome) && beat.showChrome.length > 0)
      && !beat.keepChrome;
    document.body.classList.toggle('tour-chrome-off', chromeOff);
    document.body.classList.toggle('tour-at-hero', beat.kind === 'hero');

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

    // Ask the UI layer to draw the appropriate card/hero/outro.
    ui.renderCardForBeat(beat, {
      idx: _idx,
      total: BEATS.length,
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
    ui.onTourStart();
    render();
  }

  function close() {
    if (!_active && !ui.isVisible()) return;
    _active = false;
    teardown();
    document.body.classList.remove('tour-at-hero');
    document.body.classList.remove('tour-chrome-off');
    document.body.classList.remove('tour-morphing');
    ui.onTourClose();
  }

  function next() {
    if (!_active) return;
    if (_idx >= BEATS.length - 1) { close(); return; }
    _idx += 1;
    render();
  }

  function prev() {
    if (!_active || _idx <= 0) return;
    _idx -= 1;
    render();
  }

  return {
    start, close, next, prev,
    isActive: () => _active || ui.isVisible(),
    get index() { return _idx; },
    get active() { return _active; },
  };
}

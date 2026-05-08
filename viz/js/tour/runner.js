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

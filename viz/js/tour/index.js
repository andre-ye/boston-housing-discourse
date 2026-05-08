// tour — public entry; wires the runner to #tour-overlay + exposes createTour.

import { keys } from '../core/keys.js?v=1';
import { overlayManager } from '../core/overlays.js';
import { dom } from '../core/dom.js';
import { HERO_FRAMING, TOUR_NEXT_FADE_MS } from '../core/constants.js';
import { BEATS } from './beats/index.js';
import { createTourRunner } from './runner.js';
import { escHtml } from './helpers.js';

export function createTour({ globe, App, nav }) {
  const overlay = dom.el('tourOverlay') || document.getElementById('tour-overlay');
  if (!overlay) return { start() {}, close() {}, isActive: () => false };

  // ── overlay registration ─────────────────────────────────────────────
  overlayManager.register({
    name: 'tour',
    rootEl: overlay,
    bodyClasses: ['tour-active'],
    closeOnEsc: false,   // tour has its own Esc cascade for cards/sprouts
    priority: 200,
  });

  // ── DOM references ───────────────────────────────────────────────────
  const heroEl     = overlay.querySelector('.tour-hero');
  const cardEl     = overlay.querySelector('.tour-card');
  const outroEl    = overlay.querySelector('.tour-outro');
  const btnBegin   = overlay.querySelector('#tour-begin');
  const btnNext    = overlay.querySelector('#tour-next');
  const btnPrev    = overlay.querySelector('#tour-prev');
  const btnSkip    = overlay.querySelector('#tour-skip');
  const skipHero   = overlay.querySelector('#tour-skip-hero');
  const btnExplore = overlay.querySelector('#tour-explore');

  function showOnly(which) {
    heroEl?.classList.toggle('hidden', which !== 'hero');
    cardEl?.classList.toggle('hidden', which !== 'card');
    outroEl?.classList.toggle('hidden', which !== 'outro');
  }

  // ── Card UI rendering ────────────────────────────────────────────────
  // Beats describe themselves declaratively (eyebrow, title, prose, pulse,
  // manualContinue, …). The UI layer below paints those into the shared
  // .tour-hero / .tour-card / .tour-outro elements and wires Next/Back/Skip.

  function renderHero(beat) {
    showOnly('hero');
    const h = heroEl?.querySelector('.tour-headline');
    const l = heroEl?.querySelector('.tour-lede');
    if (h) {
      const raw = beat.headline || '';
      h.innerHTML = raw
        ? raw.split('\n').map(line => escHtml(line.trim())).join('<br>')
        : '';
    }
    if (l) l.textContent = beat.lede || '';
  }

  function renderOutro(beat) {
    showOnly('outro');
    const t = outroEl?.querySelector('.tour-title');
    const p = outroEl?.querySelector('.tour-prose');
    if (t) t.textContent = beat.title || '';
    if (p) p.textContent = beat.prose || '';
  }

  function renderCard(beat, meta) {
    showOnly('card');

    const eyebrowEl = cardEl.querySelector('.tour-eyebrow');
    const stepEl    = cardEl.querySelector('.tour-step');
    const titEl     = cardEl.querySelector('.tour-title');
    const proEl     = cardEl.querySelector('.tour-prose');
    const quotesEl  = cardEl.querySelector('.tour-quotes');

    // Opener pages get a richer body (paragraphs, h3s, source links) via
    // beat.bodyHtml. Tighter narration cards still set beat.prose as plain
    // text. The eyebrow doubles as the page indicator (1/3, 2/3, 3/3) on
    // opener beats and is shown via CSS only when .tour-card.tour-card--opener.
    const isOpener = beat.kind === 'opener';
    cardEl.classList.toggle('tour-card--opener', isOpener);

    if (eyebrowEl) eyebrowEl.textContent = beat.eyebrow || '';
    if (stepEl) {
      // Step counter: shows "Step N of M" so the user knows how far along
      // the sequence they are. Skipped on hero / outro (handled by their
      // own renderers) and on the opener pages (which carry their own
      // "1 / 3" count in the eyebrow). The runner gives us `stepIdx` /
      // `stepTotal` indexed against step beats only, so an opener page
      // doesn't bump the count. Beats can override with stepLabel.
      const showCounter = beat.kind === 'step';
      if (beat.stepLabel) {
        stepEl.textContent = beat.stepLabel;
      } else if (showCounter && Number.isInteger(meta?.stepIdx) && meta.stepIdx >= 0
                  && Number.isInteger(meta?.stepTotal) && meta.stepTotal > 0) {
        stepEl.textContent = `Step ${meta.stepIdx + 1} of ${meta.stepTotal}`;
      } else {
        stepEl.textContent = '';
      }
    }
    if (titEl)     titEl.textContent     = beat.title || '';
    if (proEl) {
      if (typeof beat.bodyHtml === 'string' && beat.bodyHtml) {
        proEl.innerHTML = beat.bodyHtml;
      } else {
        proEl.textContent = beat.prose || '';
      }
    }
    if (quotesEl) {
      if (Array.isArray(beat.pullquotes) && beat.pullquotes.length) {
        quotesEl.innerHTML = beat.pullquotes
          .map(q => `<blockquote class="tour-quote">“${escHtml(q)}”</blockquote>`)
          .join('');
      } else if (beat.hint) {
        quotesEl.innerHTML = `<div class="tour-step-hint">${escHtml(beat.hint)}</div>`;
      } else {
        quotesEl.innerHTML = '';
      }
    }

    btnPrev?.classList.toggle('hidden', !meta.hasPrev);
    if (btnNext) {
      btnNext.classList.remove('tour-btn-continue');
      btnNext.classList.remove('tour-btn-disabled');
      btnNext.removeAttribute('aria-disabled');
      btnNext.style.opacity = '';
      btnNext.style.transition = '';
      if (beat.kind === 'step' && beat.manualContinue) {
        // Step beats: Next is gated until the user completes the action.
        // We render it disabled (visually + aria) — the click handler and
        // Enter keybind no-op while disabled. markStepDone() lifts the gate
        // and fades in the promoted "Nicely done — Continue →" copy.
        btnNext.textContent = beat.nextLabel || 'Continue →';
        btnNext.classList.add('tour-btn-disabled');
        btnNext.setAttribute('aria-disabled', 'true');
      } else if (meta.isLastBeforeOutro) {
        btnNext.textContent = beat.nextLabel || 'Finish tour →';
      } else {
        btnNext.textContent = beat.nextLabel || 'Next →';
      }
    }

    cardEl.classList.remove('tour-in');
    void cardEl.offsetWidth;
    cardEl.classList.add('tour-in');

    // Move focus off any tour-card button left over from the previous beat.
    try {
      const ae = document.activeElement;
      if (ae && ae !== document.body && cardEl?.contains(ae)) ae.blur();
    } catch {}
  }

  function renderCardForBeat(beat, meta) {
    if (beat.kind === 'hero') renderHero(beat);
    else if (beat.kind === 'outro') renderOutro(beat);
    else renderCard(beat, meta);  // 'card', 'opener', 'step' all share chrome
  }

  // ── markStepDone: a beat calls this when the user has completed the
  // affordance and we're in manualContinue mode. We paint a "Nicely done"
  // hint, lift the disabled gate on Next, and fade in the promoted
  // "Nicely done — Continue →" copy over TOUR_NEXT_FADE_MS so the user has
  // time to register the affordance change before clicking forward.
  function markStepDone() {
    document.body.classList.add('tour-step-done');
    const quotesEl = cardEl?.querySelector('.tour-quotes');
    if (quotesEl) {
      quotesEl.innerHTML = '<div class="tour-step-hint tour-step-hint-done">Nicely done.</div>';
    }
    if (btnNext) {
      // Fade out → swap copy → fade in. The gap between fades lets the
      // copy change land on the eye instead of the user catching it
      // mid-transition.
      const fade = TOUR_NEXT_FADE_MS;
      btnNext.style.transition = `opacity ${fade}ms ease`;
      btnNext.style.opacity = '0';
      setTimeout(() => {
        btnNext.textContent = 'Nicely done — Continue →';
        btnNext.classList.remove('tour-btn-disabled');
        btnNext.classList.add('tour-btn-continue');
        btnNext.removeAttribute('aria-disabled');
        // Force reflow so the opacity transition replays in the other
        // direction rather than collapsing into a single frame.
        void btnNext.offsetWidth;
        btnNext.style.opacity = '1';
      }, fade);
    }
  }

  // ── ctx the runner passes to each beat's enter() ─────────────────────
  const ctx = {
    App, globe, nav,
    state: () => App?.state,
    keys, dom,
    markStepDone,
  };

  const ui = {
    renderCardForBeat,
    isVisible: () => overlay && !overlay.classList.contains('hidden'),
    onTourStart: () => {
      overlayManager.open('tour');
      // Reset state so we always start clean — covers both first-load and
      // restart-after-close.
      try { App?.clearConnectionsMode?.(); } catch {}
      try { App?.clearSprouts?.({ immediate: true }); } catch {}
      try { App?.clearPinnedPoint?.(); } catch {}
      try { App?.clearPinnedBackStack?.(); } catch {}
      try { globe.setSpotlight?.(null); } catch {}
      document.body.classList.remove('tour-pin-spotlight');
      ['pinned-view', 'interview-card', 'focus-card']
        .forEach(id => document.getElementById(id)?.classList.add('hidden'));
      try {
        const input = document.getElementById('search-input');
        if (input && input.value) {
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.blur();
        }
      } catch {}
      try { document.getElementById('spotlight-chip')?.remove(); } catch {}
      try { App?._timelineResetAndClose?.(); } catch {}
      try { nav.focus({}); } catch {}
      try { globe.rotateTo(15, -25, HERO_FRAMING); } catch {}
    },
    onTourClose: () => {
      overlayManager.close('tour');
      // Leave the user in a clean sandbox.
      try { App?.clearConnectionsMode?.(); } catch {}
      try { App?.clearSprouts?.({ immediate: true }); } catch {}
      try { App?.clearPinnedPoint?.(); } catch {}
      try { App?.clearPinnedBackStack?.(); } catch {}
      try { globe.setSpotlight?.(null); } catch {}
      document.body.classList.remove('tour-pin-spotlight');
      ['pinned-view', 'interview-card', 'focus-card']
        .forEach(id => document.getElementById(id)?.classList.add('hidden'));
      try { document.getElementById('spotlight-chip')?.remove(); } catch {}
      try { App?._timelineResetAndClose?.(); } catch {}
      try { nav.focus({}); } catch {}
      try { globe.rotateTo(15, -25, HERO_FRAMING); } catch {}
    },
  };

  // ── Build runner ─────────────────────────────────────────────────────
  const runner = createTourRunner({ BEATS, ctx, ui });

  // ── Wire chrome buttons ──────────────────────────────────────────────
  // Disabled-aware click — a manualContinue beat that hasn't fired
  // markStepDone() yet leaves Next aria-disabled. Clicking does nothing
  // (the user must complete the task first).
  function isNextDisabled() {
    return btnNext?.getAttribute('aria-disabled') === 'true';
  }
  btnBegin?.addEventListener('click', () => runner.next());
  btnNext?.addEventListener('click', () => {
    if (isNextDisabled()) return;
    runner.next();
  });
  btnPrev?.addEventListener('click', () => runner.prev());
  btnSkip?.addEventListener('click', () => runner.close());
  skipHero?.addEventListener('click', () => runner.close());
  btnExplore?.addEventListener('click', () => runner.close());

  // ── Esc cascade (cards → sprouts → no-op) ───────────────────────────
  const tourActiveOrVisible = () => runner.active || ui.isVisible();
  keys.bind({
    keys: ['Escape'],
    priority: 200,
    label: 'tour:esc-cards',
    allowInInput: true,
    when: tourActiveOrVisible,
    handler: (e) => {
      const cards = ['interview-card', 'pinned-view']
        .map(id => document.getElementById(id))
        .filter(c => c && !c.classList.contains('hidden'));
      if (cards.length === 0) return false;
      cards.forEach(c => c.classList.add('hidden'));
      document.querySelectorAll('.pin.selected').forEach(el => el.classList.remove('selected'));
      // Esc on the pinned-view zeroes out: drop the back-stack so the next
      // pin starts from scratch instead of inheriting prior history.
      try { App?.clearPinnedBackStack?.(); } catch {}
      e.preventDefault();
      return true;
    },
  });
  keys.bind({
    keys: ['Escape'],
    priority: 200,
    label: 'tour:esc-sprouts',
    allowInInput: true,
    when: tourActiveOrVisible,
    handler: (e) => {
      try {
        const spr = document.getElementById('sprouts')
          ?.querySelector?.('.sprout, .sprout-anchor');
        if (spr && typeof App.clearSprouts === 'function') {
          App.clearSprouts({ immediate: true });
          e.preventDefault();
          return true;
        }
      } catch (_) {}
      return false;
    },
  });
  keys.bind({
    keys: ['Escape'],
    priority: 200,
    label: 'tour:esc-noop',
    allowInInput: true,
    when: tourActiveOrVisible,
    handler: (e) => {
      e.preventDefault();
      return true;
    },
  });

  // ── Tour-level navigation keys ──────────────────────────────────────
  keys.bind({
    keys: ['ArrowRight'],
    priority: 200,
    label: 'tour:next',
    allowInInput: true,
    when: () => runner.active,
    handler: (e) => {
      if (isNextDisabled()) { e.preventDefault(); return true; }
      runner.next(); e.preventDefault(); return true;
    },
  });
  keys.bind({
    keys: ['ArrowLeft'],
    priority: 200,
    label: 'tour:prev',
    allowInInput: true,
    when: () => runner.active,
    handler: (e) => { runner.prev(); e.preventDefault(); return true; },
  });
  keys.bind({
    keys: ['Enter'],
    priority: 200,
    label: 'tour:enter-advance',
    when: () => runner.active,
    handler: (e) => {
      const ae = document.activeElement;
      const tag = ae?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
      const obId = ae?.closest?.('#tour-overlay') ? ae?.id : null;
      if (obId === 'tour-begin' || obId === 'tour-next' || obId === 'tour-prev'
          || obId === 'tour-skip-hero' || obId === 'tour-skip' || obId === 'tour-explore') {
        return false;
      }
      if (isNextDisabled()) { e.preventDefault(); return true; }
      runner.next();
      e.preventDefault();
      return true;
    },
  });

  return {
    start: () => runner.start(),
    close: () => runner.close(),
    next: () => runner.next(),
    prev: () => runner.prev(),
    isActive: () => runner.isActive(),
  };
}

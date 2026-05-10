// tour — public entry; wires the runner to #tour-overlay + exposes createTour.

import { keys } from '../core/keys.js';
import { overlayManager } from '../core/overlays.js';
import { dom } from '../core/dom.js';
import { HERO_FRAMING, TOUR_NEXT_FADE_MS } from '../core/constants.js';
import { BEATS } from './beats/index.js?v=20260519';
import { createTourRunner } from './runner.js?v=20260519';
import { escHtml } from './helpers.js';
import { assertBeatAnchors } from './anchors.js';
import { tourTopicTagColor } from '../data.js';

export function createTour({ globe, App, nav }) {
  const overlay = dom.el('tourOverlay') || document.getElementById('tour-overlay');
  if (!overlay) return { start() {}, close() {}, isActive: () => false };

  // Boot-time sanity check: catches stale beat anchors before users hit a
  // broken click target. Logs (does not throw) on drift; tour keeps running.
  try { assertBeatAnchors({ data: App?.state }); } catch (_) {}

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
    // Opener beats set `display:flex` on `.tour-card--opener`; if that class
    // stays while `.hidden` is toggled on, it can out-spec `.tour-card.hidden`
    // and leave the narration card painted over the hero on Back.
    cardEl?.classList.remove('tour-card--opener');
    const h = heroEl?.querySelector('.tour-headline');
    const l = heroEl?.querySelector('.tour-lede');
    const m = heroEl?.querySelector('.tour-meta');
    if (h) {
      const raw = beat.headline || '';
      h.innerHTML = raw
        ? raw.split('\n').map(line => escHtml(line.trim())).join('<br>')
        : '';
    }
    if (l) {
      if (typeof beat.ledeHtml === 'string' && beat.ledeHtml) {
        l.innerHTML = beat.ledeHtml;
      } else {
        l.textContent = beat.lede || '';
      }
    }
    if (m) m.innerHTML = beat.metaHtml || '';
  }

  function renderOutro(beat) {
    showOnly('outro');
    cardEl?.classList.remove('tour-card--opener');
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
      // Step counter: "Step N of M" with optional section context appended,
      // e.g. "Step 2 of 7 · gentrification & rent control · bottom-up tools".
      // Section info comes from beat.section { topic, tool, cl } and is
      // rendered as innerHTML so the topic name can carry its cluster colour.
      const showCounter = beat.kind === 'step';
      const counter = beat.stepLabel
        ? beat.stepLabel
        : (showCounter && Number.isInteger(meta?.stepIdx) && meta.stepIdx >= 0
            && Number.isInteger(meta?.stepTotal) && meta.stepTotal > 0)
          ? `Step ${meta.stepIdx + 1} of ${meta.stepTotal}`
          : '';
      const section = beat.section;
      if (counter || section) {
        const parts = [];
        if (counter) parts.push(escHtml(counter));
        if (section?.topic) {
          const cl = Number.isInteger(section.cl) ? ` data-cl="${section.cl}"` : '';
          parts.push(`<span class="topic-tag"${cl}>${escHtml(section.topic)}</span>`);
        }
        if (section?.tool) parts.push(escHtml(section.tool));
        stepEl.innerHTML = parts.join(' · ');
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
        // and fades in the active "Continue →" copy.
        btnNext.textContent = beat.nextLabel || 'Continue →';
        btnNext.classList.add('tour-btn-disabled');
        btnNext.setAttribute('aria-disabled', 'true');
      } else if (meta.isLastBeforeOutro) {
        btnNext.textContent = beat.nextLabel || 'Finish tour →';
      } else {
        btnNext.textContent = beat.nextLabel || 'Next →';
      }
    }

    // Tint every .topic-tag inside the card with its live cluster colour.
    // Centralised here so beats only need to write the markup; no per-beat
    // enter() loop required.
    cardEl.querySelectorAll('.topic-tag[data-cl]').forEach((el) => {
      const cl = parseInt(el.dataset.cl, 10);
      if (Number.isInteger(cl)) el.style.color = tourTopicTagColor(cl);
    });

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
  // affordance and we're in manualContinue mode. We lift the disabled gate
  // on Next and fade the label in over TOUR_NEXT_FADE_MS so the user has
  // time to register the affordance change before clicking forward.
  function markStepDone() {
    document.body.classList.add('tour-step-done');
    if (btnNext) {
      // Fade out → swap copy → fade in. The gap between fades lets the
      // copy change land on the eye instead of the user catching it
      // mid-transition.
      const fade = TOUR_NEXT_FADE_MS;
      btnNext.style.transition = `opacity ${fade}ms ease`;
      btnNext.style.opacity = '0';
      setTimeout(() => {
        btnNext.textContent = 'Continue →';
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
      try { App?.clearSprouts?.({ immediate: true }); } catch {}
      try { App?.clearPinnedPoint?.(); } catch {}
      try { App?.clearPinnedBackStack?.(); } catch {}
      try { globe.setSpotlight?.(null); } catch {}
      document.body.classList.remove('tour-pin-spotlight');
      ['pinned-view', 'interview-card']
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
      try { App?.clearSprouts?.({ immediate: true }); } catch {}
      try { App?.clearPinnedPoint?.(); } catch {}
      try { App?.clearPinnedBackStack?.(); } catch {}
      try { globe.setSpotlight?.(null); } catch {}
      document.body.classList.remove('tour-pin-spotlight');
      ['pinned-view', 'interview-card']
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
    helpHidden: true,
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
    helpHidden: true,
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
    helpHidden: true,
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
    helpHidden: true,
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
    helpHidden: true,
    allowInInput: true,
    when: () => runner.active,
    handler: (e) => { runner.prev(); e.preventDefault(); return true; },
  });
  keys.bind({
    keys: ['Enter'],
    priority: 200,
    label: 'tour:enter-advance',
    helpHidden: true,
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

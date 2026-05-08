// Part 1 / Step 1 — spotlight three dots, ask the user to click each.
//
// Two same-cluster, one different-cluster — so two should "echo" each other
// and the third should feel like a different conversation. We try the
// geometry-aware picker first; if it can't find a triangle (sparse data,
// odd cluster shapes), we fall back to three globally distributed indices.
// The beat advances on three clicks regardless of which picker was used.
//
// Cleanup: drop spotlight, remove body class, hide detail card, teardown
// markers, unbind pointclick listener. Even if the user backs out of the
// beat halfway through clicking, no leaked listeners or DOM nodes remain.

import { pickThreeDemoPoints, pickThreeFallbackPoints } from '../helpers.js';
import { attachSpotlight } from '../spotlight.js';

export const beat = {
  id: 'click-three-dots',
  kind: 'step',
  eyebrow: 'PART 1 — BOTTOM-UP',
  title: 'Click each glowing dot',
  prose:
    'We picked three dots near each other on the sphere. Two are in the same topical ' +
    'neighborhood — you should hear them echo each other. The third sits right next to ' +
    'them but belongs to a different conversation entirely. Click each one, read the ' +
    'post, then come back.',
  hint: 'Click each glowing marker — 1, 2, 3',
  showChrome: ['cards'],
  pulse: 'tour-pulse-spotlight',
  manualContinue: true,
  enter(ctx) {
    const { globe, App, advance, markStepDone } = ctx;
    const state = App?.state;

    let picks = pickThreeDemoPoints(state);
    if (!picks) picks = pickThreeFallbackPoints(state);

    if (!picks) {
      // Even the fallback failed (data not loaded yet?) — rotate to a
      // generic region and let the user use Next to skip past.
      try { globe.rotateTo(0.2, 1.5, 1.6); } catch {}
      return () => {};
    }

    const idxSet = new Set(picks.map(p => p.idx));
    let spotlightOn = false;
    try { globe.setSpotlight(idxSet); spotlightOn = true; } catch {}
    document.body.classList.add('tour-pin-spotlight');

    // Centroid of the three coordinates.
    const lat = (state.coords[2*picks[0].idx]
               + state.coords[2*picks[1].idx]
               + state.coords[2*picks[2].idx]) / 3;
    const lon = (state.coords[2*picks[0].idx + 1]
               + state.coords[2*picks[1].idx + 1]
               + state.coords[2*picks[2].idx + 1]) / 3;
    try { globe.rotateTo(lat, lon, 1.12); } catch {}

    const markers = attachSpotlight(globe, picks.map((p, i) => ({
      idx: p.idx,
      lat: state.coords[2 * p.idx],
      lon: state.coords[2 * p.idx + 1],
      tag: String(i + 1),
    })));

    const valid = new Set(picks.map(p => p.idx));
    const clicked = new Set();
    let advanced = false;
    const onClick = (ev) => {
      const i = ev?.detail?.idx;
      if (i == null || !valid.has(i)) return;
      clicked.add(i);
      markers.consume?.(i);
      if (clicked.size >= 3 && !advanced) {
        advanced = true;
        markStepDone?.();
        // The runner waits for Next on manualContinue beats; we just paint
        // "✓ Got it" via markStepDone. advance is unused here, but kept on
        // ctx so non-manualContinue step beats can call it directly.
      }
    };
    globe.addEventListener('pointclick', onClick);

    return () => {
      globe.removeEventListener('pointclick', onClick);
      markers.teardown();
      if (spotlightOn) {
        try { globe.setSpotlight(null); } catch {}
      }
      document.body.classList.remove('tour-pin-spotlight');
      document.getElementById('pinned-view')?.classList.add('hidden');
    };
  },
};

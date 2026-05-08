// Part 3 / Step 1 — search inside the bike-lane cluster.
//
// Rotate to cl=5 "Cycling & Bike Lanes" (centroid lat=0.918, lon=0.905), pulse
// the search input, and wait for the user to type "doored". The query lands
// on a tight pocket inside cl=5 sub=0/1: ~92% of its 179 corpus hits sit in
// cycling clusters, so the spotlight reads as a clean, surgical paint.

import { rotateToPointSet } from '../helpers.js';
import { CLOSE_FRAMING, CLUSTER3_CENTROID_LAT, CLUSTER3_CENTROID_LON, CLUSTER3_FRAMING } from '../../core/constants.js';

export const beat = {
  id: 'cluster3-search',
  kind: 'step',
  eyebrow: 'PART 3 — SEARCH & TIME',
  title: 'Search the corpus',
  prose:
    'The bike-lane cluster sits up here in its own region of the sphere. Search ' +
    'paints every post whose body or title contains your query, then rotates the ' +
    'globe to the densest pocket. Try typing the word "doored" into the search ' +
    'bar — almost every match lives inside this cluster. After the tour you can ' +
    'try other queries like "mass ave" or "protected lane" to see how different ' +
    'phrases pick out different shapes of conversation.',
  hint: 'Type "doored" into the search bar in the top left.',
  showChrome: ['nav'],
  pulse: 'tour-pulse-search',
  manualContinue: true,
  enter(ctx) {
    const { App, globe, nav, markStepDone } = ctx;

    try { App?.clearConnectionsMode?.(); } catch {}
    try { App?.clearPinnedPoint?.(); } catch {}
    try { nav.focus({}); } catch {}

    // Rotate to the cl=5 centroid so the user can see the cluster the
    // forthcoming search will paint inside.
    try { globe.rotateTo(CLUSTER3_CENTROID_LAT, CLUSTER3_CENTROID_LON, CLUSTER3_FRAMING); } catch {}

    const focusRaf = requestAnimationFrame(() => {
      try {
        const input = document.getElementById('search-input');
        input?.focus();
      } catch {}
    });

    const input = document.getElementById('search-input');
    let ran = false;
    const onInput = async () => {
      if (!input) return;
      const q = (input.value || '').trim();
      if (ran || !q.toLowerCase().includes('doored')) return;
      ran = true;
      try {
        const set = await App?.findPointsContaining?.(q);
        if (set && set.size > 0) {
          try { globe.setSpotlight(set); } catch {}
          rotateToPointSet(globe, App.state, set, CLOSE_FRAMING);
        }
      } catch {}
      markStepDone?.();
    };
    input?.addEventListener('input', onInput);

    return () => {
      cancelAnimationFrame(focusRaf);
      input?.removeEventListener('input', onInput);
      // Leave the spotlight up so the user can see what they painted as the
      // next beat opens; the time beat does not depend on it being clear.
    };
  },
};

// Part 3 / Step 1 — search inside the bike-lane cluster.
//
// Rotate to cl=5 "Cycling & Bike Lanes" (centroid lat=0.918, lon=0.905), pulse
// the search input, and wait for the user to type "mass ave" AND commit it
// (Enter key on the input, or click on the literal "search for …" row in the
// suggestions dropdown). Typing alone never advances the beat — the commit is
// what tells us the user understood the search affordance. The query returns
// 2,039 corpus matches, with the plurality (336) inside cl=5.

import { rotateToPointSet } from '../helpers.js';
import { CLOSE_FRAMING, CLUSTER3_CENTROID_LAT, CLUSTER3_CENTROID_LON, CLUSTER3_FRAMING } from '../../core/constants.js';

export const beat = {
  id: 'cluster3-search',
  kind: 'step',
  section: { topic: 'cycling & bike lanes', tool: 'search & time', cl: 5 },
  bodyHtml:
    '<p>Search lets you ask the sphere a specific question. <strong>Type ' +
    '“mass ave” in the search box at the top of the left panel ' +
    'and press Enter.</strong> Posts that mention Mass Ave inside this ' +
    'cluster will light up; matches elsewhere on the sphere fade. Once it ' +
    'paints, hover around the bright points and use the bottom-up techniques ' +
    'from earlier where you sample a few to get a feel for what people are ' +
    'discussing.</p>',
  // Include `cards` so globe clicks open the details viewer while sampling
  // search highlights (main.js gates pointclick unless tour-step-show-cards).
  showChrome: ['nav', 'cards'],
  pulse: 'tour-pulse-search',
  manualContinue: true,
  enter(ctx) {
    const { App, globe, nav, markStepDone } = ctx;

    try { App?.clearPinnedPoint?.(); } catch {}
    // Preserve the cl=5 drill the user committed in beat 12 (#cluster3-pick-
    // cluster). Calling nav.focus({}) here would unselect the bike-lane
    // cluster on entry, undoing the previous beat's payoff.
    try { nav.focus({ cl: 5 }); } catch {}

    // Rotate to the cl=5 centroid so the user can see the cluster the
    // forthcoming search will paint inside.
    try { globe.rotateTo(CLUSTER3_CENTROID_LAT, CLUSTER3_CENTROID_LON, CLUSTER3_FRAMING); } catch {}

    const focusRaf = requestAnimationFrame(() => {
      try {
        const input = document.getElementById('search-input');
        if (!input) return;
        // Don't steal focus mid-keystroke if the user is already typing in
        // (or has clicked into) some other input — only auto-focus when the
        // currently-focused element is the document body or null.
        const ae = document.activeElement;
        const aeTag = ae?.tagName;
        const aeEditable =
          aeTag === 'INPUT' || aeTag === 'TEXTAREA' || aeTag === 'SELECT' ||
          ae?.isContentEditable === true;
        if (aeEditable && ae !== input) return;
        input.focus();
      } catch {}
    });

    const input = document.getElementById('search-input');
    const suggestions = document.getElementById('search-suggestions');
    let ran = false;

    // Two-tier paint: bright spotlight for matches inside cl=5 (the "lit
    // posts" the prose names), soft DIM layer for the out-of-cluster matches
    // so the corpus-wide spread stays visible. Only fires after the user
    // commits the query (Enter or literal-row click) — typing alone is not
    // enough to advance the beat or paint the globe.
    const commitAndPaint = async () => {
      if (ran) return;
      const q = (input?.value || '').trim();
      if (!q.toLowerCase().includes('mass ave')) return;
      ran = true;
      try {
        const set = await App?.findPointsContaining?.(q);
        if (set && set.size > 0) {
          const cluster = App?.state?.cluster;
          const inCluster = new Set();
          const outOfCluster = new Set();
          if (cluster) {
            for (const i of set) {
              if (cluster[i] === 5) inCluster.add(i);
              else outOfCluster.add(i);
            }
          }
          try { globe.setSpotlight(inCluster.size > 0 ? inCluster : set); } catch {}
          try { globe.setDimLayer?.(outOfCluster.size > 0 ? outOfCluster : null); } catch {}
          rotateToPointSet(globe, App.state, inCluster.size > 0 ? inCluster : set, CLOSE_FRAMING);
        }
      } catch {}
      markStepDone?.();
    };

    // Enter on the search input commits the query. We pre-empt nav.js's own
    // Enter handler in spirit by listening on keydown (capture: false) — both
    // handlers run, but ours only fires our commit-paint branch. nav.js will
    // also run _runSpotlightSearch which paints its own globe spotlight; our
    // two-tier paint then overwrites it (setSpotlight is idempotent).
    const onKeydown = (e) => {
      if (e.key !== 'Enter') return;
      // Defer to next tick so nav.js's Enter handler (which may pick a
      // suggestion other than literal — e.g. a sub/cluster hit) runs first.
      // Only commit-paint when the typed query actually contains "mass ave".
      setTimeout(() => { commitAndPaint(); }, 0);
    };
    input?.addEventListener('keydown', onKeydown);

    // Click on the literal "Search for …" row in the suggestions dropdown.
    // We listen on the suggestions container (event delegation) so the
    // listener survives even when the dropdown re-renders mid-typing.
    const onSuggClick = (e) => {
      const literalRow = e.target.closest?.('.sugg-item-literal');
      if (!literalRow) return;
      setTimeout(() => { commitAndPaint(); }, 0);
    };
    suggestions?.addEventListener('click', onSuggClick);

    return () => {
      cancelAnimationFrame(focusRaf);
      input?.removeEventListener('keydown', onKeydown);
      suggestions?.removeEventListener('click', onSuggClick);
      // Tear down the search-paint state so Back into earlier beats doesn't
      // see a polluted globe / search input. Drop the spotlight, clear the
      // input AND fire its `input` event so search-find clears its paint
      // (mere `value=""` doesn't trip the listener), and remove the
      // `q=` URL hash param if one was set.
      try { globe.setSpotlight(null); } catch {}
      try { globe.setDimLayer?.(null); } catch {}
      try { App?.clearPinnedBackStack?.(); } catch {}
      if (input) {
        try {
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.blur();
        } catch {}
      }
      try {
        if (location.hash) {
          // Strip a `q=…` segment from the hash (and a leading `&` or `?`),
          // leaving the rest of the hash intact. If the resulting hash is
          // empty, drop it entirely.
          const next = location.hash
            .replace(/([#&?])q=[^&]*/g, '$1')
            .replace(/[#&?]$/, '')
            .replace(/[#&?]&/g, '$1');
          if (next !== location.hash) {
            history.replaceState(null, '', location.pathname + location.search + next);
          }
        }
      } catch {}
    };
  },
};

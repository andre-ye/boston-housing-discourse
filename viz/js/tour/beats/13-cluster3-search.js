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
    'The bike-lane cluster sits in its own region of the sphere. Search paints ' +
    'every post whose body or title contains your query, then rotates the globe ' +
    'to the densest pocket. Try typing the word "doored" into the search bar — ' +
    'almost every match lives inside this cluster. The small "P" markers floating ' +
    'around the sphere are interview pins, anchored near the topics each ' +
    'interviewee actually talks about. After the tour you can try other queries ' +
    'like "mass ave" or "protected lane" to see how different phrases pick out ' +
    'different shapes of conversation.',
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
      // Tear down the search-paint state so Back into earlier beats doesn't
      // see a polluted globe / search input. Drop the spotlight, clear the
      // input AND fire its `input` event so search-find clears its paint
      // (mere `value=""` doesn't trip the listener), and remove the
      // `q=` URL hash param if one was set.
      try { globe.setSpotlight(null); } catch {}
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

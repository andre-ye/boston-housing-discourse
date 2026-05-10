// Part 3 / Step 2 — open the timeline scrubber AND drag the window.
//
// Drop the Mass Ave search from the prior beat (we don't want the timeline
// to filter inside that match set), re-focus cl=5 so the left rail and
// camera both anchor on the bike-lane cluster, then pulse the ⏱ button and
// listen for the user to open the timeline followed by a real range change
// (drag) before advancing.

import { CLUSTER3_CENTROID_LAT, CLUSTER3_CENTROID_LON, CLUSTER3_FRAMING } from '../../core/constants.js';

export const beat = {
  id: 'cluster3-time',
  kind: 'step',
  section: { topic: 'cycling & bike lanes', tool: 'search & time', cl: 5 },
  bodyHtml:
    '<p>Time filtering lets you watch a topic move across years. ' +
    '<strong>Click the ⏱ button at the bottom, then drag the window across ' +
    'the timeline.</strong> Watch how bike-lane discourse changes over the ' +
    'decade. What people are arguing about in 2016 versus 2024 may surprise ' +
    'you. Slide narrow windows across the years and see which posts brighten ' +
    'and which fade away.</p>',
  showChrome: ['time'],
  pulse: 'tour-pulse-time',
  manualContinue: true,
  enter(ctx) {
    const { App, globe, nav, markStepDone } = ctx;

    // Drop the search spotlight, dim layer, and search-input value left
    // behind by beat 13 — the timeline should filter the WHOLE bike-lane
    // cluster, not just Mass Ave matches. Mirror beat 13's cleanup so we
    // don't have a residual q= in the URL hash either.
    try { globe.setSpotlight?.(null); } catch {}
    try { globe.setDimLayer?.(null); } catch {}
    const si = document.getElementById('search-input');
    if (si) {
      try {
        si.value = '';
        si.dispatchEvent(new Event('input', { bubbles: true }));
        si.blur();
      } catch {}
    }
    try {
      if (location.hash) {
        const next = location.hash
          .replace(/([#&?])q=[^&]*/g, '$1')
          .replace(/[#&?]$/, '')
          .replace(/[#&?]&/g, '$1');
        if (next !== location.hash) {
          history.replaceState(null, '', location.pathname + location.search + next);
        }
      }
    } catch {}

    // Re-anchor on cl=5: left rail narrows back to the bike-lane cluster,
    // and the globe re-renders with cl=5 as the focused topic.
    try { nav?.focus?.({ cl: 5 }); } catch {}
    try { globe?.rotateTo?.(CLUSTER3_CENTROID_LAT, CLUSTER3_CENTROID_LON, CLUSTER3_FRAMING); } catch {}

    const tlBtn = document.getElementById('tl-toggle');
    if (!tlBtn || !globe || typeof globe.setMonthRange !== 'function') {
      // Nothing to wire — let the user advance manually via Next.
      return () => {};
    }
    let advanced = false;
    let opened = false;

    // Wrap globe.setMonthRange so we hear every range change the timeline
    // emits (drag, body-drag, edge resize, hash apply). Restore on cleanup.
    const origSetMonthRange = globe.setMonthRange.bind(globe);
    globe.setMonthRange = (range) => {
      const ret = origSetMonthRange(range);
      // A non-null range means the user (or restore) set a real window —
      // for a freshly-opened timeline that only happens on drag.
      if (opened && !advanced && range && typeof range === 'object') {
        advanced = true;
        markStepDone?.();
      }
      return ret;
    };

    const onClick = () => {
      // The same button toggles open AND closed. Body class flips
      // synchronously inside the toggle handler, so reading it after the
      // click is safe. Only treat the open-transition as "opened".
      if (document.body.classList.contains('has-timeline-open')) {
        opened = true;
      }
    };
    tlBtn.addEventListener('click', onClick);

    return () => {
      tlBtn.removeEventListener('click', onClick);
      // Restore the original setMonthRange — only if nothing else has
      // wrapped it in the meantime (defensive).
      if (globe.setMonthRange !== origSetMonthRange) {
        try { globe.setMonthRange = origSetMonthRange; } catch {}
      }
    };
  },
};

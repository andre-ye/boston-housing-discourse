// Part 1 / Step 2 — clicking a point to pull up its full content.
//
// Carries the same TRIO from beat 5 (kept spotlit) and asks the user to
// click any one of them. A click pins that point — its full post body and
// thread reply chain land in the left-panel details viewer.

import { attachSpotlight } from '../spotlight.js';
import { setVisibilityTiers, clearVisibilityTiers } from '../../features/visibility-tiers.js';

const TRIO_FRAMING = 1.85;

const TRIO = [
  { idx: 418401, role: 'A', tag: '1' },
  { idx: 418561, role: 'B', tag: '2' },
  { idx: 300597, role: 'C', tag: '3' },
];

export const beat = {
  id: 'cluster1-click-pin',
  kind: 'step',
  section: { topic: 'gentrification & rent control', tool: 'bottom-up tools', cl: 32 },
  bodyHtml:
    '<p>Hovering shows you a peek. <strong>Clicking</strong> a point pulls ' +
    'its full post and the conversation around it into the panel on your ' +
    'left. <strong>To proceed, click any one of the three glowing dots</strong> ' +
    'and read the full context of the conversation that the post or comment ' +
    'was made in.</p>',
  showChrome: ['cards'],
  pulse: 'tour-pulse-spotlight',
  manualContinue: true,
  enter(ctx) {
    const { globe, App, markStepDone } = ctx;
    const state = App?.state;
    if (!state?.coords) return () => {};

    const picks = TRIO.filter(p =>
      Number.isFinite(state.coords[2 * p.idx]) &&
      Number.isFinite(state.coords[2 * p.idx + 1])
    );
    if (picks.length < 3) return () => {};

    const idxSet = new Set(picks.map(p => p.idx));
    let spotlightOn = false;
    try { globe.setSpotlight(idxSet); spotlightOn = true; } catch {}
    try { setVisibilityTiers({ level: 'tourSpotlight', scope: { brightIds: idxSet } }); } catch {}
    document.body.classList.add('tour-pin-spotlight');
    document.body.classList.add('tour-cam-snappy');

    let lat = 0, lon = 0;
    for (const p of picks) {
      lat += state.coords[2 * p.idx];
      lon += state.coords[2 * p.idx + 1];
    }
    lat /= picks.length; lon /= picks.length;
    try { globe.rotateTo(lat, lon, TRIO_FRAMING); } catch {}

    const markers = attachSpotlight(globe, picks.map(p => ({
      idx: p.idx,
      lat: state.coords[2 * p.idx],
      lon: state.coords[2 * p.idx + 1],
      tag: p.tag,
    })));

    const valid = new Set(picks.map(p => p.idx));
    let advanced = false;
    const onClick = (ev) => {
      const i = ev?.detail?.idx;
      if (i == null || !valid.has(i)) return;
      markers.consume?.(i);
      if (!advanced) {
        advanced = true;
        markStepDone?.();
      }
    };
    globe.addEventListener('pointclick', onClick);

    return () => {
      globe.removeEventListener('pointclick', onClick);
      markers.teardown();
      if (spotlightOn) {
        try { globe.setSpotlight(null); } catch {}
      }
      try { clearVisibilityTiers(); } catch {}
      document.body.classList.remove('tour-pin-spotlight');
      document.body.classList.remove('tour-cam-snappy');
    };
  },
};

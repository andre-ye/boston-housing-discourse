// Part 1 / Step 1 — locality demo on the gentrification / rent-control cluster.
//
// Hand-picked indices from `tutorial-content.md` § "Cluster 1 — Bottom-up
// features". Two points sit ~0.33° apart inside cl=32 sub=4 (Rent
// Stabilization Ideas) and say nearly the same thing — building, not capping.
// The third lives in cl=32 sub=2 (Displacement & Luxury), ~16° away — same
// cluster, different framing. The user clicks each one, reads it in the
// pinned-view, and the locality property pops out without us having to
// assert it.
//
// We use clicks (not hover) because click is what's reliably detectable on
// the globe today (`pointclick` event); hover triggers a transient halo but
// no committed state. The narration prompts the user toward "compare" not
// "hover", so the swap reads naturally.
//
// Cleanup: drop spotlight, remove body class, hide pinned-view, unbind
// pointclick, clear the snappy-camera flag.

import { attachSpotlight } from '../spotlight.js';
import { CLOSE_FRAMING } from '../../core/constants.js';

// Curated trio (from tutorial-content.md). A and B are visually adjacent;
// C is the same-cluster outlier.
const TRIO = [
  { idx: 418401, role: 'A', tag: '1' },   // sub=4, "rent control doesn't solve the problem"
  { idx: 418561, role: 'B', tag: '2' },   // sub=4, "rent control isnt going to save it"
  { idx: 300597, role: 'C', tag: '3' },   // sub=2, "expensive housing both gentrifies…"
];

export const beat = {
  id: 'cluster1-hover-trio',
  kind: 'step',
  eyebrow: 'PART 1 — BOTTOM-UP',
  title: 'Read three nearby voices',
  prose:
    'All three glowing dots sit inside the same cluster, which is the one that argues ' +
    'about rent and gentrification. Click the first two and you will see that they almost ' +
    'touch on the sphere, and that they say nearly the same thing: the answer is to build ' +
    'more, not to cap rents. Now click the third one, which sits a little further out. It ' +
    'is in the same cluster, but the framing flips from supply to displacement. On this ' +
    'sphere, the distance between two points reflects how similar they are in meaning.',
  hint: 'Click each glowing marker (1, 2, 3)',
  showChrome: ['cards'],
  pulse: 'tour-pulse-spotlight',
  manualContinue: true,
  enter(ctx) {
    const { globe, App, markStepDone } = ctx;
    const state = App?.state;
    if (!state?.coords) {
      try { globe.rotateTo(0.467, -2.375, CLOSE_FRAMING); } catch {}
      return () => {};
    }

    const picks = TRIO.filter(p =>
      Number.isFinite(state.coords[2 * p.idx]) &&
      Number.isFinite(state.coords[2 * p.idx + 1])
    );
    if (picks.length < 3) {
      try { globe.rotateTo(0.467, -2.375, CLOSE_FRAMING); } catch {}
      return () => {};
    }

    const idxSet = new Set(picks.map(p => p.idx));
    let spotlightOn = false;
    try { globe.setSpotlight(idxSet); spotlightOn = true; } catch {}
    document.body.classList.add('tour-pin-spotlight');
    // Snappy camera tween — same rationale as 05-click-three-dots used:
    // long-distance jump from the opener framing into a tight crop reads
    // as molasses at the default tour rate.
    document.body.classList.add('tour-cam-snappy');

    // Aim the camera at the centroid of the three picks. A and B are tight
    // together, C is the outlier — the centroid still keeps all three on
    // screen at CLOSE_FRAMING.
    let lat = 0, lon = 0;
    for (const p of picks) {
      lat += state.coords[2 * p.idx];
      lon += state.coords[2 * p.idx + 1];
    }
    lat /= picks.length;
    lon /= picks.length;
    try { globe.rotateTo(lat, lon, CLOSE_FRAMING); } catch {}

    const markers = attachSpotlight(globe, picks.map(p => ({
      idx: p.idx,
      lat: state.coords[2 * p.idx],
      lon: state.coords[2 * p.idx + 1],
      tag: p.tag,
    })));

    const valid = new Set(picks.map(p => p.idx));
    const clicked = new Set();
    let advanced = false;
    const onClick = (ev) => {
      const i = ev?.detail?.idx;
      if (i == null || !valid.has(i)) return;
      clicked.add(i);
      markers.consume?.(i);
      if (clicked.size >= picks.length && !advanced) {
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
      document.body.classList.remove('tour-pin-spotlight');
      document.body.classList.remove('tour-cam-snappy');
      // Clear the full pinned chain — the trio click pins points into the
      // pinned-view, so cleanup must drop the pin, hide the surface, AND
      // empty the back-stack so the next beat doesn't see stale prior pins.
      try { App?.clearPinnedPoint?.(); } catch {}
      try { App?.hidePinnedView?.(); } catch {}
      try { App?.clearPinnedBackStack?.(); } catch {}
      document.getElementById('pinned-view')?.classList.add('hidden');
    };
  },
};

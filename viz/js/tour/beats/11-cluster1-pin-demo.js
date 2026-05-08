// Cluster 1 / Click-a-point demo — pin a curated post from the rent-control
// cluster.
//
// Curated index (idx=342514) is a high-score (702) comment on a thread
// literally titled "Protest for Rent Control" in r/boston. Picked in
// tutorial-content.md because: (a) score → there's a real thread under it
// the user can ⌘-click into; (b) body is four substantial sentences — fills
// the pinned-comment surface without scrolling; (c) it sits in the same
// subcluster as the hover trio (cl=32 sub=4), so the user is exploring the
// same neighborhood they just learned about.
//
// Cleanup: drop spotlight, hide the pinned-view, unbind pointclick.

import { attachSpotlight } from '../spotlight.js';
import { CLOSE_FRAMING } from '../../core/constants.js';

const PIN_DEMO_IDX = 342514;

export const beat = {
  id: 'cluster1-pin-demo',
  kind: 'step',
  eyebrow: 'PART 1 — BOTTOM-UP',
  title: 'Click a point to pin it',
  prose:
    'You can click any point on the sphere to pin it, and the full thread context will ' +
    'show up in the side panel. We have spotlit one for you, which is a comment on a ' +
    'r/boston thread titled “Protest for Rent Control.” Click it to read what was said. ' +
    'Once it opens, the “Thread context” section under the post lists the surrounding ' +
    'replies — a quick way to see how this point relates to the conversation around it.',
  hint: 'Click the glowing dot on the right.',
  showChrome: ['nav', 'cards'],
  pulse: 'tour-pulse-spotlight',
  manualContinue: true,
  enter(ctx) {
    const { globe, App, markStepDone } = ctx;
    const state = App?.state;

    try { App?.clearPinnedPoint?.(); } catch {}
    ['focus-card', 'interview-card', 'pinned-view']
      .forEach(id => document.getElementById(id)?.classList.add('hidden'));

    if (!state?.coords ||
        !Number.isFinite(state.coords[2 * PIN_DEMO_IDX]) ||
        !Number.isFinite(state.coords[2 * PIN_DEMO_IDX + 1])) {
      // Data not loaded yet — leave the user a generic framing they can
      // skip past with Next.
      try { globe.rotateTo(0.467, -2.375, CLOSE_FRAMING); } catch {}
      return () => {};
    }

    const lat = state.coords[2 * PIN_DEMO_IDX];
    const lon = state.coords[2 * PIN_DEMO_IDX + 1];
    const idxSet = new Set([PIN_DEMO_IDX]);

    let spotlightOn = false;
    try { globe.setSpotlight(idxSet); spotlightOn = true; } catch {}
    document.body.classList.add('tour-pin-spotlight');
    document.body.classList.add('tour-cam-snappy');

    try { globe.rotateTo(lat, lon, CLOSE_FRAMING); } catch {}

    const markers = attachSpotlight(globe, [{
      idx: PIN_DEMO_IDX, lat, lon, tag: '',
    }]);

    let advanced = false;
    const onClick = (ev) => {
      if (advanced) return;
      const i = ev?.detail?.idx;
      if (i !== PIN_DEMO_IDX) return;
      advanced = true;
      markers.consume?.(i);
      markStepDone?.();
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
      // Drop the pin, hide the panel, AND empty the back-stack so the next
      // beat opens with a fresh pinned-view rather than inheriting this pin.
      try { App?.clearPinnedPoint?.(); } catch {}
      try { App?.hidePinnedView?.(); } catch {}
      try { App?.clearPinnedBackStack?.(); } catch {}
      document.getElementById('pinned-view')?.classList.add('hidden');
    };
  },
};

// Part 2 / Step 1 — pick the Tenant Rights & Landlords topic.
//
// Top-down family opener. After the bottom-up cluster-1 segment, the camera
// pulls back to the wide hero framing so the user sees the whole left rail
// and globe. We pulse the cl=8 chip and wait for the user to click into it.
//
// cl=8 "Tenant Rights & Landlords" centroid (lat=-0.049, lon=2.370) sits on
// the opposite side of the sphere from cl=32, so a wide reframe is the
// honest motion: no faked transition.

import { HERO_FRAMING } from '../../core/constants.js';

export const beat = {
  id: 'cluster2-pick-topic',
  kind: 'step',
  eyebrow: 'PART 2 — TOP-DOWN',
  title: 'Pick a topic from the left rail',
  prose:
    'You can also start from a topic and narrow down. The left rail lists every cluster, ' +
    'sorted by how much of the corpus it covers. Topic 8, “Tenant Rights & Landlords,” ' +
    'is where people are not arguing about housing in the abstract. They are stuck in ' +
    'an apartment with a problem and asking what to do. Click it to drill in.',
  hint: 'Click “Tenant Rights & Landlords” on the left.',
  showChrome: ['nav'],
  pulse: 'tour-pulse-l1-8',
  manualContinue: true,
  enter(ctx) {
    const { globe, nav, App, markStepDone } = ctx;

    // Reset state so the click handler sees a clean baseline.
    try { App?.clearConnectionsMode?.(); } catch {}
    try { App?.clearPinnedPoint?.(); } catch {}
    try { globe.setPinnedPoint(-1); } catch {}
    try { nav.focus({}); } catch {}

    // Wide framing so the whole nav and globe are visible.
    try { globe.rotateTo(0, 0, HERO_FRAMING); } catch {}

    let advanced = false;
    const onFocus = (ev) => {
      if (advanced) return;
      if (ev?.detail?.cl === 8 && ev?.detail?.gid == null) {
        advanced = true;
        markStepDone?.();
      }
    };
    nav.addEventListener('focus', onFocus);

    return () => {
      nav.removeEventListener('focus', onFocus);
    };
  },
};

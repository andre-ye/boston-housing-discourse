// Hero beat — split-screen intro. Live globe spins behind transparent right
// pane while the headline + lede fade in on the left.
//
// Cleanup unbinds the rAF spin disposer registered with the central scheduler.

import { raf } from '../../core/raf.js';

export const beat = {
  id: 'hero',
  kind: 'hero',
  headline: 'The Boston Social Sphere\nDiscourse of Reddit',
  lede:
    'Over 400,000 Reddit posts and comments about housing, transit, and city life ' +
    'in Boston from 2015–2025, grouped by topics and points of view',
  enter(ctx) {
    const { globe } = ctx;
    try { globe.rotateTo(15, -25, 3.0); } catch {}
    const dispose = raf.add('tour:hero-spin', () => {
      try { globe.nudge?.(0.22, -0.06); } catch {}
    });
    return () => {
      try { dispose(); } catch {}
    };
  },
};

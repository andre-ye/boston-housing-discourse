// 01-hero — split-screen intro; live globe spins behind transparent right pane.

import { raf } from '../../core/raf.js';
import { HERO_FRAMING, HERO_NUDGE_LON, HERO_NUDGE_LAT } from '../../core/constants.js';

export const beat = {
  id: 'hero',
  kind: 'hero',
  headline: 'The Boston Social Sphere\nDiscourse of Reddit',
  lede:
    'This visualization holds over 400,000 Reddit posts and comments about housing, ' +
    'transit, and city life in Boston from 2015 to 2025, grouped by what they discuss ' +
    'and what point of view they take.',
  enter(ctx) {
    const { globe } = ctx;
    try { globe.rotateTo(15, -25, HERO_FRAMING); } catch {}
    const dispose = raf.add('tour:hero-spin', () => {
      try { globe.nudge?.(HERO_NUDGE_LON, HERO_NUDGE_LAT); } catch {}
    });
    return () => {
      try { dispose(); } catch {}
    };
  },
};

// 15-outro — final card; "Explore" button closes the tour.

import { HERO_FRAMING } from '../../core/constants.js';

export const beat = {
  id: 'outro',
  kind: 'outro',
  title: 'Go forth and explore',
  prose:
    'That is the whole interface. Rotate the globe, search for a street you know, ' +
    'drag the time window, and click anything that catches your eye — the rest is ' +
    'just looking. Press ? at any time to see the full shortcut list.',
  enter(ctx) {
    const { globe } = ctx;
    try { globe.rotateTo(15, -25, HERO_FRAMING); } catch {}
    return () => {};
  },
};

// 15-outro — final card; "Explore" button closes the tour.

import { HERO_FRAMING } from '../../core/constants.js';

export const beat = {
  id: 'outro',
  kind: 'outro',
  title: 'That\'s the tour, now it\'s your turn!',
  prose:
    'You learned how to use bottom-up, top-down, and advanced features to ' +
    'navigate the Boston sphere of discourse.',
  enter(ctx) {
    const { globe } = ctx;
    try { globe.rotateTo(15, -25, HERO_FRAMING); } catch {}
    return () => {};
  },
};

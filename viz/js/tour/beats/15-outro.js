// 15-outro — final card; "Explore" button closes the tour.

import { HERO_FRAMING } from '../../core/constants.js';

export const beat = {
  id: 'outro',
  kind: 'outro',
  title: 'Go forth and explore',
  prose:
    'The sphere holds 422k voices (posts and comments) from 2015 to 2025. Hover any ' +
    'point to read the thread. Scroll to zoom. Click a topic bar on the left to drill ' +
    'into subtopics and points of view. The browser back/forward arrows step through ' +
    'your selections. Press ? for the full shortcut list.',
  enter(ctx) {
    const { globe } = ctx;
    try { globe.rotateTo(15, -25, HERO_FRAMING); } catch {}
    return () => {};
  },
};

// 15-outro — final card; "Explore" button closes the tour.

import { HERO_FRAMING } from '../../core/constants.js';

export const beat = {
  id: 'outro',
  kind: 'outro',
  title: 'Go forth and explore',
  prose:
    'The sphere holds about 422,000 voices, made up of posts and comments from 2015 to ' +
    '2025. Hover over any point to read the thread it comes from, and scroll to zoom in ' +
    'or out. Click a topic bar on the left to drill into subtopics and points of view. ' +
    'The browser back and forward arrows step through your selections, and you can ' +
    'press ? at any time to see the full shortcut list.',
  enter(ctx) {
    const { globe } = ctx;
    try { globe.rotateTo(15, -25, HERO_FRAMING); } catch {}
    return () => {};
  },
};

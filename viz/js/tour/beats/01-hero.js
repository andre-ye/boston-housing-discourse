// 01-hero — split-screen intro; live globe spins behind transparent right pane.

import { raf } from '../../core/raf.js';
import { HERO_FRAMING, HERO_NUDGE_LON, HERO_NUDGE_LAT } from '../../core/constants.js';

export const beat = {
  id: 'hero',
  kind: 'hero',
  headline: 'A Sphere of Boston\nHousing Discourse',
  lede:
    '420k Reddit posts and comments and 22 street interviews about housing, ' +
    'transit, and city life in Boston.',
  ledeHtml:
    '420k Reddit posts and comments and 22 street interviews' +
    '<span class="tour-lede-br" aria-hidden="true"></span> about housing, ' +
    'transit, and city life in Boston.',
  metaHtml:
    '<span class="tour-meta-line">By Andre Ye, Kendall Nakai, Gabrielle Cohn, ' +
    'and Carmel Schare · ' +
    '<a class="tour-meta-site-link" href="https://vis-society.github.io/" ' +
    'target="_blank" rel="noopener">vis-society.github.io</a></span>' +
    '<span class="tour-meta-line">This project was developed with guidance ' +
    'and feedback <span class="tour-meta-mapc-br" aria-hidden="true"></span>' +
    'from the <a href="https://www.mapc.org/" target="_blank" ' +
    'rel="noopener">Metropolitan Area Planning Council (MAPC)</a>.</span>',
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

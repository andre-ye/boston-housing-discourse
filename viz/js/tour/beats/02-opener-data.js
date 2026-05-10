// 02-opener-data — Opener page 1 of 3. Both data sources, plain prose.
//
// The hero spin RAF (started by 01-hero) keeps running while the runner
// stays in the 'opener' kind — the globe drifts slowly behind the card.
// This beat owns no spin loop of its own; that's intentional.

import { raf } from '../../core/raf.js';
import { OPENER_NUDGE_LON, OPENER_NUDGE_LAT, HERO_FRAMING } from '../../core/constants.js';

export const beat = {
  id: 'opener-data',
  kind: 'opener',
  title: 'Beyond the numbers',
  bodyHtml:
    '<p>Numerical datasets are good for measurable numbers like rising prices, ' +
    'historical rates, and types of issued. We wanted to capture what Boston ' +
    'residents feel like what irritates someone on a given day, what gets ' +
    'brought up at a city council meeting, and what neighbors agree or ' +
    'disagree on. By listening to what people raise on their own terms, we ' +
    'can map the messier, more honest texture of people living in Boston.</p>' +
    '<p>The evidence here comes from two places: 420,000+ Reddit posts and ' +
    'comments from Boston-region subreddits between 2015 and 2025 (pulled ' +
    'from the public ' +
    '<a href="https://academictorrents.com/details/3e3f64dee22dc304cdd2546254ca1f8e8ae542b4" ' +
    'target="_blank" rel="noopener">Academic Torrents Reddit dump</a>), ' +
    'and 18 people we spoke with via street interviews around the city.</p>',
  enter(ctx) {
    const { globe, direction } = ctx;
    // Forward entry preserves the spinning hero camera so the globe doesn't
    // snap back to the rest pose mid-spin. Only backward entry (returning
    // from a later step beat that zoomed in) resets to the hero framing.
    if (direction === 'backward') {
      try { globe.rotateTo(15, -25, HERO_FRAMING); } catch {}
    }
    const dispose = raf.add('tour:opener-spin', () => {
      try { globe.nudge?.(OPENER_NUDGE_LON, OPENER_NUDGE_LAT); } catch {}
    });
    return () => { try { dispose(); } catch {} };
  },
};

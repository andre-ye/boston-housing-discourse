// 02-opener-data — Tour opener page 1 of 3. Where the data came from.
//
// The hero spin RAF (started by 01-hero) keeps running while the runner
// stays in the 'opener' kind — the globe drifts slowly behind the card.
// This beat owns no spin loop of its own; that's intentional.

import { raf } from '../../core/raf.js';
import { HERO_FRAMING, OPENER_NUDGE_LON, OPENER_NUDGE_LAT } from '../../core/constants.js';

export const beat = {
  id: 'opener-data',
  kind: 'opener',
  eyebrow: 'WHERE THIS CAME FROM · 1 / 3',
  title: 'The data',
  bodyHtml: [
    '<p>The sphere combines two sources of voices.</p>',
    '<h3>Reddit, 2015&ndash;2025</h3>',
    '<p>The first source is about 400,000 posts and comments from Boston-region ',
    'subreddits (r/boston, r/Massachusetts, r/cambridgema, r/somerville, and the ',
    'neighbourhood subs around them), filtered down to housing, transit, and ',
    'city life. We pulled them from the public Reddit dump on ',
    '<a href="https://academictorrents.com" target="_blank" rel="noopener">Academic Torrents</a> ',
    'rather than scraping the site live.</p>',
    '<h3>Street interviews</h3>',
    '<p>The second source is interviews with about eighteen people we spoke ',
    'with in person around Boston, at MBTA stops and on sidewalks, about ',
    'housing, transit, and what the city is like to live in. They appear on ',
    'the sphere as <span class="opener-pin">P</span>-pins, placed near the ',
    'Reddit threads they sit closest to in meaning.</p>',
    '<h3>What is not here</h3>',
    '<p>This is not a representative sample of Boston. It leaves out people ',
    'who do not post on Reddit, and it leaves out anyone we did not reach on ',
    'the street, including people without phones and people who were not out ',
    'walking when we were. What you see here is two specific kinds of voice ',
    'placed side by side.</p>',
  ].join(''),
  enter(ctx) {
    const { globe } = ctx;
    try { globe.rotateTo(15, -25, HERO_FRAMING); } catch {}
    // The 01-hero spin RAF is torn down on transition; restart an opener-
    // paced spin and let it ride for the whole 3-page opener. Each opener
    // beat starts the same loop under the same key, so re-entering a page
    // (Back/Next) just rebinds without compounding speed.
    const dispose = raf.add('tour:opener-spin', () => {
      try { globe.nudge?.(OPENER_NUDGE_LON, OPENER_NUDGE_LAT); } catch {}
    });
    return () => {
      try { dispose(); } catch {}
    };
  },
};

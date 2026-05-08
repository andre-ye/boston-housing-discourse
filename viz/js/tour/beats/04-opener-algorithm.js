// 04-opener-algorithm — Tour opener page 3 of 3. The algorithm, briefly.

import { raf } from '../../core/raf.js';
import { HERO_FRAMING, OPENER_NUDGE_LON, OPENER_NUDGE_LAT } from '../../core/constants.js';

export const beat = {
  id: 'opener-algorithm',
  kind: 'opener',
  eyebrow: 'WHERE THIS CAME FROM · 3 / 3',
  title: 'How the layout was made',
  bodyHtml: [
    '<h3>Embedding</h3>',
    '<p>Each post or comment is run through ',
    '<a href="https://huggingface.co/BAAI/bge-large-en-v1.5" target="_blank" rel="noopener">BGE-large-en-v1.5</a>, ',
    'a sentence embedding model that turns text into a 1024-dimensional ',
    'vector. Comments saying similar things end up near each other in ',
    'that vector space.</p>',
    '<h3>Projection to the sphere</h3>',
    '<p>Vectors are reduced to 50 dimensions with PCA, a k-nearest-',
    'neighbour graph is built, and points are then optimised onto the ',
    'unit sphere using a manifold-constrained, ',
    '<a href="https://pymde.org" target="_blank" rel="noopener">PyMDE</a>-style ',
    'method &mdash; each gradient step is followed by a retraction back ',
    'onto S&sup2;. The goal: neighbours in embedding space stay neighbours ',
    'on the surface.</p>',
    '<h3>What this is not</h3>',
    '<p>This is not a topic model, a ranking, or an opinion poll. It is ',
    'a similarity layout. <em>Nearness</em> is meaningful &mdash; nearby ',
    'points say similar things. The <em>direction</em> between two ',
    'clusters isn&rsquo;t. North on the sphere has no meaning; only ',
    'distance does.</p>',
  ].join(''),
  enter(ctx) {
    const { globe } = ctx;
    try { globe.rotateTo(15, -25, HERO_FRAMING); } catch {}
    const dispose = raf.add('tour:opener-spin', () => {
      try { globe.nudge?.(OPENER_NUDGE_LON, OPENER_NUDGE_LAT); } catch {}
    });
    return () => {
      try { dispose(); } catch {}
    };
  },
};

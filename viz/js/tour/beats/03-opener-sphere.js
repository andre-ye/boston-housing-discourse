// 03-opener-sphere — Tour opener page 2 of 3. Why a sphere, not a flat scatter.

import { raf } from '../../core/raf.js';
import { HERO_FRAMING, OPENER_NUDGE_LON, OPENER_NUDGE_LAT } from '../../core/constants.js';

export const beat = {
  id: 'opener-sphere',
  kind: 'opener',
  eyebrow: 'WHERE THIS CAME FROM · 2 / 3',
  title: 'Why a sphere',
  bodyHtml: [
    '<p>The natural alternative is a flat 2D plot &mdash; t-SNE, UMAP, ',
    'PCA. We chose a sphere instead, for three reasons.</p>',
    '<h3>No edges</h3>',
    '<p>A flat layout has corners and a frame. The eye treats those as ',
    'meaningful when they aren&rsquo;t. A sphere has no boundary and no ',
    'privileged direction.</p>',
    '<h3>No map</h3>',
    '<p>A 2D scatter looks like a map. People read east/west and up/down ',
    'as if they meant something. A globe sidesteps that &mdash; you have ',
    'to rotate it, which makes the arbitrariness of any one view obvious.</p>',
    '<p class="opener-aside">This is <em>not</em> a map of Boston. The ',
    'position of Boston Common doesn&rsquo;t appear here. Position on the ',
    'sphere reflects similarity of language, not geography.</p>',
    '<h3>Voids are real</h3>',
    '<p>Empty regions on the sphere are not blank space waiting to be ',
    'filled. A void is a region of the embedding space where this corpus ',
    'has little to say &mdash; a kind of conversation that didn&rsquo;t ',
    'show up in Boston Reddit between 2015 and 2025.</p>',
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

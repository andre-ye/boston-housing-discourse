// 03-opener-sphere — Opener page 2 of 3. Why a sphere, in plain language.

import { raf } from '../../core/raf.js';
import { OPENER_NUDGE_LON, OPENER_NUDGE_LAT, HERO_FRAMING } from '../../core/constants.js';

export const beat = {
  id: 'opener-sphere',
  kind: 'opener',
  title: 'Projecting discourse onto a sphere',
  bodyHtml:
    '<p>To be clear, this is not a globe of the Earth or of Boston, but a ' +
    'spherical projection of data. We embedded each post into a ' +
    '1024-dimensional vector, where similar content is mapped to similar ' +
    'points in space, and projected it onto a sphere using ' +
    '<a href="https://pymde.org/" target="_blank" rel="noopener">' +
    'manifold-constrained optimization (PyMDE)</a>.</p>' +
    '<p><strong>A spherical projection avoids placing artificial edges ' +
    'and centers that a more traditional two-dimensional Cartesian plane ' +
    'would impose, arbitrarily drawing attention toward some topics over ' +
    'others.</strong> We think a sphere captures the complexity and ' +
    'connectivity of public discourse better than any flat layout could.</p>',
  enter(ctx) {
    const { globe, direction } = ctx;
    if (direction === 'backward') {
      try { globe.rotateTo(15, -25, HERO_FRAMING); } catch {}
    }
    const dispose = raf.add('tour:opener-spin', () => {
      try { globe.nudge?.(OPENER_NUDGE_LON, OPENER_NUDGE_LAT); } catch {}
    });
    return () => { try { dispose(); } catch {} };
  },
};

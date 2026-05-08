// 02-interview-pins — narration card, interview pins spotlighted, slow drift.

import { raf } from '../../core/raf.js';
import { PIN_FRAMING } from '../../core/constants.js';

export const beat = {
  id: 'interview-pins',
  kind: 'card',
  title: 'We started by talking to 26 people',
  prose:
    'We stood at MBTA stops, commuter rail platforms, and on sidewalks around the ' +
    'metro area. We asked people about where they live and their commute.',
  enter(ctx) {
    const { globe, App } = ctx;
    try { globe.rotateTo(20, -30, PIN_FRAMING); } catch {}

    const placements = App.state?.interviewPins?.placements || [];
    const idxSet = new Set(placements.map(p => p.idx).filter(i => Number.isFinite(i)));
    let spotlightOn = false;
    if (idxSet.size > 0) {
      try { globe.setSpotlight?.(idxSet); spotlightOn = true; } catch {}
      document.body.classList.add('tour-pin-spotlight');
    }

    const dispose = raf.add('tour:pin-spin', () => {
      try { globe.nudge?.(0.14, -0.025); } catch {}
    });

    return () => {
      try { dispose(); } catch {}
      if (spotlightOn) {
        try { globe.setSpotlight?.(null); } catch {}
      }
      document.body.classList.remove('tour-pin-spotlight');
    };
  },
};

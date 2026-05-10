// Part 1 / Step 4 — listen to a real person.
//
// Pans to interview pin P1, now placed inside cl 32 (gentrification & rent
// control) on a Reddit comment about subsidized affordable units, luxury
// development pressure, and what gets built market-rate. P1's transcript is
// about housing affordability and the subsidized-vs-market-rate math, which
// fits this cluster directly.

import { PIN_FRAMING } from '../../core/constants.js';

const PIN_ID = 'P1';
// Pin location from viz/interviews/pin_placements.json. Frozen here so the
// camera pan is independent of the placements file's load order.
const PIN_LAT = 0.482;
const PIN_LON = -2.266;

export const beat = {
  id: 'cluster1-interview',
  kind: 'step',
  section: { topic: 'gentrification & rent control', tool: 'bottom-up tools', cl: 32 },
  bodyHtml:
    '<p>Some of these voices are people we spoke with via street interviews. ' +
    'They appear on the sphere as <strong>P-pins</strong>. <strong>Click ' + PIN_ID +
    '</strong> to hear from someone weighing what subsidized and ' +
    'income-restricted options actually exist against what gets built ' +
    'market-rate. Their themes and quotes will appear in the left panel ' +
    'alongside the Reddit posts you\'ve been reading.</p>',
  showChrome: ['cards', 'pins'],
  pulse: 'tour-pulse-pin-' + PIN_ID,
  manualContinue: true,
  enter(ctx) {
    const { globe, App, markStepDone } = ctx;
    document.body.classList.add('tour-cam-snappy');
    // Retract any leftover scattershot sprouts from the prior R-step that
    // the user didn't dismiss themselves — clears the canvas so the P-pin
    // is the only thing competing for attention here.
    try { App?.clearSprouts?.({ immediate: false }); } catch {}
    try { globe.rotateTo(PIN_LAT, PIN_LON, PIN_FRAMING); } catch {}

    let advanced = false;
    const onPinClick = (ev) => {
      const id = ev?.detail?.pin?.id;
      if (id !== PIN_ID) return;
      if (!advanced) {
        advanced = true;
        markStepDone?.();
      }
    };
    globe.addEventListener('pinclick', onPinClick);

    return () => {
      globe.removeEventListener('pinclick', onPinClick);
      document.body.classList.remove('tour-cam-snappy');
    };
  },
};

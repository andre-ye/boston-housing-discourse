// Part 2 / Step 3 — pick a stance inside the legal-advice subtopic.
//
// Re-anchored per ANCHORS.position to posIdx=3 "Lease Terms & Tenant Rights"
// (the largest stance in cl=8 sub=2 / gid=32, 41.6% of the subcluster).
// The pulse selector is `tour-pulse-l3-32_3` (gid_posIdx).

import { ANCHORS } from '../anchors.js';

const POS_IDX = ANCHORS.position.posIdx;

export const beat = {
  id: 'cluster2-stance',
  kind: 'step',
  section: { topic: 'tenant rights & landlords', tool: 'top-down tools', cl: 8 },
  bodyHtml:
    `<p>One step deeper: the rightmost column lists the <em>stances</em> ` +
    `(or points of view) people take inside this subtopic, ` +
    `i.e. what they\'re actually arguing for, ` +
    `not just what they\'re arguing about. <strong>Click ` +
    `“Lease disputes ...”</strong> (42% of this subtopic) to spotlight ` +
    `every post arguing about lease language and security deposits. ` +
    `Use some of the bottom-up methods like hovering or pressing ` +
    `<kbd>R</kbd> to get an idea of what people are talking about.</p>`,
  showChrome: ['nav'],
  pulse: `tour-pulse-l3-32_${POS_IDX}`,
  manualContinue: true,
  enter(ctx) {
    const { nav, markStepDone } = ctx;
    try { nav.focus({ cl: 8, gid: 32 }); } catch {}

    let advanced = false;
    const onFocus = (ev) => {
      if (advanced) return;
      if (ev?.detail?.gid === 32 && ev?.detail?.posIdx === POS_IDX) {
        advanced = true;
        markStepDone?.();
      }
    };
    nav.addEventListener('focus', onFocus);

    return () => {
      nav.removeEventListener('focus', onFocus);
    };
  },
};

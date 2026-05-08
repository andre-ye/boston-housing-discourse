// Part 2 / Step 3 — pick a stance inside the legal-advice subtopic.
//
// L3 chip for cl=8 sub=2 (gid=32) posIdx=2 "Legal Representation & Court" —
// the lawyers / legal-aid / housing-court stance. Picked because the
// real-quote anchor below (idx=141777, score 730) sits in this stance:
// "Sounds like retaliation… find a lawyer." The pulse selector is
// `tour-pulse-l3-32_2` (gid_posIdx).

export const beat = {
  id: 'cluster2-stance',
  kind: 'step',
  eyebrow: 'PART 2 — TOP-DOWN',
  title: 'Click “Legal Representation & Court”',
  prose:
    'Down at the leaf level, the right column lists stances inside the subtopic. ' +
    '“Legal Representation & Court” is the corner where people answer with concrete ' +
    'legal moves: get a lawyer, go to housing court, send a Notice to Quit, document ' +
    'everything. One real comment in this stance reads, “Sounds like retaliation. If ' +
    'your landlord tries to evict you, find a lawyer,” with a link to masslegalhelp.org. ' +
    'Click the stance to spotlight every post taking that angle.',
  pullquotes: [
    'Sounds like retaliation. If your landlord tries to evict you, find a lawyer.',
    'Get a lawyer and go to housing court — open and shut case.',
  ],
  showChrome: ['nav'],
  pulse: 'tour-pulse-l3-32_2',
  manualContinue: true,
  enter(ctx) {
    const { nav, markStepDone } = ctx;
    try { nav.focus({ cl: 8, gid: 32 }); } catch {}

    let advanced = false;
    const onFocus = (ev) => {
      if (advanced) return;
      if (ev?.detail?.gid === 32 && ev?.detail?.posIdx === 2) {
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

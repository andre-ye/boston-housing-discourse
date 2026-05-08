// Part 2 / Step 3 — pick a stance inside the legal-advice subtopic.
//
// L3 chip for cl=8 sub=2 (gid=32) posIdx=1 "Retaliation & Illegal Eviction" —
// the stance where commenters tell tenants "this is retaliation, find a
// lawyer." Picked because the real-quote anchor below (idx=141777, score 730)
// sits in this stance: "Sounds like retaliation… find a lawyer." The pulse
// selector is `tour-pulse-l3-32_1` (gid_posIdx).

export const beat = {
  id: 'cluster2-stance',
  kind: 'step',
  eyebrow: 'PART 2 — TOP-DOWN',
  title: 'Click “Retaliation & Illegal Eviction”',
  prose:
    'Down at the leaf level, the right column lists stances inside the subtopic. ' +
    '“Retaliation & Illegal Eviction” is the corner where commenters answer with ' +
    'concrete legal moves: name the retaliation, find a lawyer, point at the state ' +
    'tenant-rights guides. One real comment in this stance reads, “Sounds like ' +
    'retaliation. If your landlord tries to evict you, I’d try to find a lawyer,” ' +
    'with a link to masslegalhelp.org. Click the stance to spotlight every post ' +
    'taking that angle.',
  pullquotes: [
    'Sounds like retaliation. If your landlord tries to evict you, I’d try to find a lawyer.',
  ],
  showChrome: ['nav'],
  pulse: 'tour-pulse-l3-32_1',
  manualContinue: true,
  enter(ctx) {
    const { nav, markStepDone } = ctx;
    try { nav.focus({ cl: 8, gid: 32 }); } catch {}

    let advanced = false;
    const onFocus = (ev) => {
      if (advanced) return;
      if (ev?.detail?.gid === 32 && ev?.detail?.posIdx === 1) {
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

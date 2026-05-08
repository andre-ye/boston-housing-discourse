// Part 2 / Step 2 — narrate the cluster, then click into the legal-advice
// subtopic.
//
// Camera stays on cl=8 from the previous beat. We pulse the L2 chip for
// "MA Tenant Rights & Law" (cl=8 sub=2, gid=32) — the legal-advice corner
// of the cluster, dense with statute citations and masslegalhelp.org links.
// Subtopics inside cl=8 (per tutorial-content.md) cover heat and oil-tank
// disputes, broken locks and unannounced landlord entry, lead-paint
// requirements, and eviction retaliation.

export const beat = {
  id: 'cluster2-narration',
  kind: 'step',
  eyebrow: 'PART 2 — TOP-DOWN',
  title: 'Click “MA Tenant Rights & Law”',
  prose:
    'Inside Tenant Rights & Landlords the topics get small and concrete. One corner is ' +
    'heating: tenants without working oil tanks, radiators stuck on 78°, fights over who ' +
    'pays the gas bill. Another is repair access — a broken lock the landlord will not ' +
    'fix, a property manager cycling tour groups through someone’s apartment without ' +
    'notice. The legal-advice subtopic is where statute citations live: eviction ' +
    'retaliation, lead-hazard rules for households with children under six, links to ' +
    'masslegalhelp.org. Click it to see the actual answers people are giving.',
  pullquotes: [
    'They absolutely cannot evict you for having a baby; it is textbook discrimination.',
    'Sounds like retaliation. If your landlord tries to evict you, find a lawyer.',
  ],
  showChrome: ['nav'],
  pulse: 'tour-pulse-l2-8_2',
  manualContinue: true,
  enter(ctx) {
    const { nav, markStepDone } = ctx;
    // Make sure we're at cl=8 (the previous beat got us here, but if the
    // user came back from a deeper beat, re-apply).
    try { nav.focus({ cl: 8 }); } catch {}

    let advanced = false;
    const onFocus = (ev) => {
      if (advanced) return;
      if (ev?.detail?.gid === 32) {
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

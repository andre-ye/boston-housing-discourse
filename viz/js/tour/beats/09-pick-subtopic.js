// Part 2 / Step 2 — pick a subtopic.
//
// COLLAPSED from former (10 narration + 11 click). The narration described
// the cluster the previous beat zoomed into; now we keep that camera framing
// (no nav.focus reset) and pulse the subtopic in the middle column.

export const beat = {
  id: 'pick-subtopic',
  kind: 'step',
  eyebrow: 'PART 2 — TOP-DOWN',
  title: 'Click “Rent Stabilization Ideas”',
  prose:
    'Topic 32, “Gentrification & Rent Control,” holds a decade of argument about what ' +
    'Boston’s housing crisis actually is. The middle column splits the topic into ' +
    'subtopics, and the biggest one is “Rent Stabilization Ideas,” which is where the ' +
    'actual rent-control debate plays out. Click it.',
  pullquotes: [
    'Market supply can’t match demand here.',
    'Rent control is good for incumbents and bad for newcomers.',
    'It’s the zoning that made this mess.',
  ],
  showChrome: ['nav'],
  pulse: 'tour-pulse-l2-32_4',
  manualContinue: true,
  enter(ctx) {
    const { nav, markStepDone } = ctx;
    // Make sure we're at cl=32 (the previous beat got us here, but if the
    // user came back from a deeper beat, re-apply).
    try { nav.focus({ cl: 32 }); } catch {}

    let advanced = false;
    const onFocus = (ev) => {
      if (advanced) return;
      if (ev?.detail?.gid === 131) {
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

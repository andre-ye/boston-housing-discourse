// Part 2 / Step 3 — pick a point of view.
//
// COLLAPSED from former (12 narration + 13 click). The right column lists
// stances inside the chosen subtopic; the largest is "Shortage & Disincentive"
// (756 posts arguing rent control shrinks supply). Click it to spotlight
// every post tagged with that exact argument.

export const beat = {
  id: 'pick-stance',
  kind: 'step',
  eyebrow: 'PART 2 — TOP-DOWN',
  title: 'Click “Shortage & Disincentive”',
  prose:
    'Inside “Rent Stabilization Ideas,” each point is a post or comment taking a side, ' +
    'either for rent control, against it, or threading some nuanced middle path. The ' +
    'right column lists the points of view. The largest one, “Shortage & Disincentive,” ' +
    'argues that rent control shrinks supply, and it covers 756 posts. Click it.',
  pullquotes: [
    'Rent control is good for incumbents and bad for newcomers.',
    'You need both stabilization and new construction.',
  ],
  showChrome: ['nav'],
  pulse: 'tour-pulse-l3-131_2',
  manualContinue: true,
  enter(ctx) {
    const { nav, markStepDone } = ctx;
    try { nav.focus({ cl: 32, gid: 131 }); } catch {}

    let advanced = false;
    const onFocus = (ev) => {
      if (advanced) return;
      if (ev?.detail?.gid === 131 && ev?.detail?.posIdx === 2) {
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

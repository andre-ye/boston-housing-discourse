// Part 2 / Step 4 — pin a post.
//
// User has now narrowed to a single stance; every glowing dot is one post
// arguing that exact position. Clicking any dot pins it and pops the detail
// card. We advance on the first valid pointclick.

export const beat = {
  id: 'pin-a-post',
  kind: 'step',
  eyebrow: 'PART 2 — TOP-DOWN',
  title: 'Pin one of the highlighted posts',
  prose:
    'Now that you’ve narrowed to a single stance, every glowing dot is a post making ' +
    'this exact argument. Click any one to pin it — a panel on the right shows the full ' +
    'text and a link to the original Reddit thread.',
  hint: 'Click any glowing dot →',
  showChrome: ['nav', 'cards'],
  manualContinue: true,
  enter(ctx) {
    const { globe, App, markStepDone } = ctx;
    try { App?.clearPinnedPoint?.(); } catch {}
    ['focus-card', 'interview-card', 'detail-card']
      .forEach(id => document.getElementById(id)?.classList.add('hidden'));

    let advanced = false;
    const onClick = (ev) => {
      if (advanced) return;
      if (ev?.detail?.idx >= 0) {
        advanced = true;
        markStepDone?.();
      }
    };
    globe.addEventListener('pointclick', onClick);

    return () => {
      globe.removeEventListener('pointclick', onClick);
    };
  },
};

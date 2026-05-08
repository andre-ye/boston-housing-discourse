// Part 2 / Step 1 — pick a topic.
//
// COLLAPSED from former (8 narration + 9 click) — the click step zoomed
// the camera to the cluster the narration had just framed, undoing its own
// setup. Now: one beat with the narration prose, the cluster pulse on the
// left rail, waiting for the user to click "Gentrification & Rent Control".

export const beat = {
  id: 'pick-topic',
  kind: 'step',
  eyebrow: 'PART 2 — TOP-DOWN',
  title: 'Pick a topic and drill in',
  prose:
    'You can also start from a topic and narrow down. The left rail is sorted by how ' +
    'loud each topic is. Topic 32 — “Gentrification & Rent Control” — is the loudest ' +
    'fault line in Boston housing. Click it to drill in.',
  hint: '← Click “Gentrification & Rent Control”',
  showChrome: ['nav'],
  pulse: 'tour-pulse-l1-32',
  manualContinue: true,
  enter(ctx) {
    const { globe, nav, App, markStepDone } = ctx;

    // Reset state so the click handler sees a clean baseline.
    try { App?.clearConnectionsMode?.(); } catch {}
    try { App?.clearPinnedPoint?.(); } catch {}
    try { globe.setPinnedPoint(-1); } catch {}
    try { nav.focus({}); } catch {}

    let advanced = false;
    const onFocus = (ev) => {
      if (advanced) return;
      if (ev?.detail?.cl === 32 && ev?.detail?.gid == null) {
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

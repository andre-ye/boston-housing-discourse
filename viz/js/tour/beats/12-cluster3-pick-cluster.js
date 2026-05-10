// Part 3 / Step 0 — pick the bike-lane cluster from the left rail.
//
// Bridges cluster 2 → cluster 3. The eyebrow flips to PART 3 and the
// headline names *why* we are moving (the bike-lane debate); the user
// then clicks cl=5 in the rail so the search beat has an established
// cluster context to narrow.
//
// cl=5 "Cycling & Bike Lanes" lives on the opposite side of the sphere
// from the cluster-2 tenant-rights work (centroid lat=0.918, lon=0.905),
// so we reset to the wide hero framing first — the camera will ease
// into cl=5 once the user clicks the topic.

import { HERO_FRAMING } from '../../core/constants.js';

export const beat = {
  id: 'cluster3-pick-cluster',
  kind: 'step',
  section: { topic: 'cycling & bike lanes', tool: 'search & time', cl: 5 },
  bodyHtml:
    '<p>For our final section we’ll explore <span class="topic-tag" data-cl="5">' +
    'cycling and bike lanes</span> with some more advanced tools: <em>search</em> ' +
    'lets you ask the sphere a specific question, and <em>time filtering</em> ' +
    'lets you watch a conversation move month by month. <strong>Click ' +
    '“Cycling &amp; Bike Lanes” on the left</strong> to set the stage.</p>',
  showChrome: ['nav'],
  pulse: 'tour-pulse-l1-5',
  manualContinue: true,
  enter(ctx) {
    const { globe, nav, App, markStepDone } = ctx;

    try { App?.clearPinnedPoint?.(); } catch {}
    try { globe.setPinnedPoint(-1); } catch {}
    try { nav.focus({}); } catch {}

    try { globe.rotateTo(0, 0, HERO_FRAMING); } catch {}

    // Smooth-scroll the L1 stack so the cl=5 chip lands near the top with
    // ~half a chip of headroom — same approach as the cluster-2 pick beat.
    // Without it the pulse can fire on a chip that's scrolled out of view.
    let scrollRaf = 0;
    const scrollChipIntoView = () => {
      const stack = document.getElementById('stack-l1');
      const seg = stack?.querySelector('.bar-seg[data-key="5"]');
      if (!stack || !seg) return;
      const segTop = parseFloat(seg.style.top) || 0;
      const segH = parseFloat(seg.style.height) || 0;
      const headroom = Math.max(20, segH * 0.5);
      const targetRaw = segTop - headroom;
      const maxScroll = Math.max(0, stack.scrollHeight - stack.clientHeight);
      const target = Math.max(0, Math.min(maxScroll, targetRaw));
      const start = stack.scrollTop;
      if (Math.abs(target - start) < 2) return;
      const dur = 750;
      const t0 = performance.now();
      const easeInOut = (t) => t < 0.5
        ? 2 * t * t
        : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const tick = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        stack.scrollTop = start + (target - start) * easeInOut(t);
        if (t < 1) scrollRaf = requestAnimationFrame(tick);
      };
      scrollRaf = requestAnimationFrame(tick);
    };
    requestAnimationFrame(() => requestAnimationFrame(scrollChipIntoView));

    let advanced = false;
    const onFocus = (ev) => {
      if (advanced) return;
      if (ev?.detail?.cl === 5 && ev?.detail?.gid == null) {
        advanced = true;
        markStepDone?.();
      }
    };
    nav.addEventListener('focus', onFocus);

    return () => {
      nav.removeEventListener('focus', onFocus);
      if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0; }
    };
  },
};

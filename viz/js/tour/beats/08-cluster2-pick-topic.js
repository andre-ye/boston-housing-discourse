// Part 2 / Step 1 — pick the Tenant Rights & Landlords topic, then drill into
// the MA Tenant Rights & Law subtopic. (Merged from former beats 8 + 9; the
// jury flagged the three-click cluster-2 sequence as a sag — collapsing the
// topic-pick and subtopic-pick into a single beat with one payoff line keeps
// momentum.)
//
// Top-down family opener. After the bottom-up cluster-1 segment, the camera
// pulls back to the wide hero framing so the user sees the whole left rail
// and globe. We pulse the cl=8 chip first and wait for the user to click into
// it; once cl=8 is focused, we re-pulse the L2 chip for "MA Tenant Rights &
// Law" (gid=32) and wait for that click to advance.
//
// cl=8 "Tenant Rights & Landlords" centroid (lat=-0.049, lon=2.370) sits on
// the opposite side of the sphere from cl=32, so a wide reframe is the
// honest motion: no faked transition.

import { HERO_FRAMING } from '../../core/constants.js';

export const beat = {
  id: 'cluster2-pick-topic',
  kind: 'step',
  section: { topic: 'tenant rights & landlords', tool: 'top-down tools', cl: 8 },
  bodyHtml:
    '<p>Now we’ll explore <span class="topic-tag" data-cl="8">tenant rights ' +
    'and landlords</span> the other way around — using <em>top-down</em> ' +
    'tools. Instead of zooming into a region and listening, you’ll start ' +
    'from the named topic on the left, drill into a subtopic, and surface ' +
    'the stances people take inside it. <strong>Click “Tenant Rights &amp; ' +
    'Landlords” on the left, then “MA Tenant Rights &amp; Law”</strong> — ' +
    'so we can explore discourse about topics like eviction retaliation, ' +
    'lead-paint rules, and masslegalhelp.org links.</p>',
  showChrome: ['nav'],
  pulse: 'tour-pulse-l1-8',
  manualContinue: true,
  enter(ctx) {
    const { globe, nav, App, markStepDone } = ctx;

    // Reset state so the click handler sees a clean baseline.
    try { App?.clearPinnedPoint?.(); } catch {}
    try { globe.setPinnedPoint(-1); } catch {}
    try { nav.focus({}); } catch {}

    // Wide framing so the whole nav and globe are visible.
    try { globe.rotateTo(0, 0, HERO_FRAMING); } catch {}

    // Smooth-scroll the L1 stack so the cl=8 chip lands near the top with
    // ~half of the previous chip showing above it as a "you came from up
    // there" reference. The pulse on the cl=8 chip is already wired by
    // `pulse: 'tour-pulse-l1-8'` above; without this scroll the chip can
    // sit far enough down the (sorted-by-share) topic list that the user
    // never sees the pulse.
    let scrollRaf = 0;
    const scrollChipIntoView = () => {
      const stack = document.getElementById('stack-l1');
      const seg = stack?.querySelector('.bar-seg[data-key="8"]');
      if (!stack || !seg) return;
      const segTop = parseFloat(seg.style.top) || 0;
      const segH = parseFloat(seg.style.height) || 0;
      // Target: chip near the top with a half-chip's worth of headroom.
      const headroom = Math.max(20, segH * 0.5);
      const targetRaw = segTop - headroom;
      const maxScroll = Math.max(0, stack.scrollHeight - stack.clientHeight);
      const target = Math.max(0, Math.min(maxScroll, targetRaw));
      const start = stack.scrollTop;
      if (Math.abs(target - start) < 2) return;
      const dur = 750;   // smooth, not too quick
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
    // Run after layout settles (nav.focus({}) re-renders L1; ribbons redraw
    // on rAF). Two rAFs is enough to clear the renderL1 → innerHTML wipe.
    requestAnimationFrame(() => requestAnimationFrame(scrollChipIntoView));

    let topicPicked = false;
    let advanced = false;
    const onFocus = (ev) => {
      if (advanced) return;
      const d = ev?.detail || {};
      if (!topicPicked && d.cl === 8 && d.gid == null) {
        // Topic selected — re-pulse the L2 chip for the MA Tenant Rights &
        // Law subtopic. CSS owns the pulse styling; we just swap the body
        // class the runner installed.
        topicPicked = true;
        try {
          document.body.classList.remove('tour-pulse-l1-8');
          document.body.classList.add('tour-pulse-l2-8_2');
        } catch {}
        return;
      }
      if (topicPicked && d.gid === 32) {
        advanced = true;
        markStepDone?.();
      }
    };
    nav.addEventListener('focus', onFocus);

    return () => {
      nav.removeEventListener('focus', onFocus);
      if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0; }
      try { document.body.classList.remove('tour-pulse-l2-8_2'); } catch {}
    };
  },
};

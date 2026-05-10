// Part 1 / Step 3 — curated scattershot for the rent-control cluster.
//
// Pressing R or clicking the R chip sprouts five voices around the sphere.
// During the tour we override the random pool with a hand-picked set
// (see tutorial-content.md § "R-scattershot curated set"): five comments
// across five different subclusters of cl=32, so the user feels the cluster
// as an argument-with-many-positions, not a single position. The override
// is wired through `App.tour.curatedSproutIndices` (read by sproutSpawn in
// main.js); we set it on enter and clear it on cleanup.
//
// Cleanup: clear the curated indices hook, unbind chip click, unbind R
// keybind, clear collapse timer, retract any sprouts left on screen.

// Hand-picked indices from tutorial-content.md. One per cl=32 subcluster
// (sub=0/1/2/3/4), chosen for substance + a quote that reads aloud well.
// At the beat's camera (lat=0.467, lon=-2.375, dist=2.05) the previously
// chosen sub=4 (282489) and sub=5 (58464) picks projected near/past the
// canvas edge on common viewport sizes and got silently dropped by
// _screenOf, leaving only three captions on screen. Replaced with two
// picks higher on the disc (lat ≈ 0.72–0.75) that stay comfortably
// inside the frustum across desktop and portrait aspects.
const CURATED_INDICES = [
  421909,   // sub=0 Supply vs. Demand: "BPDA made it so difficult to build"
  241887,   // sub=1 Housing Market: "mega-investment firms hoover up housing stock"
  342511,   // sub=2 Displacement: "rewards existing residents at expense of future"
  351674,   // sub=3 Pro-housing Politics: "trending in the right direction… only become a majority viewpoint in some places"
  139972,   // sub=4 Rent Stabilization: "modern rent stabilization… exempts new construction. It actually incentivizes new buildings"
];

export const beat = {
  id: 'five-random',
  kind: 'step',
  section: { topic: 'gentrification & rent control', tool: 'bottom-up tools', cl: 32 },
  bodyHtml:
    '<p>To help you quickly get acquainted with what people in this region ' +
    'are saying, pressing <kbd>R</kbd> will surface five random comments ' +
    'from your current view. Press <kbd>R</kbd> again to dismiss them. ' +
    'Notice the five voices don’t all agree, even inside one cluster, ' +
    'people argue.</p>',
  // #38 — when the user clicks one of the five sprouted captions, sprouts.js
  // calls App.showDetailCard which renders into #pinned-view. Without
  // 'cards' in showChrome the pinned-view stays opacity:0/visibility:hidden
  // (per the body.tour-active default) and the click looks broken. Opting
  // into 'cards' here lets the pinned-view become interactive without
  // disabling the global pinned-view-while-tour-active fade.
  showChrome: ['random', 'cards'],
  pulse: 'tour-pulse-random',
  manualContinue: true,
  enter(ctx) {
    const { App, globe, keys, markStepDone } = ctx;

    // Reset any leftover sprouts and blur whatever has focus so R reaches us.
    try { App?.clearSprouts?.({ immediate: true }); } catch {}
    try {
      const ae = document.activeElement;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
    } catch {}

    // Install the curated-indices hook so the next R fire returns these
    // exact five points. main.js sproutSpawn reads this off App.tour.
    if (App?.tour) {
      App.tour.curatedSproutIndices = CURATED_INDICES.slice();
    }
    // Aim the camera at the cl=32 centroid so the curated picks are on
    // screen when sproutSpawn projects them. (Off-screen indices are
    // dropped by the override path.)
    try { globe.rotateTo(0.467, -2.375, 2.05); } catch {}

    let fired = false;
    const trigger = () => {
      if (fired) return;
      fired = true;
      markStepDone?.();
      // Sprouts stay on screen until the user dismisses them (Esc / R again)
      // or moves to the next beat. The previous auto-collapse timer made the
      // captions vanish ~2.5s after R, before users had time to read them.
    };

    const chip = document.getElementById('random-hint');
    // Capture phase + stopImmediatePropagation so main.js’s bubble listener
    // on #random-hint never runs (would double-fire). Match global R behavior:
    // first activation spawns the curated five + marks the step done; later
    // presses toggle scattershot off, same as App.toggleScattershot().
    const onChipClick = (e) => {
      try { e.stopImmediatePropagation?.(); e.preventDefault?.(); } catch {}
      if (!fired) {
        try { App?.sampleFiveRandom?.(); } catch {}
        trigger();
      } else {
        try { App?.toggleScattershot?.(); } catch {}
      }
    };
    chip?.addEventListener('click', onChipClick, true);

    const unbindKey = keys.bind({
      keys: ['r'],
      priority: 200,
      label: 'tour-step:r-advance',
      helpHidden: true,
      handler: (e) => {
        if (!fired) {
          e.preventDefault();
          try { App?.sampleFiveRandom?.(); } catch {}
          trigger();
          return true;
        }
        return false;
      },
    });

    return () => {
      // Must pass capture:true — addEventListener used capture phase so the
      // bubble-phase listener in main.js never double-fires. Omitting it
      // leaves a zombie handler that runs first on revisit and blocks R-chip
      // behavior + markStepDone().
      chip?.removeEventListener('click', onChipClick, true);
      unbindKey();
      // Drop the curated-indices hook so the next R press outside this
      // beat goes back to the normal random sampling.
      if (App?.tour) {
        App.tour.curatedSproutIndices = null;
      }
      // Animated retract on exit (matches sprout-clear non-immediate path).
      try { App?.clearSprouts?.({ immediate: false }); } catch {}
      // #18 — if the user clicked one of the spawned posts, the pinned-view
      // and the globe's pinned spotlight stick around when they navigate
      // forward or back. The beat owns that state (it spawned the sprouts
      // that led to the pin), so it must tear it down on cleanup.
      try { App?.clearPinnedPoint?.(); } catch {}
      try { App?.hidePinnedView?.(); } catch {}
      try { App?.clearPinnedBackStack?.(); } catch {}
      document.getElementById('pinned-view')?.classList.add('hidden');
    };
  },
};

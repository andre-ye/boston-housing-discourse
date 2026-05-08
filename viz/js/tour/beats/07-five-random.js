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
// (sub=0/1/2/4/5), chosen for substance + a quote that reads aloud well.
const CURATED_INDICES = [
  421909,   // sub=0 Supply vs. Demand: "BPDA made it so difficult to build"
  241887,   // sub=1 Housing Market: "mega-investment firms hoover up housing stock"
  342511,   // sub=2 Displacement: "rewards existing residents at expense of future"
  282489,   // sub=4 Rent Stabilization: "increases bargaining power of renters renewing"
   58464,   // sub=5 Airbnb / market: "less likely to move if market rent outpaces"
];

export const beat = {
  id: 'five-random',
  kind: 'step',
  eyebrow: 'PART 1 — BOTTOM-UP',
  title: 'Sample five voices at once',
  prose:
    'Press R to sample five posts from the area you are looking at. We picked these five ' +
    'so they read across the cluster. One blames zoning, one blames investment firms, ' +
    'one wants more tenant bargaining power, one warns that rent control rewards existing ' +
    'renters at the expense of new ones, and one notes that a stagnant market locks people ' +
    'in place. They sit near each other on the sphere because they are all arguing about ' +
    'the same thing.',
  hint: 'Press R or click below. Press Esc to dismiss cards.',
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
    try { globe.rotateTo(0.467, -2.375, 1.6); } catch {}

    let fired = false;
    let collapseTimer = null;
    const startCollapseTimer = () => {
      if (collapseTimer != null) return;
      collapseTimer = setTimeout(() => {
        try { App?.clearSprouts?.({ immediate: false }); } catch {}
      }, 2500);
    };
    const trigger = () => {
      if (fired) return;
      fired = true;
      markStepDone?.();
      startCollapseTimer();
    };

    const chip = document.getElementById('random-hint');
    // Once the curated five have sprouted, a second chip click would
    // resample (with the curated indices still installed, the same five
    // would respawn) and visually thrash the screen. Latch off after the
    // first fire — registered in the capture phase with stopImmediate-
    // Propagation so the global #random-hint click handler in main.js
    // (which always calls sampleFiveRandom) doesn't fire either while
    // the latch is held.
    const onChipClick = (e) => {
      try { e.stopImmediatePropagation?.(); e.preventDefault?.(); } catch {}
      if (fired) return;
      try { App?.sampleFiveRandom?.(); } catch {}
      trigger();
    };
    chip?.addEventListener('click', onChipClick, true);

    const unbindKey = keys.bind({
      keys: ['r'],
      priority: 200,
      label: 'tour-step:r-advance',
      handler: () => { trigger(); return false; },
    });

    return () => {
      chip?.removeEventListener('click', onChipClick);
      unbindKey();
      if (collapseTimer != null) {
        clearTimeout(collapseTimer);
        collapseTimer = null;
      }
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

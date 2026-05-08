// Part 1 / Step 3 — random-five action.
//
// Pressing R or clicking the R chip sprouts five random voices around the
// sphere. We bind R via the keys registry (priority 200 so it fires before
// the global R handler, but returning false means the global handler still
// runs and the actual sample fires).
//
// Cleanup: unbind chip click, unbind R keybind, clear collapse timer,
// retract any sprouts left on screen.

export const beat = {
  id: 'five-random',
  kind: 'step',
  eyebrow: 'PART 1 — BOTTOM-UP',
  title: 'Sample five voices at once',
  prose:
    'When you want a quick read on what the sphere actually contains, sample five ' +
    'random voices from whatever’s currently visible. Press R or tap the R chip in the ' +
    'bottom toolbar (“R · C · Reset” row). Esc dismisses floating captions; Reset clears ' +
    'drill, filters, timeline, zoom.',
  hint: 'Press R or click below • Esc dismisses cards',
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
    const { App, keys, markStepDone } = ctx;

    // Reset any leftover sprouts and blur whatever has focus so R reaches us.
    try { App?.clearSprouts?.({ immediate: true }); } catch {}
    try {
      const ae = document.activeElement;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
    } catch {}

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
    const onChipClick = () => {
      try { App?.sampleFiveRandom?.(); } catch {}
      trigger();
    };
    chip?.addEventListener('click', onChipClick);

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
      // Animated retract on exit (matches sprout-clear non-immediate path).
      try { App?.clearSprouts?.({ immediate: false }); } catch {}
      // #18 — if the user clicked one of the spawned posts, the pinned-view
      // and the globe's pinned spotlight stick around when they navigate
      // forward or back. The beat owns that state (it spawned the sprouts
      // that led to the pin), so it must tear it down on cleanup.
      try { App?.clearPinnedPoint?.(); } catch {}
      document.getElementById('pinned-view')?.classList.add('hidden');
    };
  },
};

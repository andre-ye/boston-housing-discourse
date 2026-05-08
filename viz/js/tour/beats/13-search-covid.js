// Part 3 / Step 1 — search "covid".
//
// Drop the rent-control filter so the search runs across the whole corpus,
// focus the search input, listen for "covid" to appear, then spotlight the
// matches and rotate to the densest pocket.

import { rotateToPointSet } from '../helpers.js';

export const beat = {
  id: 'search-covid',
  kind: 'step',
  eyebrow: 'PART 3 — SEARCH & TIME',
  title: 'Search for a chronological phrase',
  prose:
    'Some conversations on the sphere have a clear shape in time. Covid is a clean ' +
    'example: almost nothing before 2020, then a city-wide argument about housing, ' +
    'commutes, work, schools, nightlife, and risk. Type “Covid” into the search bar.',
  hint: '↖ Type into the search bar',
  showChrome: ['nav'],
  pulse: 'tour-pulse-search',
  manualContinue: true,
  enter(ctx) {
    const { App, globe, nav, markStepDone } = ctx;

    try { App?.clearConnectionsMode?.(); } catch {}
    try { App?.clearPinnedPoint?.(); } catch {}
    try { nav.focus({}); } catch {}

    const focusRaf = requestAnimationFrame(() => {
      try {
        const input = document.getElementById('search-input');
        input?.focus();
      } catch {}
    });

    const input = document.getElementById('search-input');
    let ran = false;
    const onInput = async () => {
      if (!input) return;
      const q = (input.value || '').trim();
      if (ran || !q.toLowerCase().includes('covid')) return;
      ran = true;
      try {
        const set = await App?.findPointsContaining?.(q);
        if (set && set.size > 0) {
          try { globe.setSpotlight(set); } catch {}
          rotateToPointSet(globe, App.state, set, 1.35);
        }
      } catch {}
      markStepDone?.();
    };
    input?.addEventListener('input', onInput);

    return () => {
      cancelAnimationFrame(focusRaf);
      input?.removeEventListener('input', onInput);
    };
  },
};

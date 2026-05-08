// Part 3 / Step 2 — open the timeline scrubber on cluster 3.
//
// Camera stays where the search beat left it (inside cl=5). We pulse the ⏱
// button and listen for the user to open the timeline. We do not assume the
// user drags it — the prose suggests the comparison and points to the years
// that show the shift, but advancing only requires opening the scrubber.

export const beat = {
  id: 'cluster3-time',
  kind: 'step',
  eyebrow: 'PART 3 — SEARCH & TIME',
  title: 'Open the timeline',
  prose:
    'The bike-lane conversation has changed shape over the decade in the corpus. ' +
    'Before 2018 it averaged a handful of posts a month — commute logistics, ice ' +
    'on the Esplanade, shop recommendations. After 2024 it averages hundreds: ' +
    'PAC ads against Mayor Wu, lanes blocked by police cruisers, design fights. ' +
    'Open the timeline scrubber, then try dragging the window to compare 2016 ' +
    'and 2024 — the cluster fills in as the window slides forward.',
  hint: 'Click the ⏱ button in the bottom right.',
  showChrome: ['time'],
  pulse: 'tour-pulse-time',
  manualContinue: true,
  enter(ctx) {
    const { markStepDone } = ctx;
    const tlBtn = document.getElementById('tl-toggle');
    if (!tlBtn) {
      // No button to click — let the user use Next.
      return () => {};
    }
    let advanced = false;
    const onClick = () => {
      if (advanced) return;
      // The same button toggles the scrubber open AND closed. If clicking
      // closed it, that's not the action we're cueing — wait for the next
      // click that actually opens it. The body class flips synchronously
      // inside the toggle handler, so reading it after the click is safe.
      if (!document.body.classList.contains('has-timeline-open')) return;
      advanced = true;
      markStepDone?.();
    };
    tlBtn.addEventListener('click', onClick);
    return () => {
      tlBtn.removeEventListener('click', onClick);
    };
  },
};

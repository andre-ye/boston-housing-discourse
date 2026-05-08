// Part 3 / Step 2 — open the timeline scrubber.
//
// User clicks the ⏱ button in the bottom-right of the globe. We listen for
// the click and advance.

export const beat = {
  id: 'open-timeline',
  kind: 'step',
  eyebrow: 'PART 3 — SEARCH & TIME',
  title: 'Open the timeline',
  prose:
    'Covid has an unmistakable chronology: almost no mentions before 2020, then a sharp ' +
    'change in what Boston talks about. Open the timeline scrubber and move the handles ' +
    'around 2020 to see that shift.',
  hint: 'Click the ⏱ button ↘',
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
      advanced = true;
      markStepDone?.();
    };
    tlBtn.addEventListener('click', onClick);
    return () => {
      tlBtn.removeEventListener('click', onClick);
    };
  },
};

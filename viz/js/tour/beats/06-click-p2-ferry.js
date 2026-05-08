// Part 1 / Step 2 — meet an interview pin (P2). Qualitative voice.
//
// Spotlight only the anchor post under P2 so the rest of the sphere fades.
// Pin click triggers markStepDone; runner waits for Next.

export const beat = {
  id: 'click-p2-ferry',
  kind: 'step',
  eyebrow: 'PART 1 — BOTTOM-UP',
  title: 'Click P2 — a ferry commuter',
  prose:
    'Eighteen of the twenty-six people we interviewed are pinned next to topics they ' +
    'discussed. P2 talked about a multimodal commute and a calm ferry leg — they’re ' +
    'anchored where transit voices cluster. Click P2 to read what they said.',
  hint: 'Click the glowing P2 pin →',
  showChrome: ['pins', 'cards'],
  pulse: 'tour-pulse-pin-P2',
  manualContinue: true,
  enter(ctx) {
    const { globe, App, markStepDone } = ctx;
    const placements = App?.state?.interviewPins?.placements || [];
    const p2 = placements.find(p => p.id === 'P2');
    const idxSet = new Set(
      placements.filter(p => p.id === 'P2')
        .map(p => p.idx).filter(i => Number.isFinite(i))
    );

    let spotlightOn = false;
    if (idxSet.size > 0) {
      try { globe.setSpotlight(idxSet); spotlightOn = true; } catch {}
    }
    document.body.classList.add('tour-pin-spotlight');
    if (p2) { try { globe.rotateTo(p2.lat, p2.lon, 1.9); } catch {} }
    else    { try { globe.rotateTo(20, -30, 2.4); } catch {} }

    let advanced = false;
    const onPinClick = (ev) => {
      if (ev?.detail?.pin?.id !== 'P2' || advanced) return;
      advanced = true;
      markStepDone?.();
    };
    globe.addEventListener('pinclick', onPinClick);

    return () => {
      globe.removeEventListener('pinclick', onPinClick);
      if (spotlightOn) {
        try { globe.setSpotlight(null); } catch {}
      }
      document.body.classList.remove('tour-pin-spotlight');
      document.getElementById('interview-card')?.classList.add('hidden');
      document.getElementById('detail-card')?.classList.add('hidden');
    };
  },
};

// Guided tour — Atlantic-style narrative opener + deep drill-down
// across three clusters, each entering cluster → sub → position tier.
// Version 254.

// (data.js helpers not needed — nav.focus() handles routing & camera)

// ─── Beat definitions ──────────────────────────────────────────────────────
//
// kind:
//   'hero'      — split-screen intro; no globe action
//   'cluster'   — nav.focus({cl})                          zoom 1.9
//   'sub'       — nav.focus({cl, gid})                     zoom 1.55
//   'position'  — App.focusPosition(cl, gid, posIdx)       zoom 1.35
//   'outro'     — final card, "Explore" button closes tour
//
// GIDs (computed from subcluster_labels.json, clusters asc, subs asc within):
//   cl=32, sub=4 "Rent Stabilization Ideas"       → gid 131
//   cl= 8, sub=0 "Utilities & Heat Disputes"      → gid  30
//   cl=41, sub=3 "Pedestrian Deaths & Blame"      → gid 170
//
// Selected posIdx values (by post count, most evidenced):
//   gid 131 posIdx 2 "Shortage & Disincentive"   756 posts
//   gid  30 posIdx 5 "Heating System Issues"      309 posts
//   gid 170 posIdx 3 "Cyclists Unfairly Blamed"   570 posts

const BEATS = [

  // ── Step 0: hero ──────────────────────────────────────────────────────
  {
    kind: 'hero',
  },

  // ── Steps 1–3: Gentrification & Rent Control (cl=32) ─────────────────
  {
    kind: 'cluster',
    cl: 32,
    step: 'Stop 1 of 3',
    eyebrow: 'Who gets to live here',
    title: 'Rent control, zoning, and housing supply',
    prose:
      'Cluster 32 — "Gentrification & Rent Control" — holds a decade of argument ' +
      'about what Boston\'s housing crisis actually is. The globe is rotating to ' +
      'bring it into focus. Every neighboring point is a thread on the same fault line.',
    pullquotes: [
      'Market supply can\'t match demand here.',
      'Rent control is good for incumbents and bad for newcomers.',
      'It\'s the zoning that made this mess.',
    ],
  },
  {
    kind: 'sub',
    cl: 32,
    gid: 131,          // Rent Stabilization Ideas
    step: 'Stop 1 of 3 — subtopic',
    eyebrow: 'Subtopic: Rent Stabilization Ideas',
    title: 'The rent control fault line',
    prose:
      'The globe zooms into "Rent Stabilization Ideas" — one subtopic within ' +
      'the cluster. Each point here is a post taking a side: for rent control, ' +
      'against it, or threading some nuanced middle path. Hover a point to read ' +
      'the actual thread.',
    pullquotes: [
      'Rent control is good for incumbents and bad for newcomers.',
      'You need both stabilization and new construction.',
    ],
  },
  {
    kind: 'position',
    cl: 32,
    gid: 131,           // Rent Stabilization Ideas
    posIdx: 2,          // "Shortage & Disincentive" — 756 posts
    step: 'Stop 1 of 3 — position',
    eyebrow: 'Position: Shortage & Disincentive',
    title: 'Rent control makes the shortage worse',
    prose:
      'This specific stance — 756 posts — argues rent control shrinks supply ' +
      'by disincentivizing construction and causing landlords to convert or neglect ' +
      'units. The highlighted points are every post the model tagged with exactly ' +
      'this argument.',
    pullquotes: [
      '"Rent control keeps prices low for current tenants but kills the stock ' +
       'available for everyone else."',
    ],
  },

  // ── Steps 4–6: Tenant Rights & Landlords (cl=8) ───────────────────────
  {
    kind: 'cluster',
    cl: 8,
    step: 'Stop 2 of 3',
    eyebrow: 'Once you\'re inside the door',
    title: 'Heating, repairs, and landlord obligations',
    prose:
      'The globe swings to cluster 8 — "Tenant Rights & Landlords." ' +
      'This is the day-to-day texture of renting in Boston: what counts as an ' +
      'emergency, how cold the apartment has to get before you can call the city, ' +
      'and the quiet infrastructure of who owes what.',
    pullquotes: [
      '98°F with no AC — is that uninhabitable?',
      'Landlord hasn\'t fixed the boiler in three weeks.',
      'Mass tenant rights actually do cover this.',
    ],
  },
  {
    kind: 'sub',
    cl: 8,
    gid: 30,           // Utilities & Heat Disputes
    step: 'Stop 2 of 3 — subtopic',
    eyebrow: 'Subtopic: Utilities & Heat Disputes',
    title: 'When the heat goes out',
    prose:
      'Drill into "Utilities & Heat Disputes." These posts cluster together ' +
      'because they share the same legal question: does the landlord have to act, ' +
      'and by when? The point cloud tightens as the camera closes in on this pocket.',
    pullquotes: [
      'Landlord hasn\'t fixed the boiler in three weeks.',
      'There\'s a city hotline for this. They actually respond.',
    ],
  },
  {
    kind: 'position',
    cl: 8,
    gid: 30,           // Utilities & Heat Disputes
    posIdx: 5,         // "Heating System Issues & Repairs" — 309 posts
    step: 'Stop 2 of 3 — position',
    eyebrow: 'Position: Heating System Issues & Repairs',
    title: 'Heat must be provided in winter',
    prose:
      '309 posts assert a simple legal fact: during winter, Massachusetts law ' +
      'requires landlords to maintain heat above a threshold. These are the posts ' +
      'that spell it out, argue about the exact thresholds, and report what happened ' +
      'when the boiler failed for the third time.',
    pullquotes: [
      '"Heat has to be at least 68°F between 7 AM and 11 PM under Mass law."',
    ],
  },

  // ── Steps 7–9: Pedestrian & Cyclist Safety (cl=41) ───────────────────
  {
    kind: 'cluster',
    cl: 41,
    step: 'Stop 3 of 3',
    eyebrow: 'The unexpected argument',
    title: 'Where the loudest fights are about bike lanes',
    prose:
      'The third cluster is a surprise. Nothing polarizes Boston Reddit quite ' +
      'like a white stripe painted on Commonwealth Ave. The globe has crossed to ' +
      'a completely different region — cluster 41, "Pedestrian & Cyclist Safety." ' +
      'Who kills whom. Who runs red lights. Ghost bikes, Vision Zero, right-hooks ' +
      'at Porter.',
    pullquotes: [
      'Drivers kill far more people than cyclists do.',
      'Cyclists roll through stops constantly.',
      'Protected lanes aren\'t optional — they\'re the only thing that works.',
    ],
  },
  {
    kind: 'sub',
    cl: 41,
    gid: 170,          // Pedestrian Deaths & Blame
    step: 'Stop 3 of 3 — subtopic',
    eyebrow: 'Subtopic: Pedestrian Deaths & Blame',
    title: 'Who is responsible for traffic deaths',
    prose:
      'Drill into "Pedestrian Deaths & Blame." These posts are about specific ' +
      'crashes, specific streets, and a recurring argument about whether the ' +
      'problem is individual behavior or how the city built the road. ' +
      'Ghost bikes, Vision Zero, named victims.',
    pullquotes: [
      'A ghost bike appeared on Mass Ave last week.',
      'Vision Zero said zero. It\'s nowhere near zero.',
    ],
  },
  {
    kind: 'position',
    cl: 41,
    gid: 170,          // Pedestrian Deaths & Blame
    posIdx: 3,         // "Cyclists Unfairly Blamed" — 570 posts
    step: 'Stop 3 of 3 — position',
    eyebrow: 'Position: Cyclists Unfairly Blamed',
    title: 'Society scapegoats cyclists',
    prose:
      '570 posts push back against the framing that cyclists are the problem. ' +
      'They cite statistics, ghost bike memorials, and a persistent asymmetry: ' +
      'cars cause vastly more death and injury, yet cultural blame lands on the ' +
      'person in the bike lane.',
    pullquotes: [
      '"Every cyclist death gets blamed on the cyclist. ' +
       'Every driver death gets blamed on the road."',
    ],
  },

  // ── Step 10: outro ─────────────────────────────────────────────────────
  {
    kind: 'outro',
    eyebrow: 'Now it\'s yours',
    title: 'Take your time.',
    prose:
      'The sphere holds 422,114 posts from 2015 to 2025. ' +
      'Hover any point to read the thread. Scroll to zoom. ' +
      'Click a cluster bar on the left to drill in. ' +
      'Use [ ] to cycle positions, { } for subtopics, t for the timeline, ' +
      '? for the full key reference.',
  },
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Brief "virtual click" visual pulse on a sidebar element.
function pulseElement(selector) {
  try {
    const el = document.querySelector(selector);
    if (!el) return;
    el.classList.add('tour-pulse');
    setTimeout(() => el.classList.remove('tour-pulse'), 900);
  } catch {}
}

// ─── createTour ────────────────────────────────────────────────────────────

export function createTour({ globe, App, nav }) {
  let idx = 0;
  let active = false;
  let _heroSpinRAF = null;

  const overlay = document.getElementById('tour-overlay');
  if (!overlay) return { start() {}, close() {}, isActive: () => false };

  // ── DOM references ──────────────────────────────────────────────────
  const heroEl     = overlay.querySelector('.tour-hero');
  const cardEl     = overlay.querySelector('.tour-card');
  const outroEl    = overlay.querySelector('.tour-outro');
  const btnBegin   = overlay.querySelector('#tour-begin');
  const btnNext    = overlay.querySelector('#tour-next');
  const btnPrev    = overlay.querySelector('#tour-prev');
  const btnSkip    = overlay.querySelector('#tour-skip');
  const skipHero   = overlay.querySelector('#tour-skip-hero');
  const btnExplore = overlay.querySelector('#tour-explore');

  // ── Hero spin ───────────────────────────────────────────────────────
  // We spin the real globe slowly while the hero is displayed, so the right
  // half of the split screen shows a live, gently rotating globe.
  function startHeroSpin() {
    stopHeroSpin();
    const spin = () => {
      if (!active || idx !== 0) return;
      globe.nudge?.(0.22, -0.06);
      _heroSpinRAF = requestAnimationFrame(spin);
    };
    _heroSpinRAF = requestAnimationFrame(spin);
  }

  function stopHeroSpin() {
    if (_heroSpinRAF != null) {
      cancelAnimationFrame(_heroSpinRAF);
      _heroSpinRAF = null;
    }
  }

  // ── Panel visibility ────────────────────────────────────────────────
  function showOnly(which) {
    heroEl?.classList.toggle('hidden', which !== 'hero');
    cardEl?.classList.toggle('hidden', which !== 'card');
    outroEl?.classList.toggle('hidden', which !== 'outro');
  }

  // ── Render functions ────────────────────────────────────────────────
  function renderHero() {
    showOnly('hero');
    document.body.classList.add('tour-at-hero');
    globe.rotateTo(15, -25, 3.0);
    startHeroSpin();
  }

  function renderCard(beat) {
    stopHeroSpin();
    document.body.classList.remove('tour-at-hero');
    showOnly('card');

    const stepEl  = cardEl.querySelector('.tour-step');
    const eyEl    = cardEl.querySelector('.tour-eyebrow');
    const titEl   = cardEl.querySelector('.tour-title');
    const proEl   = cardEl.querySelector('.tour-prose');
    const quotesEl = cardEl.querySelector('.tour-quotes');

    if (stepEl)   stepEl.textContent = beat.step || '';
    if (eyEl)     eyEl.textContent   = beat.eyebrow || '';
    if (titEl)    titEl.textContent  = beat.title || '';
    if (proEl)    proEl.textContent  = beat.prose || '';
    if (quotesEl) {
      quotesEl.innerHTML = (beat.pullquotes || [])
        .map(q => `<blockquote class="tour-quote">\u201c${esc(q)}\u201d</blockquote>`)
        .join('');
    }

    // Buttons — hide Back on first card; change Next label on last card before outro
    const isLastCard = (idx === BEATS.length - 2);
    btnPrev?.classList.toggle('hidden', idx <= 1);
    if (btnNext) {
      btnNext.textContent = isLastCard ? 'Finish tour \u2192' : 'Next \u2192';
    }

    // Slide-in animation
    cardEl.classList.remove('tour-in');
    void cardEl.offsetWidth;
    cardEl.classList.add('tour-in');
  }

  function renderOutro(beat) {
    stopHeroSpin();
    document.body.classList.remove('tour-at-hero');
    showOnly('outro');

    const eyEl  = outroEl?.querySelector('.tour-eyebrow');
    const titEl = outroEl?.querySelector('.tour-title');
    const proEl = outroEl?.querySelector('.tour-prose');
    if (eyEl)  eyEl.textContent  = beat.eyebrow || '';
    if (titEl) titEl.textContent = beat.title || '';
    if (proEl) proEl.textContent = beat.prose || '';
  }

  // ── Globe / nav actions ─────────────────────────────────────────────
  // Each beat calls nav.focus (which main.js's listener will translate into
  // globe rotation + focus-card rendering, exactly as if the user clicked).
  // For position beats we also call window.App.focusPosition to zoom to the
  // position anchor and highlight the exact point cloud.
  function performBeat(beat) {
    try {
      if (beat.kind === 'cluster') {
        nav.focus({ cl: beat.cl });
        // Pulse the matching sidebar cluster bar segment
        setTimeout(() => {
          pulseElement(`#stack-l1 .bar-seg[data-key="${beat.cl}"]`);
        }, 250);
      } else if (beat.kind === 'sub') {
        nav.focus({ cl: beat.cl, gid: beat.gid });
        setTimeout(() => {
          const g = App.subGidMap?.byGid?.[beat.gid];
          if (g) pulseElement(`#stack-l2 .bar-seg[data-key="${g.cl}_${g.sub}"]`);
        }, 250);
      } else if (beat.kind === 'position') {
        // nav.focus to the sub level first so sidebar + focus card reflect context
        nav.focus({ cl: beat.cl, gid: beat.gid });
        // Then zoom into the position anchor with a short delay
        setTimeout(() => {
          if (window.App?.focusPosition) {
            window.App.focusPosition(beat.cl, beat.gid, beat.posIdx);
          }
        }, 150);
      }
    } catch (e) {
      console.warn('tour: performBeat failed', e);
    }
  }

  // ── Master render ───────────────────────────────────────────────────
  function render() {
    const beat = BEATS[idx];
    if (!beat) return;

    if (beat.kind === 'hero') {
      renderHero();
    } else if (beat.kind === 'outro') {
      renderOutro(beat);
      try { globe.rotateTo(15, -25, 3.0); } catch {}
    } else {
      // Start the globe action a beat ahead so the sphere is already settling
      // when the narration card slides in.
      performBeat(beat);
      setTimeout(() => {
        if (active && BEATS[idx] === beat) renderCard(beat);
      }, 380);
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────
  function start() {
    if (active) return;
    active = true;
    idx = 0;
    overlay.classList.remove('hidden');
    document.body.classList.add('tour-active');
    render();
  }

  function close() {
    if (!active) return;
    active = false;
    stopHeroSpin();
    overlay.classList.add('hidden');
    document.body.classList.remove('tour-at-hero');
    document.body.classList.remove('tour-active');
    try {
      nav.focus({});
      globe.rotateTo(15, -25, 3.0);
    } catch {}
  }

  function next() {
    if (idx >= BEATS.length - 1) { close(); return; }
    idx += 1;
    render();
  }

  function prev() {
    if (idx <= 1) return; // step 0 is hero; don't go behind step 1
    idx -= 1;
    render();
  }

  // ── Wire buttons ────────────────────────────────────────────────────
  btnBegin?.addEventListener('click', next);
  btnNext?.addEventListener('click', next);
  btnPrev?.addEventListener('click', prev);
  btnSkip?.addEventListener('click', close);
  skipHero?.addEventListener('click', close);
  btnExplore?.addEventListener('click', close);

  // ── Keyboard ────────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.key === 'Escape')                        { close(); e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === ' ') { next(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft')                { prev(); e.preventDefault(); }
  });

  return { start, close, isActive: () => active };
}

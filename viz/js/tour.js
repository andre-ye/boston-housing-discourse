// Guided tour — Atlantic-style narrative opener + deep drill-down
// across three clusters, each entering cluster → sub → point-of-view tier.
// Version 286 — true narrative integration of the tutorial. Every
// affordance (hover, drill cluster→sub→position, click P2, time filter,
// random sample) is taught INSIDE the corresponding drill step rather
// than parked in awkward standalone tutorial beats. Each interactive
// step also pulses the specific element the user is told to click via
// `pulseClass` body classes (see CSS `tour-pulse-*` rules), so the
// hint text and the visual highlight always agree.

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

  // ── Hero ─────────────────────────────────────────────────────────────
  {
    kind: 'hero',
    eyebrow: 'A Social Sphere of Boston Discourse',
    headline: 'The Boston Social Sphere Discourse of Reddit',
    lede:
      'Over 400,000 Reddit posts and comments about housing, transit, and city life in Boston from 2015\u20132025, grouped by topics and points of view',
  },

  // ── Methodology part 1 — interview pins spotlight ───────────────────
  {
    kind: 'interstitial',
    eyebrow: 'A dash of qualitative: Touching grass and talking to people',
    title: 'We started by talking to 26 people',
    prose:
      'We stood at MBTA stops, commuter rail platforms, and on sidewalks around the ' +
      'metro area. We asked people about ' +
      'where they live and their commute.',
    showInterviewPins: true,
  },

  // ── Methodology part 2 — Reddit corpus ───────────────────────────────
  {
    kind: 'interstitial',
    eyebrow: 'A bucket of quantitative: Scraping a decade of Reddit discourse',
    title: 'We then gathered 422k+ voices on Reddit',
    prose:
      'To see how the conversations we had matched up with what was being said online, we scraped 422,000+ Reddit posts and comments from 2015 to ' +
      '2025 \u2014 housing, transit, city life. Then we laid them out so neighboring ' +
      'dots (posts or comments) sit near threads on related topics.',
  },

  // ── Why a sphere? — geometric framing ────────────────────────────────
  {
    kind: 'interstitial',
    eyebrow: 'No center, no edges',
    title: 'Why a sphere?',
    prose:
      'There is no center or edges so no discourse is cornered to a particular realm. A sphere also links related threads in space so browsing feels more serendipitous.',
  },

  // ── Tutorial: HOVER — "What is anyone actually saying?" ─────────────
  // First interactive moment. Sidebar is hidden — only the globe + the
  // narration card. We pin a sample point so there is always a glowing
  // target near the cursor; the hover handler in main.js suppresses
  // tooltips while the cursor is over the narration card itself, so
  // moving the mouse around freely never flashes the tour card.
  {
    kind: 'interstitial',
    eyebrow: 'What is anyone actually saying?',
    title: 'Each dot is one voice',
    prose:
      'A single point on the sphere is one Reddit post or comment. Color is its topic. Hover any glowing dot to peek at the actual text.',
    steps: [
      {
        heading: 'Hover any dot to read the post',
        body: 'Find a glowing point on the sphere and rest your cursor on it — the post text appears in a tooltip. When you\'ve hovered a few, click Continue.',
        hint: 'Hover any dot — the tooltip will appear ↗',
        showChrome: [],
        manualContinue: true,
        setup: ({ globe, nav, App }) => {
          try { nav.focus({}); } catch {}
          const placements = App?.state?.interviewPins?.placements || [];
          const sample = placements[Math.floor(placements.length / 2)] || placements[0];
          if (sample) {
            try { globe.rotateTo(sample.lat, sample.lon, 1.55); } catch {}
            if (Number.isFinite(sample.idx)) {
              try { globe.setPinnedPoint(sample.idx); } catch {}
            }
          }
          return () => { try { globe.setPinnedPoint(-1); } catch {} };
        },
        subscribe: ({ globe }, advance) => {
          const onHover = (ev) => { if (ev?.detail?.idx >= 0) advance(); };
          const onMove  = (ev) => { if (ev?.detail?.idx >= 0) advance(); };
          globe.addEventListener('hover', onHover);
          globe.addEventListener('hovermove', onMove);
          return () => {
            globe.removeEventListener('hover', onHover);
            globe.removeEventListener('hovermove', onMove);
          };
        },
      },
    ],
  },

  // ── Step 1 of 3: Gentrification (interactive cluster click) ─────────
  // The user is taught the drill pattern HERE rather than in a separate
  // tutorial beat. Clicking the cluster bar advances; the prose explains
  // what they just selected. No more "click any topic", no more
  // separate "click Gentrification" beat — one beat, one click, one
  // narrated arrival.
  {
    kind: 'interstitial',
    eyebrow: 'Stop 1 of 3 — Who gets to live here',
    title: 'Drill into Gentrification & Rent Control',
    prose:
      'The left rail stacks every topic in the corpus by how loud the conversation is. Topic 32, "Gentrification & Rent Control," is the biggest fault line in Boston housing — a decade of argument about rent stabilization, zoning, and supply. Click it.',
    steps: [
      {
        heading: 'Click "Gentrification & Rent Control"',
        body: 'Find "Gentrification & Rent Control" near the top of the left rail and click it — the globe will rotate the topic into view.',
        hint: '← Click "Gentrification & Rent Control"',
        showChrome: ['nav'],
        pulseClass: 'tour-pulse-l1-32',
        manualContinue: true,
        setup: ({ globe, nav }) => {
          try { globe.setPinnedPoint(-1); } catch {}
          // Step is idempotent: re-rendering (Back from the next beat)
          // starts the user at "no focus" so a click on cl=32 actually
          // means *drill in* rather than *toggle off* (a click on the
          // already-focused cluster zooms back out per nav.focus's own
          // toggle behaviour).
          try { nav.focus({}); } catch {}
          return () => {};
        },
        subscribe: ({ nav }, advance) => {
          const onFocus = (ev) => {
            if (ev?.detail?.cl === 32 && ev?.detail?.gid == null) advance();
          };
          nav.addEventListener('focus', onFocus);
          return () => nav.removeEventListener('focus', onFocus);
        },
      },
    ],
  },
  {
    kind: 'cluster',
    cl: 32,
    step: 'Stop 1 of 3 — topic',
    eyebrow: 'Who gets to live here',
    title: 'Rent control, zoning, and housing supply',
    prose:
      'Topic 32 — "Gentrification & Rent Control" — holds a decade of argument ' +
      'about what Boston\'s housing crisis actually is. Neighboring dots are posts or comments on the same fault line.',
    pullquotes: [
      'Market supply can\'t match demand here.',
      'Rent control is good for incumbents and bad for newcomers.',
      'It\'s the zoning that made this mess.',
    ],
  },

  // ── Step 1 of 3: drill into the rent-stabilization subtopic ─────────
  {
    kind: 'interstitial',
    eyebrow: 'Stop 1 of 3 — narrowing the question',
    title: 'Drill into "Rent Stabilization Ideas"',
    prose:
      'The middle column splits the topic into subtopics. The biggest one inside Gentrification is "Rent Stabilization Ideas" — the actual rent-control argument. Click it to keep narrowing.',
    steps: [
      {
        heading: 'Click "Rent Stabilization Ideas"',
        body: 'In the middle (subtopic) column, find "Rent Stabilization Ideas" near the top and click it. The globe will zoom into that subtopic\'s pocket of points.',
        hint: '← Click "Rent Stabilization Ideas"',
        showChrome: ['nav'],
        pulseClass: 'tour-pulse-l2-32_4',
        manualContinue: true,
        setup: ({ nav }) => {
          // Reset to cluster-level focus so the L2 column is populated
          // and a click on Rent Stab actually drills (rather than
          // toggling off if the user landed here with gid already set).
          try { nav.focus({ cl: 32 }); } catch {}
          return () => {};
        },
        subscribe: ({ nav }, advance) => {
          const onFocus = (ev) => {
            if (ev?.detail?.gid === 131) advance();
          };
          nav.addEventListener('focus', onFocus);
          return () => nav.removeEventListener('focus', onFocus);
        },
      },
    ],
  },
  {
    kind: 'sub',
    cl: 32,
    gid: 131,
    step: 'Stop 1 of 3 — subtopic',
    eyebrow: 'Subtopic: Rent Stabilization Ideas',
    title: 'The rent control fault line',
    prose:
      'You\'re now inside "Rent Stabilization Ideas." Each point is a post or comment taking a side: for rent control, against it, or threading some nuanced middle path. Hover one to read the thread.',
    pullquotes: [
      'Rent control is good for incumbents and bad for newcomers.',
      'You need both stabilization and new construction.',
    ],
  },

  // ── Step 1 of 3: drill into the "Shortage & Disincentive" position ──
  {
    kind: 'interstitial',
    eyebrow: 'Stop 1 of 3 — pin a stance',
    title: 'Drill into "Shortage & Disincentive"',
    prose:
      'The right column lists points of view inside this subtopic — actual stances people take. The largest one, "Shortage & Disincentive," argues rent control shrinks supply. Click it.',
    steps: [
      {
        heading: 'Click "Shortage & Disincentive"',
        body: 'In the right column, click "Shortage & Disincentive" — 756 posts argue this stance. The globe will spotlight every post tagged with that exact argument.',
        hint: '← Click "Shortage & Disincentive"',
        showChrome: ['nav'],
        pulseClass: 'tour-pulse-l3-131_2',
        manualContinue: true,
        setup: ({ nav }) => {
          // Reset to subtopic-level focus so the L3 column is populated
          // and a click on Shortage actually drills (rather than
          // unfocusing the position if the user landed here with one
          // already selected).
          try { nav.focus({ cl: 32, gid: 131 }); } catch {}
          return () => {};
        },
        subscribe: ({ nav }, advance) => {
          const onFocus = (ev) => {
            if (ev?.detail?.gid === 131 && ev?.detail?.posIdx === 2) advance();
          };
          nav.addEventListener('focus', onFocus);
          return () => nav.removeEventListener('focus', onFocus);
        },
      },
    ],
  },
  {
    kind: 'position',
    cl: 32,
    gid: 131,
    posIdx: 2,
    step: 'Stop 1 of 3 — point of view',
    eyebrow: 'Point of view: Shortage & Disincentive',
    title: 'Rent control makes the shortage worse',
    prose:
      'This stance — 756 posts — argues rent control shrinks supply ' +
      'by disincentivizing construction and causing landlords to convert or neglect ' +
      'units. The highlighted points are every post the model tagged with exactly ' +
      'this argument. You just learned the drill: topic → subtopic → point of view.',
    pullquotes: [
      '"Rent control keeps prices low for current tenants but kills the stock ' +
       'available for everyone else."',
    ],
  },

  // ── Tutorial: P-PINS — click P2 specifically ────────────────────────
  // After the Reddit drill, ask the user to switch from corpus to street.
  // P-pins are anchored next to the topic regions each interviewee
  // discussed. P2 is anchored near transit topics — they described a
  // calm water commute. Spotlight P2 only so the click target is
  // unambiguous.
  {
    kind: 'interstitial',
    eyebrow: 'What did real people on the ground say?',
    title: 'Click P2 — a ferry commuter',
    prose:
      'Eighteen of the twenty-six people we interviewed are anchored as P-pins next to the topics they discussed. P2 talked about a multimodal commute and a calm ferry leg — they\'re pinned where transit voices cluster. Click P2.',
    steps: [
      {
        heading: 'Click the P2 pin',
        body: 'Find the floating "P2" pin and click it — a panel appears with a short paraphrase of what they said. Read it, then hit Continue.',
        hint: 'Click the glowing P2 pin →',
        showChrome: ['pins', 'cards'],
        pulseClass: 'tour-pulse-pin-P2',
        manualContinue: true,
        setup: ({ globe, nav, App }) => {
          try { nav.focus({}); } catch {}
          // Spotlight ONLY P2's home cluster's anchor points so the
          // surrounding sphere doesn't compete for attention. The pin
          // itself gets highlighted via the `tour-pulse-pin-P2` body
          // class wired into CSS.
          const placements = App?.state?.interviewPins?.placements || [];
          const p2 = placements.find(p => p.id === 'P2');
          const idxSet = new Set(
            placements.filter(p => p.id === 'P2')
              .map(p => p.idx).filter(i => Number.isFinite(i))
          );
          try { if (idxSet.size > 0) globe.setSpotlight(idxSet); } catch {}
          document.body.classList.add('tour-pin-spotlight');
          if (p2) {
            try { globe.rotateTo(p2.lat, p2.lon, 1.9); } catch {}
          } else {
            try { globe.rotateTo(20, -30, 2.4); } catch {}
          }
          return () => {
            try { globe.setSpotlight(null); } catch {}
            document.body.classList.remove('tour-pin-spotlight');
            document.getElementById('interview-card')?.classList.add('hidden');
            document.getElementById('detail-card')?.classList.add('hidden');
            document.getElementById('position-card')?.classList.add('hidden');
          };
        },
        subscribe: ({ globe }, advance) => {
          // Only P2 counts. Clicking another pin still opens that pin's
          // card (the user hasn't been told they CAN'T explore), but
          // the tour stays on this step until they pick P2.
          const onPinClick = (ev) => {
            if (ev?.detail?.pin?.id === 'P2') advance();
          };
          globe.addEventListener('pinclick', onPinClick);
          return () => globe.removeEventListener('pinclick', onPinClick);
        },
      },
    ],
  },
  {
    kind: 'pin',
    pinId: 'P2',
    eyebrow: 'One of the interviews',
    title: 'A calm commute on the water.',
    prose:
      'P2 described a multimodal commute where the water leg felt calmer than the rest. We pinned them and seventeen other voices ' +
      'next to the topic regions related to what they discussed.',
    pullquotes: [
      'The water commute feels like the calm part of the day.',
    ],
  },

  // ── Step 2 of 3: Tenant Rights — auto drill, no clicks ──────────────
  // The user has already drilled cluster→sub→position once. The second
  // arc just narrates while the camera does the work — the drill pattern
  // is now muscle memory. We do bookend Stop 2 with a NEW tutorial
  // moment (the time filter) so each arc still teaches one new thing.
  {
    kind: 'cluster',
    cl: 8,
    step: 'Stop 2 of 3 — topic',
    eyebrow: 'Once you\'re inside the door',
    title: 'Heating, repairs, and landlord obligations',
    prose:
      'The globe swings to topic 8 — "Tenant Rights & Landlords." ' +
      'The day-to-day texture of renting in Boston: what counts as an ' +
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
    gid: 30,
    step: 'Stop 2 of 3 — subtopic',
    eyebrow: 'Subtopic: Utilities & Heat Disputes',
    title: 'When the heat goes out',
    prose:
      'Drilling automatically into "Utilities & Heat Disputes." These posts group together ' +
      'because they share the same legal question: does the landlord have to act, ' +
      'and by when?',
    pullquotes: [
      'Landlord hasn\'t fixed the boiler in three weeks.',
      'There\'s a city hotline for this. They actually respond.',
    ],
  },
  {
    kind: 'position',
    cl: 8,
    gid: 30,
    posIdx: 5,
    step: 'Stop 2 of 3 — point of view',
    eyebrow: 'Point of view: Heating System Issues & Repairs',
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

  // ── Tutorial: TIME — click the ⏱ button ─────────────────────────────
  // Heating gripes are seasonal — perfect place to teach the time
  // filter. We instruct a button click rather than a keybind so the
  // affordance is visible: pulse the bottom-right ⏱ button via the
  // `tour-step-show-time` class.
  {
    kind: 'interstitial',
    eyebrow: 'When did this peak?',
    title: 'Filter by time',
    prose:
      'Heating complaints look seasonal. The clock button in the bottom-right opens a month-range slider — drag to dim posts outside the period you care about.',
    steps: [
      {
        heading: 'Click the ⏱ button',
        body: 'Find the ⏱ clock button in the bottom-right of the globe (it\'s pulsing) and click it. A timeline scrubber will appear — drag the handles to filter the visible posts to a date range.',
        hint: 'Click the ⏱ button ↘',
        showChrome: ['time'],
        manualContinue: true,
        subscribe: (_ctx, advance) => {
          const tlBtn = document.getElementById('tl-toggle');
          if (!tlBtn) { advance(); return () => {}; }
          const onClick = () => advance();
          tlBtn.addEventListener('click', onClick);
          return () => tlBtn.removeEventListener('click', onClick);
        },
      },
    ],
  },

  // ── Step 3 of 3: Bike Lanes — auto drill, no clicks ─────────────────
  {
    kind: 'cluster',
    cl: 41,
    step: 'Stop 3 of 3 — topic',
    eyebrow: 'The unexpected argument',
    title: 'Where the loudest fights are about bike lanes',
    prose:
      'The third topic is a surprise. Nothing polarizes Boston Reddit quite ' +
      'like a white stripe painted on Commonwealth Ave. The globe has crossed to ' +
      'a completely different region — topic 41, "Pedestrian & Cyclist Safety." ' +
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
    gid: 170,
    step: 'Stop 3 of 3 — subtopic',
    eyebrow: 'Subtopic: Pedestrian Deaths & Blame',
    title: 'Who is responsible for traffic deaths',
    prose:
      'Drilling into "Pedestrian Deaths & Blame." Specific crashes, specific streets, and a recurring argument about whether the ' +
      'problem is individual behavior or how the city built the road.',
    pullquotes: [
      'A ghost bike appeared on Mass Ave last week.',
      'Vision Zero said zero. It\'s nowhere near zero.',
    ],
  },
  {
    kind: 'position',
    cl: 41,
    gid: 170,
    posIdx: 3,
    step: 'Stop 3 of 3 — point of view',
    eyebrow: 'Point of view: Cyclists Unfairly Blamed',
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

  // ── Tutorial: SPACE — click the space chip ──────────────────────────
  // Last tutorial moment. The chip in the top-right is now a button —
  // clicking it (or pressing Space) toggles five random posts into
  // view, useful for sanity-checking whatever's currently filtered.
  {
    kind: 'interstitial',
    eyebrow: 'A random handful',
    title: 'Five random voices',
    prose:
      'Want a quick sampling of whatever\'s currently on the sphere? Click the "space" chip in the top-right (or press Space) to surface five random posts. Click it again to clear them.',
    steps: [
      {
        heading: 'Click the "space" chip',
        body: 'In the top-right, click the chip labeled "space toggle 5 random posts / comments" (it\'s pulsing). Five random posts attached to currently-visible voices will sprout into view — short snippets you can read at a glance.',
        hint: 'Click the "space" chip ↗',
        showChrome: ['space'],
        manualContinue: true,
        setup: ({ App }) => {
          // Move focus off the tour-card buttons so a stray Enter / Space
          // doesn't activate Continue before the user clicks the chip.
          try {
            const ae = document.activeElement;
            if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
          } catch {}
          return () => { try { App?.clearSprouts?.(); } catch {} };
        },
        subscribe: ({ App }, advance) => {
          let toggled = false;
          const trigger = () => {
            if (toggled) return;
            toggled = true;
            advance();
          };
          // Either path counts: clicking the chip (now a real button)
          // OR pressing Space directly. The chip's own click handler
          // already calls toggleSprouts; we just listen for the click
          // here so we can advance the step.
          const sh = document.getElementById('space-hint');
          const onClick = () => trigger();
          const onKeyDown = (e) => {
            if (e.repeat) return;
            if (e.key !== ' ' && e.code !== 'Space') return;
            // Don't double-fire: toggle here, then advance. Block the
            // event from reaching focused tour-card buttons.
            e.preventDefault();
            e.stopPropagation();
            try { App?.toggleSprouts?.(); } catch {}
            trigger();
          };
          sh?.addEventListener('click', onClick);
          window.addEventListener('keydown', onKeyDown, true);
          return () => {
            sh?.removeEventListener('click', onClick);
            window.removeEventListener('keydown', onKeyDown, true);
          };
        },
      },
    ],
  },

  // ── Outro ────────────────────────────────────────────────────────────
  {
    kind: 'outro',
    eyebrow: 'Now it\'s your turn',
    title: 'Go forth and explore',
    prose:
      'The sphere holds 422k voices (posts and comments) from 2015 to 2025. ' +
      'Hover any point to read the thread. Scroll to zoom. ' +
      'Click a topic bar on the left to drill into subtopics and points of view. ' +
      'The browser back/forward arrows step through your selections. ' +
      'Press ? for the full shortcut list.',
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

  // ── Interview-pin spotlight ─────────────────────────────────────────
  // Used by the "We started by talking to 26 people" beat. Dims every globe
  // point except the anchor posts under the P-pins, lifts pin emphasis via
  // a body class, and slowly rotates the globe so each pin drifts past.
  let _pinSpinRAF = null;
  let _pinSpinBeatIdx = -1;
  let _pinSpotlightOn = false;
  function applyPinSpotlight(on) {
    if (on === _pinSpotlightOn) return;
    _pinSpotlightOn = on;
    try {
      if (on) {
        const placements = App.state?.interviewPins?.placements || [];
        const idxSet = new Set(placements.map(p => p.idx).filter(i => Number.isFinite(i)));
        if (idxSet.size > 0) globe.setSpotlight?.(idxSet);
        document.body.classList.add('tour-pin-spotlight');
      } else {
        globe.setSpotlight?.(null);
        document.body.classList.remove('tour-pin-spotlight');
      }
    } catch {}
  }
  function startPinSpin() {
    stopPinSpin();
    _pinSpinBeatIdx = idx;
    const spin = () => {
      if (!active || idx !== _pinSpinBeatIdx) return;
      // Slightly slower than the hero spin so each pin has a moment on stage.
      globe.nudge?.(0.14, -0.025);
      _pinSpinRAF = requestAnimationFrame(spin);
    };
    _pinSpinRAF = requestAnimationFrame(spin);
  }
  function stopPinSpin() {
    if (_pinSpinRAF != null) {
      cancelAnimationFrame(_pinSpinRAF);
      _pinSpinRAF = null;
      _pinSpinBeatIdx = -1;
    }
  }

  // ── Interactive-step engine ─────────────────────────────────────────
  // Beats may carry a `steps: [...]` array. Each step is a self-contained
  // mini-lesson: it sets up some globe / DOM state via `setup(ctx)`, listens
  // for the user actually performing the affordance via `subscribe(ctx, advance)`,
  // and tears down on advance / skip via the cleanup functions returned from
  // both. Exactly one step is active at a time.
  let _stepIdx = -1;
  let _stepCleanup = null;
  let _stepUnsubscribe = null;
  let _advanceLocked = false;

  // List of show-chrome classes the step engine knows about. Per step,
  // we only add the ones in the step's `showChrome: [...]` whitelist; the
  // base CSS hides everything in this list by default during step mode.
  const STEP_CHROME_CLASSES = [
    'tour-step-show-nav',
    'tour-step-show-pins',
    'tour-step-show-space',
    'tour-step-show-time',
    'tour-step-show-cards',
  ];
  // Pulse classes are managed separately because they're per-step rather
  // than per-affordance: each interactive step pulses exactly one
  // element (a specific bar segment, the P2 pin, the ⏱ chip, etc.) via
  // a body class wired in CSS as `body.<pulseClass>:not(.tour-step-done) <selector>`.
  let _activePulseClass = null;
  function clearStepChromeClasses() {
    STEP_CHROME_CLASSES.forEach(c => document.body.classList.remove(c));
    if (_activePulseClass) {
      document.body.classList.remove(_activePulseClass);
      _activePulseClass = null;
    }
  }

  function endStep() {
    if (typeof _stepUnsubscribe === 'function') {
      try { _stepUnsubscribe(); } catch {}
      _stepUnsubscribe = null;
    }
    if (typeof _stepCleanup === 'function') {
      try { _stepCleanup(); } catch {}
      _stepCleanup = null;
    }
    _stepIdx = -1;
    _advanceLocked = false;
    clearStepChromeClasses();
    document.body.classList.remove('tour-step-mode');
    document.body.classList.remove('tour-step-done');
  }

  function applyStepChrome(showChrome, pulseClass) {
    clearStepChromeClasses();
    const list = Array.isArray(showChrome) ? showChrome : [];
    for (const key of list) {
      switch (key) {
        case 'nav':   document.body.classList.add('tour-step-show-nav'); break;
        case 'pins':  document.body.classList.add('tour-step-show-pins'); break;
        case 'space': document.body.classList.add('tour-step-show-space'); break;
        case 'time':  document.body.classList.add('tour-step-show-time'); break;
        case 'cards': document.body.classList.add('tour-step-show-cards'); break;
      }
    }
    if (typeof pulseClass === 'string' && pulseClass) {
      document.body.classList.add(pulseClass);
      _activePulseClass = pulseClass;
    }
  }

  function renderStep(beat, sIdx) {
    if (!beat?.steps?.[sIdx]) {
      // Past the last step → leave step mode and move to the next beat.
      endStep();
      next();
      return;
    }
    // Tear down whatever step state was active (own listeners, body classes).
    endStep();

    const step = beat.steps[sIdx];
    _stepIdx = sIdx;
    document.body.classList.add('tour-step-mode');
    applyStepChrome(step.showChrome, step.pulseClass);
    showOnly('card');

    const stepEl  = cardEl.querySelector('.tour-step');
    const eyEl    = cardEl.querySelector('.tour-eyebrow');
    const titEl   = cardEl.querySelector('.tour-title');
    const proEl   = cardEl.querySelector('.tour-prose');
    const quotesEl = cardEl.querySelector('.tour-quotes');

    if (stepEl)  stepEl.textContent = `Step ${sIdx + 1} of ${beat.steps.length}`;
    if (eyEl)    eyEl.textContent   = beat.eyebrow || '';
    if (titEl)   titEl.textContent  = step.heading || beat.title || '';
    if (proEl)   proEl.textContent  = step.body || '';
    if (quotesEl) {
      quotesEl.innerHTML = step.hint
        ? `<div class="tour-step-hint">${esc(step.hint)}</div>`
        : '';
    }

    btnPrev?.classList.toggle('hidden', idx <= 0 && sIdx === 0);
    if (btnNext) {
      btnNext.classList.remove('tour-btn-continue');
      const isLastStep = sIdx >= beat.steps.length - 1;
      btnNext.textContent = isLastStep ? 'Skip & continue \u2192' : 'Skip this step \u2192';
    }

    cardEl.classList.remove('tour-in');
    void cardEl.offsetWidth;
    cardEl.classList.add('tour-in');

    // Move focus off any tour-card button left over from the previous
    // step. Otherwise the user's next keypress (Space, t, arrow keys)
    // re-activates the focused button instead of reaching our listeners.
    try {
      const ae = document.activeElement;
      if (ae && ae !== document.body && cardEl?.contains(ae)) {
        ae.blur();
      }
    } catch {}

    const ctx = { globe, App, nav };
    try { _stepCleanup = step.setup ? step.setup(ctx) : null; } catch (e) {
      console.warn('tour step setup failed', e);
    }

    const advance = () => {
      if (_advanceLocked || _stepIdx !== sIdx) return;
      _advanceLocked = true;
      // Brief "got it" affirmation in the hint slot.
      if (quotesEl) {
        quotesEl.innerHTML = `<div class="tour-step-hint tour-step-hint-done">\u2713 Got it</div>`;
      }
      // Tear down listeners so a second click/keypress doesn't pile up.
      // Cleanup (panel close, body classes) waits for the actual step
      // transition so e.g. an interview card stays open while the user
      // is reading it.
      if (typeof _stepUnsubscribe === 'function') {
        try { _stepUnsubscribe(); } catch {}
        _stepUnsubscribe = null;
      }
      document.body.classList.add('tour-step-done');
      if (step.manualContinue) {
        // User must click "Continue" to actually move on. Promote the
        // "Skip this step" button into a primary "Continue" affordance.
        if (btnNext) {
          btnNext.textContent = 'Continue \u2192';
          btnNext.classList.add('tour-btn-continue');
        }
      } else {
        setTimeout(() => {
          if (!active || BEATS[idx] !== beat || _stepIdx !== sIdx) return;
          renderStep(beat, sIdx + 1);
        }, 700);
      }
    };
    try { _stepUnsubscribe = step.subscribe ? step.subscribe(ctx, advance) : null; }
    catch (e) { console.warn('tour step subscribe failed', e); }
  }

  function skipCurrentStep() {
    const beat = BEATS[idx];
    if (!beat?.steps || _stepIdx < 0) return false;
    const cur = _stepIdx;
    endStep();
    if (cur + 1 >= beat.steps.length) {
      next();
    } else {
      renderStep(beat, cur + 1);
    }
    return true;
  }

  function prevCurrentStep() {
    const beat = BEATS[idx];
    if (!beat?.steps || _stepIdx <= 0) return false;
    const cur = _stepIdx;
    endStep();
    renderStep(beat, cur - 1);
    return true;
  }

  // ── Panel visibility ────────────────────────────────────────────────
  function showOnly(which) {
    heroEl?.classList.toggle('hidden', which !== 'hero');
    cardEl?.classList.toggle('hidden', which !== 'card');
    outroEl?.classList.toggle('hidden', which !== 'outro');
  }

  // ── Render functions ────────────────────────────────────────────────
  function renderHero(beat) {
    showOnly('hero');
    document.body.classList.add('tour-at-hero');
    document.body.classList.add('tour-chrome-off');

    const heroEyebrowEl = heroEl?.querySelector('.tour-eyebrow');
    const heroHeadlineEl = heroEl?.querySelector('.tour-headline');
    const heroLedeEl = heroEl?.querySelector('.tour-lede');
    if (heroEyebrowEl) heroEyebrowEl.textContent = beat?.eyebrow || '';
    if (heroHeadlineEl) heroHeadlineEl.textContent = beat?.headline || '';
    if (heroLedeEl) heroLedeEl.textContent = beat?.lede || '';

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

    // Buttons — show Back on every card so users can return to hero.
    const isLastCard = (idx === BEATS.length - 2);
    btnPrev?.classList.toggle('hidden', idx <= 0);
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
      } else if (beat.kind === 'pin') {
        // Pan the globe to the interview pin and pulse it.
        const pin = (App.state?.interviewPins?.placements || []).find(p => p.id === beat.pinId);
        if (pin) {
          nav.focus({ cl: pin.cluster });
          setTimeout(() => {
            try { globe.rotateTo(pin.lat, pin.lon, 1.4); } catch {}
            pulseElement(`.pin-label[data-id="${beat.pinId}"]`);
          }, 220);
        }
      }
    } catch (e) {
      console.warn('tour: performBeat failed', e);
    }
  }

  // ── Master render ───────────────────────────────────────────────────
  function render() {
    const beat = BEATS[idx];
    if (!beat) return;

    // Tear down per-beat ephemeral state from the previous beat before
    // applying the new one (spotlight, secondary spin, step listeners).
    if (!beat.showInterviewPins) {
      applyPinSpotlight(false);
      stopPinSpin();
    }
    endStep();

    // Chrome visibility: hide sidebar / focus cards / timeline on
    // non-drill beats (hero, interstitial, pin spotlight, outro).
    // Beats with interactive `steps` need the chrome visible because the
    // user is being asked to actually interact with it.
    const chromeOff = !beat.steps && (beat.kind === 'hero'
      || beat.kind === 'interstitial'
      || beat.kind === 'pin'
      || beat.kind === 'outro');
    document.body.classList.toggle('tour-chrome-off', chromeOff);

    if (beat.kind === 'hero') {
      renderHero(beat);
    } else if (beat.kind === 'outro') {
      renderOutro(beat);
      try { globe.rotateTo(15, -25, 3.0); } catch {}
    } else if (beat.steps && beat.steps.length > 0) {
      // Stop any hero spin and dive straight into the first step.
      stopHeroSpin();
      document.body.classList.remove('tour-at-hero');
      renderStep(beat, 0);
    } else {
      // Start the globe action a beat ahead so the sphere is already settling
      // when the narration card slides in.
      performBeat(beat);
      if (beat.showInterviewPins) {
        // Rotate to a wider, slightly tilted view so pins read clearly across
        // the visible hemisphere, then spotlight + spin.
        try { globe.rotateTo(20, -30, 2.6); } catch {}
        applyPinSpotlight(true);
        startPinSpin();
      }
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
    // Inline bootstrap in index.html can show the overlay before `start()`
    // sets `active`; Esc must still dismiss. Also allow idempotent close.
    const overlayVisible = overlay && !overlay.classList.contains('hidden');
    if (!active && !overlayVisible) return;
    active = false;
    stopHeroSpin();
    stopPinSpin();
    applyPinSpotlight(false);
    endStep();
    overlay.classList.add('hidden');
    document.body.classList.remove('tour-at-hero');
    document.body.classList.remove('tour-chrome-off');
    document.body.classList.remove('tour-morphing');
    document.body.classList.remove('tour-active');
    document.body.classList.remove('tour-step-mode');
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
    if (idx <= 0) return;
    idx -= 1;
    render();
  }

  // ── Wire buttons ────────────────────────────────────────────────────
  // Inside an interactive beat, "Next" skips the current step (or rolls
  // over to the next beat once all steps are done); "Back" steps within
  // the beat first, then rolls back into the previous beat. Outside step
  // mode they keep their original beat-level semantics.
  btnBegin?.addEventListener('click', () => next());
  btnNext?.addEventListener('click', () => {
    if (skipCurrentStep()) return;
    next();
  });
  btnPrev?.addEventListener('click', () => {
    if (prevCurrentStep()) return;
    prev();
  });
  btnSkip?.addEventListener('click', close);
  skipHero?.addEventListener('click', close);
  btnExplore?.addEventListener('click', close);

  // ── Keyboard ────────────────────────────────────────────────────────
  // Escape during the tour: closing the tour itself requires the explicit
  // Skip button (a no-op for Esc). But Esc should still close any
  // inspector card the user opened during a step (e.g. interview card
  // from a P-pin click) — otherwise they'd be stuck reading until they
  // hunt for the ×. We handle that here directly so the tour-level Esc
  // swallow doesn't have to defer to the global nav-side handler.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const overlayVisible = !overlay.classList.contains('hidden');
    if (!active && !overlayVisible) return;
    const cards = ['interview-card', 'detail-card', 'position-card']
      .map(id => document.getElementById(id))
      .filter(c => c && !c.classList.contains('hidden'));
    if (cards.length > 0) {
      cards.forEach(c => c.classList.add('hidden'));
      // If a P-pin was selected on the globe overlay, drop the selection
      // visual too so it doesn't pulse alone.
      document.querySelectorAll('.pin.selected').forEach(el => el.classList.remove('selected'));
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // No card open → Esc is a true no-op while the tour is up.
    e.preventDefault();
    e.stopPropagation();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.key === 'ArrowRight') {
      if (skipCurrentStep()) { e.preventDefault(); return; }
      next();
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      if (prevCurrentStep()) { e.preventDefault(); return; }
      prev();
      e.preventDefault();
    }
  });

  return { start, close, isActive: () => active || !overlay.classList.contains('hidden') };
}

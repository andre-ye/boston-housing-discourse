// Guided tour — three-part exploration:
//
//   PART 1 — Bottom-up.  We spotlight three real points (two in the
//            same cluster, one in a neighboring cluster), explain
//            what proximity means, and have the user click each to
//            compare. Then they meet an interview pin and learn the
//            "5 random voices" action (R key / chip click).
//
//   PART 2 — Top-down.   Drill cluster → subtopic → point-of-view
//            (Gentrification → Rent Stabilization → Shortage &
//            Disincentive). Inside the filtered subset, the user
//            pins a real post and we introduce CONNECTIONS MODE
//            (the persistent thread-arc view, toggled with C).
//
//   PART 3 — Search & time.  Type "covid" to see
//            chronologically anchored discourse paint across the
//            sphere; open the timeline scrubber.
//
// Version 303.

// (data.js helpers not needed — nav.focus() handles routing & camera)
import { raf } from './core/raf.js';

// ─── Demo-point picker ─────────────────────────────────────────────────────
// Part 1 needs three live points: two in the same cluster (semantically
// similar, spatially close on the sphere) and one in a different cluster
// that's still spatially nearby. We compute this at runtime so it adapts
// to whatever data load is in play. Deterministic order so re-running
// the tour shows the same trio.
function pickThreeDemoPoints(state) {
  if (!state?.coords || !state?.cluster || !state?.N) return null;
  const N = state.N;
  const coords = state.coords;
  const cluster = state.cluster;
  // Sample a few thousand points deterministically, then search within
  // that pool. The first version scanned the whole 422k corpus hundreds
  // of times and also picked dots that were *too* close on screen. This
  // version prefers a readable little triangle:
  //   1 + 2: same cluster, close but separated enough to click
  //   3:     different cluster, still nearby but visibly distinct
  const stride = Math.max(1, Math.floor(N / 3200));
  const pool = [];
  for (let i = 997 % stride; i < N; i += stride) {
    if (cluster[i] == null) continue;
    pool.push(i);
  }
  if (pool.length < 3) return null;
  const dist = (a, b) => {
    const latA = coords[2 * a], lonA = coords[2 * a + 1];
    const latB = coords[2 * b], lonB = coords[2 * b + 1];
    const sLat = Math.sin((latB - latA) * 0.5);
    const sLon = Math.sin((lonB - lonA) * 0.5);
    const h = sLat * sLat + Math.cos(latA) * Math.cos(latB) * sLon * sLon;
    return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  const seedLimit = Math.min(pool.length, 180);
  for (let attempt = 0; attempt < seedLimit; attempt++) {
    const seed = pool[(attempt * 37 + 11) % pool.length];
    const cl0 = cluster[seed];
    if (cl0 == null) continue;
    let sameBest = null, diffBest = null;
    for (const i of pool) {
      if (i === seed) continue;
      const cl = cluster[i];
      if (cl == null) continue;
      const d = dist(seed, i);
      if (cl === cl0) {
        // 2–7°: close enough to read as related, not so close the
        // numbered markers sit on top of each other.
        if (d >= 0.035 && d <= 0.12 && (!sameBest || d < sameBest.d)) sameBest = { i, d, cl };
      } else {
        // 5–12°: nearby enough to share the same view, but distinctly
        // separated from the same-cluster pair.
        if (d >= 0.085 && d <= 0.20 && (!diffBest || d < diffBest.d)) diffBest = { i, d, cl };
      }
    }
    if (sameBest && diffBest) {
      return [
        { idx: seed,        cluster: cl0,        role: 'A1' },
        { idx: sameBest.i,  cluster: cl0,        role: 'A2' },
        { idx: diffBest.i,  cluster: diffBest.cl, role: 'B'  },
      ];
    }
  }
  return null;
}

function rotateToPointSet(globe, state, idxSet, distance = 1.22) {
  if (!state?.coords || !idxSet || idxSet.size === 0) return false;
  const picks = [...idxSet].slice(0, 180)
    .filter(idx => Number.isFinite(state.coords[2 * idx]) && Number.isFinite(state.coords[2 * idx + 1]));
  if (!picks.length) return false;
  const dist = (a, b) => {
    const latA = state.coords[2 * a], lonA = state.coords[2 * a + 1];
    const latB = state.coords[2 * b], lonB = state.coords[2 * b + 1];
    const sLat = Math.sin((latB - latA) * 0.5);
    const sLon = Math.sin((lonB - lonA) * 0.5);
    const h = sLat * sLat + Math.cos(latA) * Math.cos(latB) * sLon * sLon;
    return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  // Rotate to the densest sampled pocket, not the global centroid. Search
  // terms like "covid" appear across many topics; a global average can land
  // between clusters and look like nothing happened.
  let best = picks[0], bestScore = -1;
  for (const a of picks) {
    let score = 0;
    for (const b of picks) {
      if (dist(a, b) <= 0.18) score++;
    }
    if (score > bestScore) { best = a; bestScore = score; }
  }
  try { globe.rotateTo(state.coords[2 * best], state.coords[2 * best + 1], distance); return true; } catch {}
  return false;
}

// ─── Spotlight markers ─────────────────────────────────────────────────────
// Three.js doesn't emit per-frame events we can hook for screen-space DOM
// markers, so we run our own RAF loop and project lat/lon to the canvas
// every frame. Cheap (3 points) and self-cancelling on teardown.
function attachSpotlightMarkers(globe, points) {
  const markers = points.map((p, i) => {
    const el = document.createElement('div');
    el.className = 'tour-spotlight-pulse';
    el.dataset.tag = p.tag != null ? String(p.tag) : String(i + 1);
    el.style.position = 'fixed';
    document.body.appendChild(el);
    return { ...p, el, _consumed: false };
  });
  let raf = 0;
  const tick = () => {
    const rect = globe.canvas.getBoundingClientRect();
    const camPos = globe.camera.position;
    for (const m of markers) {
      const wp = globe.worldPositionOf(m.lat, m.lon, 1.012);
      const facing = wp.x*(camPos.x-wp.x) + wp.y*(camPos.y-wp.y) + wp.z*(camPos.z-wp.z);
      if (facing <= 0.02) { m.el.style.opacity = '0'; continue; }
      const proj = wp.clone().project(globe.camera);
      if (proj.z > 1) { m.el.style.opacity = '0'; continue; }
      const x = rect.left + (proj.x * 0.5 + 0.5) * rect.width;
      const y = rect.top + (-proj.y * 0.5 + 0.5) * rect.height;
      m.el.style.opacity = '1';
      m.el.style.left = `${x}px`;
      m.el.style.top = `${y}px`;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return {
    consume(idx) {
      const m = markers.find(mm => mm.idx === idx);
      if (m && !m._consumed) {
        m._consumed = true;
        m.el.classList.add('consumed');
      }
    },
    has(idx) { return markers.some(mm => mm.idx === idx); },
    teardown() {
      cancelAnimationFrame(raf);
      for (const m of markers) m.el.remove();
    },
  };
}

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
    headline: 'The Boston Social Sphere\nDiscourse of Reddit',
    lede:
      'Over 400,000 Reddit posts and comments about housing, transit, and city life in Boston from 2015\u20132025, grouped by topics and points of view',
  },

  // ── Methodology part 1 — interview pins spotlight ───────────────────
  {
    kind: 'interstitial',
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
    title: 'We then gathered 422k+ voices on Reddit',
    prose:
      'To see how the conversations we had matched up with what was being said online, we scraped 422,000+ Reddit posts and comments from 2015 to ' +
      '2025 \u2014 housing, transit, city life. Then we laid them out so neighboring ' +
      'dots (posts or comments) sit near threads on related topics.',
  },

  // ── Why a sphere? — geometric framing ────────────────────────────────
  {
    kind: 'interstitial',
    title: 'Why a sphere?',
    prose:
      'There is no center or edges so no discourse is cornered to a particular realm. A sphere also links related threads in space so browsing feels more serendipitous.',
  },

  // ════════════════════════════════════════════════════════════════════
  //   PART 1 — BOTTOM-UP EXPLORATION
  // ════════════════════════════════════════════════════════════════════

  // Part 1, Step 1: spotlight 3 dots, ask the user to click each.
  {
    kind: 'interstitial',
    title: 'Click each glowing dot',
    resetTourState: true,
    prose:
      'We picked three dots near each other on the sphere. Two are in the same topical neighborhood \u2014 you should hear them echo each other. The third sits right next to them but belongs to a different conversation entirely. Click each one, read the post, then come back.',
    steps: [
      {
        heading: 'Compare three voices',
        body: 'Click each of the three glowing markers (1, 2, 3). Two should sound like they belong to the same thread; one should feel like it\u2019s about a different question. The detail card on the right shows you the actual post text.',
        hint: 'Click each glowing marker \u2014 1, 2, 3',
        showChrome: ['cards'],
        pulseClass: 'tour-pulse-spotlight',
        manualContinue: true,
        setup: (ctx) => {
          const { globe, App } = ctx;
          const picks = pickThreeDemoPoints(App.state);
          if (!picks) {
            // Fallback: rotate to a generic interesting region.
            try { globe.rotateTo(0.2, 1.5, 1.6); } catch {}
            return () => {};
          }
          // Spotlight only the three; everything else fades.
          const idxSet = new Set(picks.map(p => p.idx));
          try { globe.setSpotlight(idxSet); } catch {}
          document.body.classList.add('tour-pin-spotlight');
          // Rotate to the centroid (average of the three coordinates).
          const lat = (App.state.coords[2*picks[0].idx]
                     + App.state.coords[2*picks[1].idx]
                     + App.state.coords[2*picks[2].idx]) / 3;
          const lon = (App.state.coords[2*picks[0].idx + 1]
                     + App.state.coords[2*picks[1].idx + 1]
                     + App.state.coords[2*picks[2].idx + 1]) / 3;
          try { globe.rotateTo(lat, lon, 1.12); } catch {}
          // Floating numbered markers above each dot.
          const markers = attachSpotlightMarkers(globe, picks.map((p, i) => ({
            idx: p.idx,
            lat: App.state.coords[2 * p.idx],
            lon: App.state.coords[2 * p.idx + 1],
            tag: String(i + 1),
          })));
          // Park state on ctx so subscribe can read it.
          ctx._part1Picks = picks;
          ctx._part1Markers = markers;
          ctx._part1Clicked = new Set();
          return () => {
            try { globe.setSpotlight(null); } catch {}
            document.body.classList.remove('tour-pin-spotlight');
            markers.teardown();
            document.getElementById('detail-card')?.classList.add('hidden');
          };
        },
        subscribe: (ctx, advance) => {
          const { globe } = ctx;
          const valid = new Set((ctx._part1Picks || []).map(p => p.idx));
          const onClick = (ev) => {
            const i = ev?.detail?.idx;
            if (i == null || !valid.has(i)) return;
            ctx._part1Clicked.add(i);
            ctx._part1Markers?.consume?.(i);
            if (ctx._part1Clicked.size >= 3) advance();
          };
          globe.addEventListener('pointclick', onClick);
          return () => globe.removeEventListener('pointclick', onClick);
        },
      },
    ],
  },

  // Part 1, Step 2: meet an interview pin (P2) — qualitative voice.
  {
    kind: 'interstitial',
    title: 'Click P2 \u2014 a ferry commuter',
    prose:
      'Eighteen of the twenty-six people we interviewed are pinned next to topics they discussed. P2 talked about a multimodal commute and a calm ferry leg \u2014 they\u2019re anchored where transit voices cluster. Click P2 to read what they said.',
    steps: [
      {
        heading: 'Click the P2 pin',
        body: 'Find the floating P2 pin (it\u2019s pulsing) and click it. A panel pops up with their paraphrased quotes \u2014 their words, not Reddit\u2019s. When you\u2019re done reading, hit Continue.',
        hint: 'Click the glowing P2 pin \u2192',
        showChrome: ['pins', 'cards'],
        pulseClass: 'tour-pulse-pin-P2',
        manualContinue: true,
        setup: ({ globe, App }) => {
          const placements = App?.state?.interviewPins?.placements || [];
          const p2 = placements.find(p => p.id === 'P2');
          const idxSet = new Set(
            placements.filter(p => p.id === 'P2')
              .map(p => p.idx).filter(i => Number.isFinite(i))
          );
          try { if (idxSet.size > 0) globe.setSpotlight(idxSet); } catch {}
          document.body.classList.add('tour-pin-spotlight');
          if (p2) { try { globe.rotateTo(p2.lat, p2.lon, 1.9); } catch {} }
          else    { try { globe.rotateTo(20, -30, 2.4); } catch {} }
          return () => {
            try { globe.setSpotlight(null); } catch {}
            document.body.classList.remove('tour-pin-spotlight');
            document.getElementById('interview-card')?.classList.add('hidden');
            document.getElementById('detail-card')?.classList.add('hidden');
          };
        },
        subscribe: ({ globe }, advance) => {
          const onPinClick = (ev) => {
            if (ev?.detail?.pin?.id === 'P2') advance();
          };
          globe.addEventListener('pinclick', onPinClick);
          return () => globe.removeEventListener('pinclick', onPinClick);
        },
      },
    ],
  },

  // Part 1, Step 3: random-five action.
  {
    kind: 'interstitial',
    title: 'Sample five voices at once',
    prose:
      'When you want a quick read on what the sphere actually contains, sample five random voices from whatever\u2019s currently visible. Press R or tap the R chip in the bottom toolbar (\u201cR · C · Reset\u201d row). Esc dismisses floating captions; Reset clears drill, filters, timeline, zoom.',
    steps: [
      {
        heading: 'Press R (or click the R chip)',
        body: 'Hit R or tap the glowing R chip in the bottom toolbar. Five excerpts sprout beside the sphere. Esc closes those captions first; Reset is the full rewind (pinned card, drill, filters, timeline, zoom).',
        hint: 'Press R or click below \u2022 Esc dismisses cards',
        showChrome: ['random'],
        pulseClass: 'tour-pulse-random',
        manualContinue: true,
        setup: ({ App }) => {
          // Reset any leftover view state and rotate to a wide framing
          // so the sprouts have room to spread out.
          try { App?.clearSprouts?.({ immediate: true }); } catch {}
          try {
            const ae = document.activeElement;
            if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
          } catch {}
          // Animated retract on step exit so sprouts visibly "pull back in"
          // when the user goes Back / Continues. The 240 ms fade matches the
          // sproutClear non-immediate path (CSS .show transition).
          return () => { try { App?.clearSprouts?.({ immediate: false }); } catch {} };
        },
        subscribe: ({ App }, advance) => {
          let fired = false;
          // After the user has triggered the action, give them ~2.5 s to
          // read the five sprouts, then auto-retract them so the floating
          // cards don't linger beside the "Continue" button. The cleanup
          // path (Continue / Back) clears them too, but most users want
          // a hands-off collapse once they've completed the step.
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
            advance();
            startCollapseTimer();
          };
          const chip = document.getElementById('random-hint');
          const onChipClick = () => {
            try { App?.sampleFiveRandom?.(); } catch {}
            trigger();
          };
          // sampleFiveRandom is handled by main.js on R; we only advance once
          // per step (bubble runs after main's listener on the same keydown).
          const onKeyDown = (e) => {
            if (e.repeat) return;
            if (e.key !== 'r' && e.key !== 'R') return;
            trigger();
          };
          chip?.addEventListener('click', onChipClick);
          window.addEventListener('keydown', onKeyDown, false);
          return () => {
            chip?.removeEventListener('click', onChipClick);
            window.removeEventListener('keydown', onKeyDown, false);
            if (collapseTimer != null) {
              clearTimeout(collapseTimer);
              collapseTimer = null;
            }
          };
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════════
  //   PART 2 — TOP-DOWN EXPLORATION (Rent Control drill)
  // ════════════════════════════════════════════════════════════════════

  {
    kind: 'interstitial',
    title: 'Pick a topic and drill in',
    resetTourState: true,
    keepChrome: true,
    prose:
      'You can also start from a topic and narrow down. The left rail is sorted by how loud each topic is. Topic 32 \u2014 \u201cGentrification & Rent Control\u201d \u2014 is the loudest fault line in Boston housing. Let\u2019s drill in.',
  },

  {
    kind: 'interstitial',
    title: 'Click \u201cGentrification & Rent Control\u201d',
    prose:
      'The left rail stacks every topic in the corpus. Click the highlighted topic to zoom in.',
    steps: [
      {
        heading: 'Click \u201cGentrification & Rent Control\u201d',
        body: 'Find \u201cGentrification & Rent Control\u201d near the top of the left rail and click it. The globe rotates the topic into view.',
        hint: '\u2190 Click \u201cGentrification & Rent Control\u201d',
        showChrome: ['nav'],
        pulseClass: 'tour-pulse-l1-32',
        manualContinue: true,
        setup: ({ globe, nav }) => {
          try { globe.setPinnedPoint(-1); } catch {}
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
    title: 'Rent control, zoning, and housing supply',
    prose:
      'Topic 32 \u2014 \u201cGentrification & Rent Control\u201d \u2014 holds a decade of argument ' +
      'about what Boston\u2019s housing crisis actually is. Neighboring dots are posts or comments on the same fault line.',
    pullquotes: [
      'Market supply can\u2019t match demand here.',
      'Rent control is good for incumbents and bad for newcomers.',
      'It\u2019s the zoning that made this mess.',
    ],
  },

  {
    kind: 'interstitial',
    title: 'Click \u201cRent Stabilization Ideas\u201d',
    prose:
      'The middle column splits the topic into subtopics. The biggest one inside Gentrification is \u201cRent Stabilization Ideas\u201d \u2014 the actual rent-control argument. Click it.',
    steps: [
      {
        heading: 'Click \u201cRent Stabilization Ideas\u201d',
        body: 'In the middle (subtopic) column, find \u201cRent Stabilization Ideas\u201d near the top and click it. The globe will zoom into that subtopic\u2019s pocket of points.',
        hint: '\u2190 Click \u201cRent Stabilization Ideas\u201d',
        showChrome: ['nav'],
        pulseClass: 'tour-pulse-l2-32_4',
        manualContinue: true,
        setup: ({ nav }) => {
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
    title: 'The rent control fault line',
    prose:
      'You\u2019re now inside \u201cRent Stabilization Ideas.\u201d Each point is a post or comment taking a side: for rent control, against it, or threading some nuanced middle path. Hover one to read the thread.',
    pullquotes: [
      'Rent control is good for incumbents and bad for newcomers.',
      'You need both stabilization and new construction.',
    ],
  },

  {
    kind: 'interstitial',
    title: 'Click \u201cShortage & Disincentive\u201d',
    prose:
      'The right column lists points of view inside this subtopic \u2014 actual stances people take. The largest one, \u201cShortage & Disincentive,\u201d argues rent control shrinks supply. Click it.',
    steps: [
      {
        heading: 'Click \u201cShortage & Disincentive\u201d',
        body: 'In the right column, click \u201cShortage & Disincentive\u201d \u2014 756 posts argue this stance. The globe spotlights every post tagged with that exact argument.',
        hint: '\u2190 Click \u201cShortage & Disincentive\u201d',
        showChrome: ['nav'],
        pulseClass: 'tour-pulse-l3-131_2',
        manualContinue: true,
        setup: ({ nav }) => {
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
  // Part 2, Step pin-a-post: with the subset filtered, click any dot.
  {
    kind: 'interstitial',
    title: 'Pin one of the highlighted posts',
    prose:
      'Now that you\u2019ve narrowed to a single stance, every glowing dot is a post making this exact argument. Click any one to pin it \u2014 a panel on the right shows the full text.',
    steps: [
      {
        heading: 'Click any glowing dot',
        body: 'Pick a glowing dot \u2014 each is one rent-control post arguing the supply position. Click it; the detail card pops up with the post body and a link to the original Reddit thread.',
        hint: 'Click any glowing dot \u2192',
        showChrome: ['nav', 'cards'],
        manualContinue: true,
        setup: ({ App }) => {
          try { App?.clearPinnedPoint?.(); } catch {}
          ['focus-card', 'interview-card', 'detail-card']
            .forEach(id => document.getElementById(id)?.classList.add('hidden'));
          return () => {};
        },
        subscribe: ({ globe }, advance) => {
          const onClick = (ev) => {
            if (ev?.detail?.idx >= 0) advance();
          };
          globe.addEventListener('pointclick', onClick);
          return () => globe.removeEventListener('pointclick', onClick);
        },
      },
    ],
  },

  // Part 2, Step connections-mode: introduce thread-arc view.
  {
    kind: 'interstitial',
    title: 'Look at this post in its thread',
    prose:
      'The pinned post is only one node in a Reddit thread. The panel already has a thread-context map: the center is the pinned post, and the satellites are replies or siblings in the same conversation. Connections draws those same relationships on the globe.',
    steps: [
      {
        heading: 'Show this pinned post\u2019s connections',
        body: 'First look at the Thread context section in the pinned-post panel: that little map is this post and its thread neighbors. Now click the bottom \u201cconnections\u201d chip to draw those same relationships as arcs from this exact pinned node on the globe.',
        hint: 'Look at Thread context, then click \u201cconnections\u201d below',
        showChrome: ['nav', 'shift', 'cards'],
        pulseClass: 'tour-pulse-shift',
        manualContinue: true,
        setup: ({ App }) => {
          // Draw attention to the panel's fisheye context first. The chip
          // then becomes the globe-level view of the same selected node.
          setTimeout(() => { try { App?.emphasizeDetailContextForConnections?.(); } catch {} }, 450);
          return () => {};
        },
        subscribe: ({ App }, advance) => {
          let fired = false;
          const trigger = () => {
            if (fired) return;
            fired = true;
            setTimeout(() => { try { App?.emphasizeDetailContextForConnections?.(); } catch {} }, 250);
            advance();
          };
          const chip = document.getElementById('shift-hint');
          const onClick = () => trigger();
          const onKeyDown = (e) => {
            if (e.repeat) return;
            if ((e.key || '').toLowerCase() !== 'c') return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            trigger();
          };
          chip?.addEventListener('click', onClick);
          window.addEventListener('keydown', onKeyDown, true);
          return () => {
            chip?.removeEventListener('click', onClick);
            window.removeEventListener('keydown', onKeyDown, true);
          };
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════════
  //   PART 3 — SEARCH & TIMELINE
  // ════════════════════════════════════════════════════════════════════

  {
    kind: 'interstitial',
    title: 'Search for a chronological phrase',
    resetTourState: true,
    prose:
      'Some conversations on the sphere have a clear shape in time. Covid is a clean example: almost nothing before 2020, then a city-wide argument about housing, commutes, work, schools, nightlife, and risk. Search for it.',
    steps: [
      {
        heading: 'Search \u201cCovid\u201d',
        body: 'Click the search bar in the top-left and type \u201cCovid\u201d. Matching posts paint across the globe, non-matching posts dim, and the camera will move to the matching region so you can actually see the results.',
        hint: '\u2196 Type into the search bar',
        showChrome: ['nav'],
        pulseClass: 'tour-pulse-search',
        manualContinue: true,
        setup: ({ App, nav }) => {
          // Drop the rent-control filter so the search runs across the
          // whole corpus.
          try { App?.clearConnectionsMode?.(); } catch {}
          try { App?.clearPinnedPoint?.(); } catch {}
          try { nav.focus({}); } catch {}
          requestAnimationFrame(() => {
            try {
              const input = document.getElementById('search-input');
              input?.focus();
            } catch {}
          });
          return () => {};
        },
        subscribe: ({ App, globe }, advance) => {
          const input = document.getElementById('search-input');
          if (!input) { advance(); return () => {}; }
          let ran = false;
          const onInput = async () => {
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
            advance();
          };
          input.addEventListener('input', onInput);
          return () => input.removeEventListener('input', onInput);
        },
      },
    ],
  },

  {
    kind: 'interstitial',
    title: 'Open the timeline',
    prose:
      'Covid has an unmistakable chronology: almost no mentions before 2020, then a sharp change in what Boston talks about. Open the timeline scrubber and move the handles around 2020 to see that shift.',
    steps: [
      {
        heading: 'Click the \u23f1 button',
        body: 'Find the \u23f1 clock button in the bottom-right of the globe (it\u2019s pulsing) and click it. Drag the handles of the timeline scrubber to filter posts to a specific date range.',
        hint: 'Click the \u23f1 button \u2198',
        showChrome: ['time'],
        pulseClass: 'tour-pulse-time',
        manualContinue: true,
        setup: () => {
          return () => {};
        },
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

  // ── Outro ────────────────────────────────────────────────────────────
  {
    kind: 'outro',
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
  let _heroSpinDispose = null;

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

  function resetTourState({ full = false } = {}) {
    try { App?.clearConnectionsMode?.(); } catch {}
    try { App?.clearSprouts?.({ immediate: true }); } catch {}
    try { App?.clearPinnedPoint?.(); } catch {}
    try { globe.setSpotlight?.(null); } catch {}
    document.body.classList.remove('tour-pin-spotlight');
    ['detail-card', 'interview-card', 'focus-card']
      .forEach(id => document.getElementById(id)?.classList.add('hidden'));
    try {
      const input = document.getElementById('search-input');
      if (input && input.value) {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.blur();
      }
    } catch {}
    try { document.getElementById('spotlight-chip')?.remove(); } catch {}
    if (full) {
      try { App?._timelineResetAndClose?.(); } catch {}
      try { nav.focus({}); } catch {}
      try { globe.rotateTo(15, -25, 3.0); } catch {}
    }
  }

  // ── Hero spin ───────────────────────────────────────────────────────
  // We spin the real globe slowly while the hero is displayed, so the right
  // half of the split screen shows a live, gently rotating globe.
  function startHeroSpin() {
    stopHeroSpin();
    const step = () => {
      if (!active || idx !== 0) {
        if (_heroSpinDispose) { _heroSpinDispose(); _heroSpinDispose = null; }
        return;
      }
      globe.nudge?.(0.22, -0.06);
    };
    _heroSpinDispose = raf.add('tour:hero-spin', step);
  }

  function stopHeroSpin() {
    if (_heroSpinDispose) {
      _heroSpinDispose();
      _heroSpinDispose = null;
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
    'tour-step-show-random',
    'tour-step-show-shift',
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
        case 'nav':    document.body.classList.add('tour-step-show-nav'); break;
        case 'pins':   document.body.classList.add('tour-step-show-pins'); break;
        case 'random': document.body.classList.add('tour-step-show-random'); break;
        case 'shift':  document.body.classList.add('tour-step-show-shift'); break;
        case 'time':   document.body.classList.add('tour-step-show-time'); break;
        case 'cards':  document.body.classList.add('tour-step-show-cards'); break;
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
    const titEl   = cardEl.querySelector('.tour-title');
    const proEl   = cardEl.querySelector('.tour-prose');
    const quotesEl = cardEl.querySelector('.tour-quotes');

    if (stepEl)  stepEl.textContent = beat.steps.length > 1
      ? `Step ${sIdx + 1} of ${beat.steps.length}`
      : '';
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

    const heroHeadlineEl = heroEl?.querySelector('.tour-headline');
    const heroLedeEl = heroEl?.querySelector('.tour-lede');
    if (heroHeadlineEl) {
      const raw = beat?.headline || '';
      heroHeadlineEl.innerHTML = raw
        ? raw.split('\n').map((line) => esc(line.trim())).join('<br>')
        : '';
    }
    if (heroLedeEl) heroLedeEl.textContent = beat?.lede || '';

    globe.rotateTo(15, -25, 3.0);
    startHeroSpin();
  }

  function renderCard(beat) {
    stopHeroSpin();
    document.body.classList.remove('tour-at-hero');
    showOnly('card');

    const stepEl  = cardEl.querySelector('.tour-step');
    const titEl   = cardEl.querySelector('.tour-title');
    const proEl   = cardEl.querySelector('.tour-prose');
    const quotesEl = cardEl.querySelector('.tour-quotes');

    if (stepEl)   stepEl.textContent = beat.step || '';
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

    const titEl = outroEl?.querySelector('.tour-title');
    const proEl = outroEl?.querySelector('.tour-prose');
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
        // The user just clicked this pin in the previous step, so the
        // camera is already framed on it. Skip nav.focus entirely —
        // changing focus to the pin's cluster fires a focus listener
        // that rotates the globe out to the cluster anchor and then
        // back, which feels flighty. Just hold the view and pulse the
        // pin label.
        const pin = (App.state?.interviewPins?.placements || []).find(p => p.id === beat.pinId);
        if (pin) {
          try { globe.rotateTo(pin.lat, pin.lon, 1.5); } catch {}
          pulseElement(`.pin[data-id="${beat.pinId}"]`);
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
    if (beat.resetTourState) resetTourState();

    // Chrome visibility: hide sidebar / focus cards / timeline on
    // non-drill beats (hero, interstitial, pin spotlight, outro).
    // Beats with interactive `steps` need the chrome visible because the
    // user is being asked to actually interact with it.
    const chromeOff = !beat.steps && !beat.keepChrome && (beat.kind === 'hero'
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
    resetTourState({ full: true });
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
    // Leave the user in a clean sandbox when they "go forth and explore".
    resetTourState({ full: true });
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
  // Escape during the tour: closing the tour itself requires Skip. Esc still
  // closes inspector cards and dismisses floating random sprout captions
  // (those are handled above; otherwise this listener traps Esc before it
  // reaches globel-level handlers registered later during boot).
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const overlayVisible = !overlay.classList.contains('hidden');
    if (!active && !overlayVisible) return;
    const cards = ['interview-card', 'detail-card']
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
    // Random sprout captions: global Esc handler sits *after* this listener,
    // so we must dismiss them here or Esc is swallowed below.
    try {
      const spr = document.getElementById('sprouts')
        ?.querySelector?.('.sprout, .sprout-anchor');
      if (spr && typeof App.clearSprouts === 'function') {
        App.clearSprouts({ immediate: true });
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    } catch (_) {}
    // No inspector cards / no sprout layer → Esc deliberately does nothing to
    // the tour itself while the overlay is active.
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
    } else if (e.key === 'Enter') {
      if (e.repeat) return;
      const ae = document.activeElement;
      const tag = ae?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Let real tour buttons handle their own Enter (avoids double next / back).
      const obId = ae?.closest?.('#tour-overlay') ? ae?.id : null;
      if (obId === 'tour-begin' || obId === 'tour-next' || obId === 'tour-prev'
          || obId === 'tour-skip-hero' || obId === 'tour-skip' || obId === 'tour-explore') {
        return;
      }
      if (skipCurrentStep()) { e.preventDefault(); return; }
      next();
      e.preventDefault();
    }
  });

  return { start, close, isActive: () => active || !overlay.classList.contains('hidden') };
}

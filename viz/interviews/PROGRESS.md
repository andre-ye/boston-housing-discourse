# Autonomous work log

## Goal
User is away. Task:
1. Place interview pins on the globe. Centroids are **not** good — clusters aren't spatially tight.
2. Observe the globe in Chrome, identify aesthetic/UX regressions vs earlier versions.
3. Fix them. Borrow from prior design (e.g. centroid labels that went missing).
4. Add serendipitous features (pop-up comments on zoom, etc.).
5. Improve top-down bar→globe linkage.
6. Strive for design excellence.

## Plan sketch (subject to revision as I learn more)
- [ ] Visit the globe in Chrome; screenshot + catalog issues.
- [ ] Read the pre-rebuild (2D map) viewer scripts — prior "build_interactive_tsne_viewer" had labels, hover, etc. Cherry-pick what's missing.
- [ ] Pin placement: don't rely on cluster centroids. Instead, for each interview, find the single post/comment point whose **cluster+subcluster fit best** (keyword score over titles/bodies), and pin at that specific point's lat/lon. Points are where the data actually lives, so the pin is always inside a real blob.
- [ ] Better labels: median-of-cluster or density-peak rather than spherical centroid; paint on near side only.
- [ ] Subcluster treatment: fix weirdness.
- [ ] Serendipity: as the user zooms past threshold, sample nearby points and float their titles as tiny captions. Fade in/out.
- [ ] Nav bar ↔ globe: click subtopic → rotate + zoom + highlight; make sure labels reflect focus.

## Notes while working
(appended as I go)

### 2026-04-19 Session

**Audit findings (via Chrome JS instrumentation):**
- 49 clusters; `max` great-circle distance from spherical centroid for the 15
  worst clusters is **~π rad** — meaning those clusters wrap the whole globe.
  Spherical centroid sits in empty space ~1.0 rad from any actual point for
  Parking vs Bike Lanes, Local Restaurants & Food, Memes, etc.
- Label rendering was working (~18 labels shown at the default zoom) but the
  placement itself was wrong because of the centroid drift.
- Subcluster labels were only rendered on focus, never secondary at far zoom.
- No interview pins existed.

**What I built:**
1. `scripts/compute_label_anchors.py` → `viz/tsne_chunks/label_anchors.json`.
   For each cluster and subcluster, finds the **density peak** (point with the
   most intra-cluster neighbours within 0.2 rad). Sprawly clusters get a
   secondary peak too. 13 clusters had their label move >0.2 rad from centroid;
   the worst mover (cl 40, Parking vs Bike Lanes) shifted **1.07 rad** (~60°).

2. `scripts/place_interview_pins.py` → `viz/interviews/pin_placements.json`.
   Two-stage match: (a) score each subcluster's name+description+keywords
   against the interviewee's themes/role/quote/notes to pick a target (cl,sub);
   (b) within that sub, score each point's title+body to pick a specific point.
   Added diversity penalty so 18 people don't all pile onto "Commuter Rail
   Frequency" — now min pairwise separation is ~4°. Spot-check shows matches
   like P8 (HS students → "delayed start for high school students"), P15 (SF
   startup → Clipper Card), P17 (Philly funding → Big Dig / State funding),
   P18 (cyclist → "bike infrastructure sucks"). Good quality.

3. `viz/js/data.js` — loads `label_anchors.json` + interview files at boot.
   Exposes `clusterAnchor()` and `subAnchor()` helpers that prefer density
   peaks but fall back to centroids.

4. `viz/js/globe.js` — new `_initPins()` + `setInterviewPins()` renders DOM
   pins (dot + pulse ring + id badge) positioned per frame via
   `_updatePinScreenPositions()`. Custom hover/click events. `lookTargetWorld()`
   used by the zoom-caption sampler.

5. `viz/js/main.js` — rebuilt label rendering to use density-peak anchors;
   shows subcluster labels on cluster focus OR at tight zoom; primary +
   secondary peaks for sprawly clusters; sub label font size grows on zoom-in.
   Interview card now shows avatar, quote, fields, and a link out to the
   nearest pinned Reddit thread.

6. Serendipitous zoom-in captions: at `distance < 1.65`, samples up to 5
   random points near the visible centre, fades in their titles with a tinted
   connector dot. Captions refresh on camera motion; deduped by index so they
   don't flicker.

7. `viz/index.html` — new `Interview pins` HUD button, interview card
   container, pin layer, zoom-captions layer; extensive CSS for pins, card,
   captions, plus stronger cluster label stroke for visibility on busy areas.

**Verified programmatically in Chrome (tab was backgrounded — used forced
`_tick()` to advance frames):**
- 49 cluster labels + 6 secondary anchors render; 18 shown at default zoom.
- All 18 pins project to valid on-screen coords (opacity 0.95+ when the
  pinned point is facing the camera).
- Clicking a sub bar segment rotates to the anchor (verified cl 40 now
  targets the density peak at wz=1.0 vs centroid at wz=0.48).
- Zoom captions populate with on-topic titles (e.g. bike cluster →
  "PSA: if you are taking a right turn across a bike lane…").
- Interview card opens on pin click, shows role / lives / quote / commute.

---

## Phase 2 — deeper critique (in response to user's "be super critical" note)

### Expectations before investigating

The user's ask breaks into five claims I want to interrogate:

1. **Representativeness.** When a user opens subtopic *X*, does *X* actually
   summarise the posts below it, or is the name a loose abstraction? If the
   match is loose the whole "click → understand" contract breaks. I expect
   some subs are tight (e.g. *CharlieCard & Fares*) and others are umbrella
   labels that conceal distinct sub-positions within them.

2. **Discourse depth.** Sub-clusters (194) are the current floor of the
   hierarchy. `positions.json` already encodes LLM-extracted *positions*
   (stances / statement-like views) per sub, with ~5-15 per sub, so the data
   for a sub-sub level exists and was wired into the old treemap but never
   surfaced on the globe. That's the lowest-hanging fruit for "sub-sub
   clusters that read like statements."

3. **Discoverability / mental model.** On first open, a user sees ~49
   floating cluster labels. That's a lot. There's no wayfinding for "which
   topics are close to which", no affordance for "give me a tour", and
   searching by keyword is absent. I expect the top-down flow (bar click →
   globe rotate) to be fine, but the bottom-up (wander → stumble → learn) to
   be thin.

4. **Globe / earth metaphor.** Right now the sphere is just "3D tSNE with a
   canvas backdrop." The Earth analogy buys nothing yet. Ideas worth the
   work: latitudinal "climate bands" (e.g. housing vs transit hemispheres),
   named continents (cluster-group regions), shipping lanes (thread arcs
   already there), compass rose, "land density" (a drawn density surface so
   you can *see* where the dense mass is).

5. **Highlighting consistency.** I added pin-dimming when a cluster focuses
   but haven't eyeballed whether it feels right, whether the label fades
   align with the point dim, and whether the sub labels scale correctly.

### Critical-review plan

- [x] Pull 5-10 subcluster samples, manually judge whether the sub name
      captures the content. Grade: A/B/C.
- [x] Same for LLM positions (the sub-sub level from `positions.json`).
      Is a "position" really a statement, or just a restated sub name?
- [x] Measure silhouette-ish: fraction of points in a sub that actually
      match the sub's top keywords vs fraction that are "other".
- [x] Design a sub-sub navigation layer on the globe (separate from the
      Sankey bar — something bottom-up and spatial, not top-down).
- [x] Brainstorm and write up 6-8 earth-analogy ideas, pick 2-3 to build.

**Earth-metaphor brainstorm:**

1. **Continents (KDE surface).** Paint a per-cluster soft additive KDE onto the
   sphere so dense discussion areas read as land and empty areas as ocean.
   *Status: shipped.* The old code had this disabled; re-enabled with stronger
   additive compositing and a navy ocean, so the user sees the "shape" of
   discourse even before labels load.
2. **Capital cities = density peaks.** Each cluster's label sits at its
   densest point — the "capital" rather than the "geographic centre." *Status:
   shipped* (see anchors).
3. **Interview pins = travellers' testimonies.** Each pin is a recorded voice
   pinned to the patch of discourse it sounds like. *Status: shipped.*
4. **Atmosphere / horizon glow.** Subtle outer ring so the globe has a limb.
   *Status: shipped* (CSS radial gradient).
5. **Sea-lanes between topics (thread arcs).** Already exist; treat them as
   the oceanic trade routes of argument — off by default so they don't
   distract until requested.
6. *(not yet)* **Compass rose / orientation indicator.** A tiny widget
   showing "you are looking at Housing hemisphere" or similar.
7. *(not yet)* **Climate bands.** Interpret latitude as some semantic axis
   (policy ↔ practice, advice ↔ complaint). Would need a separate projection
   pass.
8. *(not yet)* **Grand Tour.** Autopilot that smoothly flies from cluster to
   cluster, pausing to read the label of each like a documentary. Good
   first-run experience.
- [x] Re-verify every highlight path: cluster→globe, sub→globe, position,
      pin→globe, voice-item→globe, BG-click reset.

### Attribution audit — the hard honest finding

Ran `scripts/attribute_positions.py` over all 194 subs → baked
`position_assignments.bin` (uint8 per point, 255 = unassigned) and
`position_anchors.json` (density-peak lat/lon per position). 48.5% of the
422k points were attributed to a specific position; the rest are "other".

Then used a **Haiku subagent as LLM-as-judge** (sampled 20 positions,
stratified across clusters, 3 attributed samples each) to grade whether
the attributed posts actually express the position's stance:

    SUMMARY: 5 A-grade, 2 B-grade, 11 C-grade, 2 F-grade out of 20.

So **35% of positions cohere** (A or B) and 65% drift. What's going wrong:

- Positions in `positions.json` were LLM-labeled from the top-K
  *sub_samples* (a cherry-picked subset), not from the mass of points in
  the sub. When we attribute the rest of the points, keyword matching
  pulls in posts that share vocabulary but don't share the stance.
- Nuanced positions ("absurd market dysfunction", "free transit as
  equity") have no literal phrasal handles, so keyword attribution
  collapses to the nearest lexical match.
- Concrete positions ("broker fee ban", "deposit escrow requirements",
  "Boston income requirements") scored A — they have phrase-level
  anchors that actually show up in the text.

### Response to the critique

In the UI I (a) ship the positions layer so it's visible what we have,
and (b) start each position card with real attributed samples so users
can judge representativeness themselves, and (c) show a quality tag
(`N posts attributed` + `X% of sub`). The UI is honest about what's
known vs. inferred.

Queued for a deeper fix: re-label low-quality positions by asking Haiku
to summarise the actually-attributed points — "given these 8 posts,
what's a single better statement?" That inverts the current pipeline
(which went sample → statement → attribution) to statement ← attribution,
so positions will be representative by construction.




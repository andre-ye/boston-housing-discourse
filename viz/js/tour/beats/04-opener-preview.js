// 04-opener-preview — Opener page 3 of 3. What the tour will cover.

// 04-opener-preview — Opener page 3 of 3. Tour preview, with each topic
// name tinted to its actual cluster colour so the user starts associating
// the named arguments with the colours they'll see on the globe.

import { raf } from '../../core/raf.js';
import { OPENER_NUDGE_LON, OPENER_NUDGE_LAT, HERO_FRAMING } from '../../core/constants.js';
import { tourTopicTagColor } from '../../data.js';

// Cluster IDs for the three case studies the tour walks through. These
// match the beats that come after the opener — kept in one place here so
// the topic colours stay in sync with what the user actually sees.
const TOUR_TOPICS = {
  rent:   32,   // beat 5  — gentrification & rent control
  tenant:  8,   // beat 8  — tenant rights & landlords
  bike:    5,   // beat 12 — cycling & bike lanes
};

export const beat = {
  id: 'opener-preview',
  kind: 'opener',
  title: 'Let’s explore the globe',
  bodyHtml:
    '<p>We’ll guide you through three areas of discourse on the sphere, ' +
    'alongside a set of tools to navigate the globe yourself: discourse on ' +
    '<span class="topic-tag" data-cl="32">gentrification and rent control</span> ' +
    'with bottom-up tools, ' +
    '<span class="topic-tag" data-cl="8">landlord and tenant rights</span> ' +
    'with top-down tools, and ' +
    '<span class="topic-tag" data-cl="5">bike lanes</span> ' +
    'with more advanced features like search and time filtering.</p>' +
    '<p>After the tour, you should have the skills to explore the sphere ' +
    'yourself, and you’ll know a bit about what people are saying on these ' +
    'three topics!</p>',
  enter(ctx) {
    const { globe, App, direction } = ctx;
    if (direction === 'backward') {
      try { globe.rotateTo(15, -25, HERO_FRAMING); } catch {}
    }
    // Tint each topic span with its live cluster colour. Done in enter()
    // because the palette is reshuffled at boot for max perceptual
    // distinctness (see main.js #50) — we can't hardcode hexes.
    try {
      const root = document.querySelector('.tour-card .tour-prose');
      root?.querySelectorAll('.topic-tag[data-cl]').forEach((el) => {
        const cl = parseInt(el.dataset.cl, 10);
        if (Number.isInteger(cl)) el.style.color = tourTopicTagColor(cl);
      });
    } catch {}

    // Build the bright set (all points in the three case-study clusters).
    // Everything else falls into the dim layer so non-mentioned clusters
    // recede without disappearing entirely.
    const featuredCls = new Set(Object.values(TOUR_TOPICS));
    const state = App?.state;
    const cluster = state?.cluster;
    let bright = null, others = null;
    let blinkRaf = null;
    if (cluster) {
      bright = new Set();
      others = new Set();
      for (let i = 0; i < cluster.length; i++) {
        if (featuredCls.has(cluster[i])) bright.add(i);
        else others.add(i);
      }
      try { globe.setSpotlight(bright); } catch {}
      try { globe.setDimLayer(others); } catch {}

      // Soft pulse on the bright set: write a slow sinusoid into _dimTarget
      // for those points each frame. The per-frame fade in globe._tick eases
      // the live alpha toward this target, so the breath reads as a calm
      // glow rather than a flicker. Period ≈ 3.5s, amplitude 0.30 so dim
      // sits in [0.70, 1.00].
      if (globe._dimTarget && bright.size) {
        const tgt = globe._dimTarget;
        let phase = 0;
        const PHASE_PER_FRAME = 0.030;  // 60fps × 0.030 ≈ 1.8 rad/s → ~3.5s/cycle
        blinkRaf = raf.add('opener-preview-blink', () => {
          phase += PHASE_PER_FRAME;
          const wave = 0.85 + 0.15 * Math.sin(phase);
          for (const i of bright) tgt[i] = wave;
        });
      }
    }

    const dispose = raf.add('tour:opener-spin', () => {
      try { globe.nudge?.(OPENER_NUDGE_LON, OPENER_NUDGE_LAT); } catch {}
    });
    return () => {
      try { dispose(); } catch {}
      if (blinkRaf) { try { blinkRaf(); } catch {} }
      try { globe.setSpotlight(null); } catch {}
      try { globe.setDimLayer(null); } catch {}
    };
  },
};

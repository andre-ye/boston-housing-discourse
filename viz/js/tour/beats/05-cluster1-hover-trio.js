// Part 1 / Step 1 — locality demo on the gentrification / rent-control cluster.
//
// Three hand-picked points from tutorial-content.md § "Cluster 1 — Bottom-up
// features". A and B sit ~1.5° apart inside the same subcluster (wide enough
// to click comfortably; they still read as a local pair) and argue the same
// thing in different words; C lives ~16° away in the same cluster but reframes
// the conversation. Hovering each one surfaces the post text in the floating
// tooltip — the locality property reveals itself without us asserting it.

import { attachSpotlight } from '../spotlight.js';
import { setVisibilityTiers, clearVisibilityTiers } from '../../features/visibility-tiers.js';
import { tourTopicTagColor } from '../../data.js';

// Camera distance for the three-dots beat. Wider than CLOSE_FRAMING (1.35)
// so the trio sits inside its broader cluster neighborhood and the user
// can see what surrounds the points, not just the points themselves.
const TRIO_FRAMING = 1.85;

const TRIO = [
  { idx: 418401, role: 'A', tag: '1' },
  { idx: 113146, role: 'B', tag: '2' },
  { idx: 300597, role: 'C', tag: '3' },
];

export const beat = {
  id: 'cluster1-hover-trio',
  kind: 'step',
  section: { topic: 'gentrification & rent control', tool: 'bottom-up tools', cl: 32 },
  bodyHtml:
    '<p>We’ve zoomed into a cluster about ' +
    '<span class="topic-tag" data-cl="32">gentrification and rent control</span>. ' +
    'In this section we’ll explore <em>bottom-up</em> tools: engaging ' +
    'directly with what people are saying, in their own words. The points ' +
    'on this sphere are arranged so that posts with similar content sit ' +
    'closer together. <strong>To proceed, hover over the three glowing ' +
    'dots</strong> and confirm this for yourself.</p>',
  showChrome: ['cards'],
  pulse: 'tour-pulse-spotlight',
  manualContinue: true,
  enter(ctx) {
    const { globe, App, markStepDone } = ctx;
    // Tint any inline topic tag in the body to match its cluster's live colour.
    try {
      document.querySelectorAll('.tour-card .tour-prose .topic-tag[data-cl]').forEach((el) => {
        const cl = parseInt(el.dataset.cl, 10);
        if (Number.isInteger(cl)) el.style.color = tourTopicTagColor(cl);
      });
    } catch {}
    const state = App?.state;
    if (!state?.coords) {
      try { globe.rotateTo(0.467, -2.375, TRIO_FRAMING); } catch {}
      return () => {};
    }

    const picks = TRIO.filter(p =>
      Number.isFinite(state.coords[2 * p.idx]) &&
      Number.isFinite(state.coords[2 * p.idx + 1])
    );
    if (picks.length < 3) {
      try { globe.rotateTo(0.467, -2.375, TRIO_FRAMING); } catch {}
      return () => {};
    }

    const idxSet = new Set(picks.map(p => p.idx));

    // Reuse the trio spotlight + markers if beat 6 (click-pin) already set
    // them up, or set them up fresh otherwise. Beat 6 shares this same trio,
    // so cleanup defers the teardown to beat 6 — that prevents the marker
    // DOMs from being destroyed and recreated between steps 1 and 2, which
    // restarts the CSS scale-pulse keyframe and reads as a brief blink
    // (#51 #52). Tour close is the safety net (see ui.onTourClose).
    const existing = globe._tourTrioCluster1;
    let markers;
    if (existing && existing.idxSet && existing.idxSet.size === idxSet.size) {
      markers = existing.markers;
    } else {
      try { globe.setSpotlight(idxSet); } catch {}
      try { setVisibilityTiers({ level: 'tourSpotlight', scope: { brightIds: idxSet } }); } catch {}
      document.body.classList.add('tour-pin-spotlight');
      document.body.classList.add('tour-cam-snappy');

      let lat = 0, lon = 0;
      for (const p of picks) {
        lat += state.coords[2 * p.idx];
        lon += state.coords[2 * p.idx + 1];
      }
      lat /= picks.length;
      lon /= picks.length;
      try { globe.rotateTo(lat, lon, TRIO_FRAMING); } catch {}

      markers = attachSpotlight(globe, picks.map(p => ({
        idx: p.idx,
        lat: state.coords[2 * p.idx],
        lon: state.coords[2 * p.idx + 1],
        tag: p.tag,
      })));
      globe._tourTrioCluster1 = { markers, idxSet };
    }

    const valid = new Set(picks.map(p => p.idx));
    const hovered = new Set();
    let advanced = false;
    const onHover = (ev) => {
      const i = ev?.detail?.idx;
      if (i == null || !valid.has(i)) return;
      hovered.add(i);
      markers.consume?.(i);
      if (hovered.size >= picks.length && !advanced) {
        advanced = true;
        markStepDone?.();
      }
    };
    globe.addEventListener('hover', onHover);

    return () => {
      globe.removeEventListener('hover', onHover);
      // Markers + spotlight + body classes intentionally NOT torn down
      // here — beat 6 (click-pin) reuses the same trio. If the user skips
      // out of the tour from this beat, ui.onTourClose calls
      // releaseTourTrioCluster1() as the safety net.
    };
  },
};

// tour/spotlight — screen-space numbered markers for the Part-1 spotlight beat.
//
// Each marker is two DOM elements: a ring anchored on the point itself, and
// a tag chip placed nearby. Tags are pushed radially outward from the
// centroid of the visible markers each frame, and any pair whose tag boxes
// would overlap gets shoved further apart along the centroid axis. So two
// adjacent dots end up with their tags on opposite sides instead of stacked
// on top of each other.

import { POINT_RADIUS } from '../core/constants.js';

const TAG_OFFSET_PX = 18;       // base distance from ring centre to tag centre
const TAG_OVERLAP_PAD = 4;      // extra gap kept between adjacent tag boxes

export function attachSpotlight(globe, points) {
  const markers = points.map((p, i) => {
    const ring = document.createElement('div');
    ring.className = 'tour-spotlight-pulse';
    ring.style.position = 'fixed';
    ring.style.opacity = '0';
    document.body.appendChild(ring);

    const tag = document.createElement('div');
    tag.className = 'tour-spotlight-tag';
    tag.textContent = p.tag != null ? String(p.tag) : String(i + 1);
    tag.style.position = 'fixed';
    tag.style.opacity = '0';
    document.body.appendChild(tag);

    return { ...p, el: ring, tagEl: tag, _consumed: false };
  });

  const tick = () => {
    const rect = globe.canvas.getBoundingClientRect();
    const camPos = globe.camera.position;
    // First pass — project each marker, collect visible ones for centroid math.
    const visible = [];
    for (const m of markers) {
      const wp = globe.worldPositionOf(m.lat, m.lon, POINT_RADIUS);
      const facing = wp.x*(camPos.x-wp.x) + wp.y*(camPos.y-wp.y) + wp.z*(camPos.z-wp.z);
      if (facing <= 0.02) { m.el.style.opacity = '0'; m.tagEl.style.opacity = '0'; continue; }
      const proj = wp.clone().project(globe.camera);
      if (proj.z > 1) { m.el.style.opacity = '0'; m.tagEl.style.opacity = '0'; continue; }
      const x = rect.left + (proj.x * 0.5 + 0.5) * rect.width;
      const y = rect.top + (-proj.y * 0.5 + 0.5) * rect.height;
      m.el.style.opacity = '1';
      m.el.style.left = `${x}px`;
      m.el.style.top = `${y}px`;
      visible.push({ m, x, y });
    }
    if (visible.length === 0) return;

    // Centroid of visible markers — tags push away from this point so two
    // adjacent rings end up with their tags on opposite sides.
    let cx = 0, cy = 0;
    for (const v of visible) { cx += v.x; cy += v.y; }
    cx /= visible.length; cy /= visible.length;

    // First placement pass — radially outward from centroid.
    for (const v of visible) {
      let dx = v.x - cx, dy = v.y - cy;
      let len = Math.hypot(dx, dy);
      if (len < 1e-3) { dx = 0; dy = -1; len = 1; }   // degenerate (single point) — push up
      v.tx = v.x + (dx / len) * TAG_OFFSET_PX;
      v.ty = v.y + (dy / len) * TAG_OFFSET_PX;
    }

    // Collision pass — measure each tag, and for any pair whose boxes
    // overlap, shove them further apart along the centroid axis. One pass
    // is enough for the ≤ 5 markers the tour ever uses.
    for (let i = 0; i < visible.length; i++) {
      const a = visible[i];
      const ar = a.m.tagEl.getBoundingClientRect();
      const aw = ar.width || 22, ah = ar.height || 22;
      for (let j = i + 1; j < visible.length; j++) {
        const b = visible[j];
        const br = b.m.tagEl.getBoundingClientRect();
        const bw = br.width || 22, bh = br.height || 22;
        const minDx = (aw + bw) / 2 + TAG_OVERLAP_PAD;
        const minDy = (ah + bh) / 2 + TAG_OVERLAP_PAD;
        const dx = b.tx - a.tx, dy = b.ty - a.ty;
        if (Math.abs(dx) < minDx && Math.abs(dy) < minDy) {
          // Push along the (b - a) direction until the boxes clear.
          let pdx = dx, pdy = dy;
          const plen = Math.hypot(pdx, pdy);
          if (plen < 1e-3) { pdx = 1; pdy = 0; }      // identical positions — split horizontally
          const need = Math.max(minDx - Math.abs(dx), minDy - Math.abs(dy));
          const ux = pdx / Math.hypot(pdx, pdy);
          const uy = pdy / Math.hypot(pdx, pdy);
          a.tx -= ux * need / 2;
          a.ty -= uy * need / 2;
          b.tx += ux * need / 2;
          b.ty += uy * need / 2;
        }
      }
    }

    for (const v of visible) {
      v.m.tagEl.style.left = `${v.tx}px`;
      v.m.tagEl.style.top = `${v.ty}px`;
      v.m.tagEl.style.opacity = '1';
    }
  };
  // Chain into globe._onFrame so projection runs in the same frame as the
  // camera tween, immediately after worldGroup.quaternion + camera.position
  // are settled. Going through globe.raf 'tour:spotlight' worked in practice
  // (insertion-order iteration meant 'globe' ran first) but was a fragile
  // dependency on channel registration timing — chaining here makes the
  // ordering an invariant of the globe's render loop.
  const prevFrame = globe._onFrame;
  globe._onFrame = () => {
    if (prevFrame) prevFrame();
    tick();
  };
  const dispose = () => { globe._onFrame = prevFrame; };

  // Prime markers in the same JS task so they don't blink off for one
  // frame between consecutive beats that both spotlight the same trio
  // (#51 #52). Without this, beat-N cleanup removes the old markers and
  // beat-N+1's freshly-created markers sit at opacity:0 until the next
  // globe._onFrame fires — visible as a "trio disappears and reappears"
  // flicker. tick() projects + opacity-toggles them synchronously.
  try { tick(); } catch {}

  return {
    consume(idx) {
      const m = markers.find(mm => mm.idx === idx);
      if (m && !m._consumed) {
        m._consumed = true;
        m.el.classList.add('consumed');
        m.tagEl.classList.add('consumed');
      }
    },
    has(idx) { return markers.some(mm => mm.idx === idx); },
    teardown() {
      try { dispose(); } catch {}
      for (const m of markers) {
        try { m.el.remove(); } catch {}
        try { m.tagEl.remove(); } catch {}
      }
    },
  };
}

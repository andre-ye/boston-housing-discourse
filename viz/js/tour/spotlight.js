// tour/spotlight — screen-space numbered markers for the Part-1 spotlight beat.

import { POINT_RADIUS } from '../core/constants.js';

export function attachSpotlight(globe, points) {
  const markers = points.map((p, i) => {
    const el = document.createElement('div');
    el.className = 'tour-spotlight-pulse';
    el.dataset.tag = p.tag != null ? String(p.tag) : String(i + 1);
    el.style.position = 'fixed';
    el.style.opacity = '0';   // hidden until first projection lands
    document.body.appendChild(el);
    return { ...p, el, _consumed: false };
  });

  const tick = () => {
    const rect = globe.canvas.getBoundingClientRect();
    const camPos = globe.camera.position;
    for (const m of markers) {
      const wp = globe.worldPositionOf(m.lat, m.lon, POINT_RADIUS);
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
      try { dispose(); } catch {}
      for (const m of markers) {
        try { m.el.remove(); } catch {}
      }
    },
  };
}

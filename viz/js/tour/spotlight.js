// tour/spotlight — screen-space numbered markers for the Part-1 spotlight beat.

import { raf } from '../core/raf.js';
import { POINT_RADIUS } from '../core/constants.js';

export function attachSpotlight(globe, points) {
  const markers = points.map((p, i) => {
    const el = document.createElement('div');
    el.className = 'tour-spotlight-pulse';
    el.dataset.tag = p.tag != null ? String(p.tag) : String(i + 1);
    el.style.position = 'fixed';
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
  const dispose = raf.add('tour:spotlight', tick);

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

// tour/layout — single placement engine for cards, arrows, chips, minis.
// API: layoutTour(spec) → {placements, arrows, overflow}; pure.
// mountTourLayout({runner, ui}) installs RAF-debounced re-layout on resize/mutation.

const MARGIN = 12;          // furniture inflation
const INSET = 8;            // viewport edge inset
const TOL = 4;              // collision tolerance
const PAD_OFF = 18;         // arrow head gap from target
const MIN_LANE = 28;        // min walkable gutter for Z-routes

// Furniture IDs (per design §2). null IDs allowed; resolver skips misses.
const FURNITURE_IDS = [
  'nav', 'globe-controls-dock', 'pinned-view',
  'interview-card', 'search-results', 'search-suggestions',
];
const FURNITURE_TIMELINE = 'timeline-scrubber';   // only when not .hidden
const FURNITURE_LAUNCHER = 'tour-launcher';       // only when tour inactive

// ── geometry helpers ──────────────────────────────────────────────────
function rect(x, y, w, h) { return { x, y, w, h }; }
function inflate(r, m) { return rect(r.x - m, r.y - m, r.w + 2 * m, r.h + 2 * m); }
function clampToViewport(r, vp) {
  const x = Math.max(INSET, Math.min(r.x, vp.w - INSET - r.w));
  const y = Math.max(INSET, Math.min(r.y, vp.h - INSET - r.h));
  return rect(x, y, r.w, r.h);
}
function collides(a, b) {
  if (!a || !b) return false;
  return !(a.x + a.w - TOL <= b.x || b.x + b.w - TOL <= a.x ||
           a.y + a.h - TOL <= b.y || b.y + b.h - TOL <= a.y);
}
function rectFromDOM(el) {
  if (!el) return null;
  if (el.classList && el.classList.contains('hidden')) return null;
  const r = el.getBoundingClientRect();
  if (r.width * r.height <= 0) return null;
  return rect(r.left, r.top, r.width, r.height);
}

// ── furniture sampler ────────────────────────────────────────────────
export function measureFurniture({ tourActive } = {}) {
  const out = [];
  for (const id of FURNITURE_IDS) {
    const r = rectFromDOM(document.getElementById(id));
    if (r) out.push(inflate(r, MARGIN));
  }
  const tl = document.getElementById(FURNITURE_TIMELINE);
  if (tl && !tl.classList.contains('hidden')) {
    const r = rectFromDOM(tl);
    if (r) out.push(inflate(r, MARGIN));
  }
  if (!tourActive) {
    const r = rectFromDOM(document.getElementById(FURNITURE_LAUNCHER));
    if (r) out.push(inflate(r, MARGIN));
  }
  return out;
}

// ── slot generators ──────────────────────────────────────────────────
// Each returns {x,y,w,h} given anchor rect, size, viewport.
const ANCHORED_SLOTS = {
  'right-of':            (a, s) => rect(a.x + a.w + 14, a.y + a.h / 2 - s.h / 2, s.w, s.h),
  'left-of':             (a, s) => rect(a.x - s.w - 14, a.y + a.h / 2 - s.h / 2, s.w, s.h),
  'above':               (a, s) => rect(a.x + a.w / 2 - s.w / 2, a.y - s.h - 14, s.w, s.h),
  'below':               (a, s) => rect(a.x + a.w / 2 - s.w / 2, a.y + a.h + 14, s.w, s.h),
  'right-aligned-below': (a, s) => rect(a.x + a.w - s.w, a.y + a.h + 14, s.w, s.h),
  'left-aligned-below':  (a, s) => rect(a.x, a.y + a.h + 14, s.w, s.h),
  'opposite-quadrant':   (a, s, vp) => {
    const onLeft = (a.x + a.w / 2) > vp.w / 2;
    const onTop = (a.y + a.h / 2) > vp.h / 2;
    return rect(onLeft ? INSET : vp.w - INSET - s.w,
                onTop ? INSET : vp.h - INSET - s.h, s.w, s.h);
  },
};

const FREE_SLOTS = {
  'bottom-center':         (_, s, vp) => rect(vp.w / 2 - s.w / 2, vp.h - INSET - s.h, s.w, s.h),
  'top-center':            (_, s, vp) => rect(vp.w / 2 - s.w / 2, INSET, s.w, s.h),
  'bottom-right':          (_, s, vp) => rect(vp.w - INSET - s.w, vp.h - INSET - s.h, s.w, s.h),
  'bottom-left':           (_, s, vp) => rect(INSET, vp.h - INSET - s.h, s.w, s.h),
  'top-right':             (_, s, vp) => rect(vp.w - INSET - s.w, INSET, s.w, s.h),
  'top-left':              (_, s, vp) => rect(INSET, INSET, s.w, s.h),
  'viewport-inset-bottom': (_, s, vp) => rect(INSET, vp.h - INSET - s.h, vp.w - 2 * INSET, s.h),
};

const DEFAULT_FREE_ORDER     = ['bottom-center', 'top-center', 'bottom-right', 'bottom-left', 'top-right', 'top-left', 'viewport-inset-bottom'];
const DEFAULT_ANCHOR_ORDER   = ['right-of', 'left-of', 'above', 'below', 'opposite-quadrant'];
const NAVRAIL_ORDER          = ['right-of', 'below', 'above', 'opposite-quadrant'];   // bar-segs etc
const BARSEG_ORDER           = ['right-of', 'opposite-quadrant', 'below', 'above'];

function pickSlotOrder(spec) {
  if (Array.isArray(spec.slots) && spec.slots.length) return spec.slots;
  const a = spec.anchor;
  if (!a || a.kind === 'free' || (!a.rect && a.x == null)) return DEFAULT_FREE_ORDER;
  if (a.hint === 'navrail') return NAVRAIL_ORDER;
  if (a.hint === 'barseg') return BARSEG_ORDER;
  return DEFAULT_ANCHOR_ORDER;
}

function anchorRect(spec) {
  const a = spec.anchor;
  if (!a) return null;
  if (a.rect) return a.rect;
  if (a.x != null && a.y != null) return rect(a.x - 1, a.y - 1, 2, 2);
  return null;
}

// ── core engine ──────────────────────────────────────────────────────
export function layoutTour(spec) {
  const vp = spec.viewport;
  const furniture = spec.furniture || [];
  const placements = new Map();
  const arrows = new Map();
  const overflow = [];
  const placedRects = [];

  const sorted = (spec.elements || []).slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));

  for (const el of sorted) {
    const anchor = anchorRect(el);
    if (el.anchor && anchor == null && el.anchor.kind !== 'free') {
      overflow.push({ id: el.id, reason: 'no-anchor' });
      continue;
    }
    const order = pickSlotOrder(el);
    const slotMap = (el.anchor && (el.anchor.kind === 'free' || (!el.anchor.rect && el.anchor.x == null)))
      ? FREE_SLOTS : { ...ANCHORED_SLOTS, ...FREE_SLOTS };

    let placed = null;
    let chosenSlot = null;
    for (const slotName of order) {
      const fn = slotMap[slotName] || ANCHORED_SLOTS[slotName] || FREE_SLOTS[slotName];
      if (!fn) continue;
      let r = fn(anchor || rect(vp.w / 2, vp.h / 2, 0, 0), el.size, vp);
      r = clampToViewport(r, vp);
      if (anchor && collides(r, anchor)) continue;
      if (furniture.some(f => collides(r, f))) continue;
      if (placedRects.some(p => collides(r, p))) continue;
      placed = r; chosenSlot = slotName; break;
    }

    if (!placed && el.shrinkable && el.size.minH && el.size.h > el.size.minH) {
      const shrunk = { ...el, size: { ...el.size, h: el.size.minH } };
      for (const slotName of order) {
        const fn = slotMap[slotName] || ANCHORED_SLOTS[slotName] || FREE_SLOTS[slotName];
        if (!fn) continue;
        let r = fn(anchor || rect(vp.w / 2, vp.h / 2, 0, 0), shrunk.size, vp);
        r = clampToViewport(r, vp);
        if (anchor && collides(r, anchor)) continue;
        if (furniture.some(f => collides(r, f))) continue;
        if (placedRects.some(p => collides(r, p))) continue;
        placed = r; chosenSlot = slotName + ':shrunk'; break;
      }
    }

    if (!placed) {
      // Last-resort: viewport-edge inset on the largest empty side.
      const fb = fallbackEdgeRect(el.size, vp, furniture, placedRects);
      placements.set(el.id, { ...fb, slot: 'fallback', fallback: true });
      placedRects.push(fb);
      overflow.push({ id: el.id, reason: 'no-slot' });
      continue;
    }

    placements.set(el.id, { ...placed, slot: chosenSlot, fallback: false });
    placedRects.push(placed);
  }

  // Arrow routing — after cards.
  for (const el of sorted) {
    if (!el.arrowFrom) continue;
    const cardRect = placements.get(el.arrowFrom.cardId);
    const target = el.arrowFrom.targetRect;
    if (!cardRect || !target) {
      overflow.push({ id: el.id, reason: 'no-arrow-anchor' });
      continue;
    }
    const route = routeArrow(cardRect, target, furniture, placedRects);
    if (!route) {
      overflow.push({ id: el.id, reason: 'no-route' });
      continue;
    }
    arrows.set(el.id, route);
  }

  return { placements, arrows, overflow };
}

function fallbackEdgeRect(size, vp, furniture, placed) {
  const sides = [
    { name: 'bottom', r: rect(vp.w / 2 - size.w / 2, vp.h - INSET - size.h, size.w, size.h) },
    { name: 'top',    r: rect(vp.w / 2 - size.w / 2, INSET, size.w, size.h) },
    { name: 'right',  r: rect(vp.w - INSET - size.w, vp.h / 2 - size.h / 2, size.w, size.h) },
    { name: 'left',   r: rect(INSET, vp.h / 2 - size.h / 2, size.w, size.h) },
  ];
  let best = sides[0].r, bestScore = -Infinity;
  for (const s of sides) {
    const c = clampToViewport(s.r, vp);
    let score = 0;
    for (const f of furniture) if (collides(c, f)) score -= 10;
    for (const p of placed) if (collides(c, p)) score -= 10;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

// ── arrow routing ────────────────────────────────────────────────────
// Returns { d, kind, mirrorX, mirrorY, head:{x,y,angle} } or null.
function routeArrow(card, target, furniture, placed) {
  const tx = target.x + target.w / 2;
  const ty = target.y + target.h / 2;

  // Determine direction from card to target (which corner of card to leave from).
  const cx = card.x + card.w / 2;
  const cy = card.y + card.h / 2;
  const targetRight = tx > cx;
  const targetBelow = ty > cy;

  // Leave from the card edge that faces the target.
  const startX = targetRight ? card.x + card.w : card.x;
  const startY = Math.max(card.y, Math.min(card.y + card.h, ty));
  // Land just outside the target on the side facing the card.
  const endX = targetRight ? target.x - PAD_OFF : target.x + target.w + PAD_OFF;
  const endY = ty;

  const obstacles = furniture.concat(placed.filter(p => p !== card));

  // 1. straight diagonal
  const diag = { x1: startX, y1: startY, x2: endX, y2: endY };
  if (!segmentHitsAny(diag, obstacles, [card, target])) {
    return makeArrowResult([[diag.x1, diag.y1], [diag.x2, diag.y2]], 'straight');
  }

  // 2. single-elbow L (horizontal then vertical, or vice versa)
  const l1 = [[startX, startY], [endX, startY], [endX, endY]];
  if (!polylineHitsAny(l1, obstacles, [card, target])) {
    return makeArrowResult(l1, 'elbow');
  }
  const l2 = [[startX, startY], [startX, endY], [endX, endY]];
  if (!polylineHitsAny(l2, obstacles, [card, target])) {
    return makeArrowResult(l2, 'elbow');
  }

  // 3. Z-route through midpoint gutter
  const midX = (startX + endX) / 2;
  const z = [[startX, startY], [midX, startY], [midX, endY], [endX, endY]];
  if (!polylineHitsAny(z, obstacles, [card, target])) {
    return makeArrowResult(z, 'z');
  }

  return null;
}

function makeArrowResult(points, kind) {
  // SVG path through the points.
  const d = points.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const angle = Math.atan2(last[1] - prev[1], last[0] - prev[0]) * 180 / Math.PI;
  return { d, kind, mirrorX: false, mirrorY: false, head: { x: last[0], y: last[1], angle } };
}

function segmentHitsAny(seg, obstacles, exclude) {
  for (const o of obstacles) {
    if (exclude.includes(o)) continue;
    if (segmentHitsRect(seg.x1, seg.y1, seg.x2, seg.y2, o)) return true;
  }
  return false;
}
function polylineHitsAny(pts, obstacles, exclude) {
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = { x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1] };
    if (segmentHitsAny(seg, obstacles, exclude)) return true;
  }
  return false;
}
function segmentHitsRect(x1, y1, x2, y2, r) {
  // Quick reject by bounding box.
  if (Math.max(x1, x2) < r.x + TOL || Math.min(x1, x2) > r.x + r.w - TOL) return false;
  if (Math.max(y1, y2) < r.y + TOL || Math.min(y1, y2) > r.y + r.h - TOL) return false;
  // Liang-Barsky clip against the rect.
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - (r.x + TOL), (r.x + r.w - TOL) - x1, y1 - (r.y + TOL), (r.y + r.h - TOL) - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; }
    else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}

// ── runtime mount ────────────────────────────────────────────────────
export function mountTourLayout({ runner, ui, shadow = true } = {}) {
  let pending = false;
  let lastSpec = null;

  function buildSpec() {
    const vp = { w: window.innerWidth, h: window.innerHeight };
    const tourActive = !!(runner && runner.active);
    const furniture = measureFurniture({ tourActive });
    const elements = [];

    // Card spec — measure live tour-card if mounted.
    const cardEl = document.querySelector('.tour-card:not(.hidden)');
    if (cardEl) {
      const cr = cardEl.getBoundingClientRect();
      elements.push({
        id: 'tour-card',
        kind: 'card',
        size: { w: cr.width || 620, h: cr.height || 200 },
        anchor: { kind: 'free' },
        priority: 100,
        shrinkable: true,
      });
    }

    // Arrow target — derived from runner's current beat via DOM lookup.
    const beat = runner && runner._currentBeat ? runner._currentBeat() : null;
    const sel = beat && beat._arrowSelector;
    if (sel) {
      const t = document.querySelector(sel);
      const tr = rectFromDOM(t);
      if (tr) {
        elements.push({
          id: 'tour-arrow',
          kind: 'arrow',
          size: { w: 1, h: 1 },
          anchor: { kind: 'free' },
          priority: 50,
          arrowFrom: { cardId: 'tour-card', targetRect: tr },
        });
      }
    }

    return { viewport: vp, furniture, elements };
  }

  function applyPlacements(result) {
    const cardEl = document.querySelector('.tour-card:not(.hidden)');
    const cardP = result.placements.get('tour-card');
    if (cardEl && cardP) {
      cardEl.style.position = 'absolute';
      cardEl.style.left = `${Math.round(cardP.x)}px`;
      cardEl.style.top = `${Math.round(cardP.y)}px`;
      cardEl.style.right = 'auto';
      cardEl.style.bottom = 'auto';
      cardEl.style.transform = 'none';
      cardEl.style.width = `${Math.round(cardP.w)}px`;
      cardEl.dataset.tourLaidOut = 'true';
    }
    const arrowR = result.arrows.get('tour-arrow');
    const arrowEl = document.getElementById('tour-arrow');
    if (arrowEl && arrowR) {
      writeArrow(arrowEl, arrowR);
    } else if (arrowEl) {
      arrowEl.classList.add('hidden');
    }
  }

  function relayout() {
    pending = false;
    const spec = buildSpec();
    lastSpec = spec;
    const result = layoutTour(spec);
    if (shadow) {
      // Shadow mode: log diff vs current DOM rects.
      try { console.debug('[tour-layout shadow]', { placements: [...result.placements], arrows: [...result.arrows], overflow: result.overflow }); } catch {}
    } else {
      applyPlacements(result);
    }
    return result;
  }

  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(relayout);
  }

  window.addEventListener('resize', schedule);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);

  const mo = new MutationObserver(schedule);
  // Observe targets that can shift furniture: timeline open/close, nav rebuild.
  const obsTargets = ['nav', 'timeline-scrubber', 'globe-controls-dock', 'pinned-view'];
  for (const id of obsTargets) {
    const el = document.getElementById(id);
    if (el) mo.observe(el, { attributes: true, attributeFilter: ['class', 'style'], childList: true, subtree: false });
  }

  return { relayout, schedule, getLastSpec: () => lastSpec };
}

// ── arrow DOM writer ─────────────────────────────────────────────────
// Reuses #tour-arrow but replaces its inner SVG with a path for the route.
function writeArrow(el, route) {
  const head = route.head;
  // Build SVG with a path + arrowhead polygon at the end.
  const headLen = 12, headWide = 7;
  const a = head.angle * Math.PI / 180;
  const hx = head.x, hy = head.y;
  const bx = hx - headLen * Math.cos(a);
  const by = hy - headLen * Math.sin(a);
  const lx = bx + headWide * Math.cos(a + Math.PI / 2);
  const ly = by + headWide * Math.sin(a + Math.PI / 2);
  const rx = bx + headWide * Math.cos(a - Math.PI / 2);
  const ry = by + headWide * Math.sin(a - Math.PI / 2);
  el.style.position = 'fixed';
  el.style.left = '0';
  el.style.top = '0';
  el.style.width = `${window.innerWidth}px`;
  el.style.height = `${window.innerHeight}px`;
  el.style.transform = 'none';
  el.classList.remove('tour-arrow--mirror-x', 'tour-arrow--mirror-y');
  el.innerHTML = `
    <svg width="100%" height="100%" viewBox="0 0 ${window.innerWidth} ${window.innerHeight}" fill="none" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
      <path d="${route.d}" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <polygon points="${hx},${hy} ${lx},${ly} ${rx},${ry}" fill="currentColor"/>
    </svg>`;
  el.classList.remove('hidden');
}

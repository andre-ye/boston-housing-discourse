// visibility-tiers — three-tier point alpha (#34, #5).
//
// Routes hover and tour-spotlight callers through a single helper that
// computes BRIGHT (focal scope), DIM (parent-context layer), and HIDDEN
// (everything else) point sets, then writes them to the globe.
//
// The DIM tier is the "this group sits inside that larger group" cue. The
// helper auto-derives the DIM set from `scope` + `level` when the caller
// doesn't pass an explicit `idsByTier.dim`.

import { VIS_TIER } from '../core/constants.js';

// Resolve the globe at call time — the helper is imported during module
// init, before window.App is wired.
function getGlobe() {
  return window.App?.globe || null;
}
function getState() {
  return window.App?.state || window.App?.globe?.state || null;
}

// Compute the parent-context (DIM) point set for a given level + scope.
//   level='topic'      → no parent context (DIM is empty)
//   level='subtopic'   → all points in scope.cl outside the chosen sub
//   level='position'   → all points in scope.{cl,sub} outside the chosen posIdx
//   level='tourSpotlight' → siblings of the spotlight's majority cluster (or sub)
function deriveDimSet(level, scope) {
  const st = getState();
  if (!st || !st.cluster) return null;
  const N = st.cluster.length;

  if (level === 'topic') return null;

  if (level === 'subtopic') {
    const cl = scope?.cl, sub = scope?.sub;
    if (cl == null || sub == null) return null;
    const out = new Set();
    for (let i = 0; i < N; i++) {
      if (st.cluster[i] === cl && st.subLocal[i] !== sub) out.add(i);
    }
    return out;
  }

  if (level === 'position') {
    const cl = scope?.cl, sub = scope?.sub, posIdx = scope?.posIdx;
    if (cl == null || sub == null || posIdx == null) return null;
    const pa = st.positionAssignments;
    const out = new Set();
    for (let i = 0; i < N; i++) {
      if (st.cluster[i] !== cl || st.subLocal[i] !== sub) continue;
      if (pa && pa[i] !== posIdx) out.add(i);
    }
    return out;
  }

  if (level === 'tourSpotlight') {
    // Use whatever the caller gave us as `scope.brightIds` to infer the
    // surrounding context. Pick the majority (cl, sub) — if all targets
    // share a sub, DIM = same sub minus targets; else if they share cl,
    // DIM = same cl minus targets.
    const bright = scope?.brightIds;
    if (!bright || bright.size === 0) return null;
    let sharedCl = null, sharedSub = null, sharedClOk = true, sharedSubOk = true;
    for (const i of bright) {
      const c = st.cluster[i], s = st.subLocal[i];
      if (sharedCl == null) sharedCl = c; else if (sharedCl !== c) sharedClOk = false;
      if (sharedSub == null) sharedSub = s; else if (sharedSub !== s) sharedSubOk = false;
    }
    const out = new Set();
    if (sharedClOk && sharedSubOk && sharedCl != null) {
      for (let i = 0; i < N; i++) {
        if (st.cluster[i] === sharedCl && st.subLocal[i] === sharedSub && !bright.has(i)) out.add(i);
      }
    } else if (sharedClOk && sharedCl != null) {
      for (let i = 0; i < N; i++) {
        if (st.cluster[i] === sharedCl && !bright.has(i)) out.add(i);
      }
    }
    return out;
  }

  return null;
}

// Resolve a `scope` descriptor into a globe-friendly form. Hover handlers
// already pass {cl, gid, posIdx} matching globe.setHighlight; we translate
// gid → sub via the App.subGidMap for membership math.
function resolveScope(level, scope) {
  if (!scope) return null;
  if (level === 'tourSpotlight') return scope;
  const out = { cl: scope.cl ?? null, sub: null, posIdx: scope.posIdx ?? null };
  if (scope.gid != null) {
    const g = window.App?.subGidMap?.byGid?.[scope.gid];
    if (g) out.sub = g.sub;
  }
  return out;
}

// Public entry point.
//   level: 'topic' | 'subtopic' | 'position' | 'tourSpotlight'
//   scope: { cl, gid, posIdx } for hover; { brightIds: Set<number> } for tour
//   idsByTier (optional): { bright: Set, dim: Set } — explicit override
export function setVisibilityTiers({ level, scope, idsByTier } = {}) {
  const globe = getGlobe();
  if (!globe) return;

  // Explicit override — caller knows better than the auto-derive.
  if (idsByTier && idsByTier.bright) {
    try { globe.setSpotlight(idsByTier.bright); } catch {}
    try { globe.setDimLayer?.(idsByTier.dim || null); } catch {}
    return;
  }

  const resolved = resolveScope(level, scope);

  if (level === 'tourSpotlight') {
    const dim = deriveDimSet('tourSpotlight', resolved);
    try { globe.setDimLayer?.(dim); } catch {}
    // Caller also calls globe.setSpotlight(brightIds) directly — we do not
    // duplicate that here so the existing spotlight teardown semantics
    // (clearing the spotlight slot) keep working.
    return;
  }

  if (level === 'topic') {
    // setHighlight first so its _recomputeDim runs with a stale dimLayer
    // value of null (we're about to set it to null anyway). Order doesn't
    // matter here; we clear dimLayer last for symmetry with the other paths.
    try { globe.setHighlight({ cl: resolved?.cl ?? null, gid: scope?.gid ?? null, posIdx: scope?.posIdx ?? null }); } catch {}
    try { globe.setDimLayer?.(null); } catch {}
    return;
  }

  if (level === 'subtopic' || level === 'position') {
    const dim = deriveDimSet(level, resolved);
    // setHighlight first (recomputes dim), then setDimLayer (recomputes
    // dim again with the new dimLayer applied). Final write wins.
    try { globe.setHighlight({ cl: scope?.cl ?? null, gid: scope?.gid ?? null, posIdx: scope?.posIdx ?? null }); } catch {}
    try { globe.setDimLayer?.(dim); } catch {}
    return;
  }
}

// Restore everything to BRIGHT (clears spotlight + dim layer + highlight).
export function clearVisibilityTiers() {
  const globe = getGlobe();
  if (!globe) return;
  try { globe.setDimLayer?.(null); } catch {}
}

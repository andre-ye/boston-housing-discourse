// Shared helpers for tour beats.
//
// pickThreeDemoPoints: returns three points for Part 1 step 1 — two in the
// same cluster (semantically similar), one in a different cluster but
// spatially nearby on the sphere. Deterministic ordering so re-running the
// tour shows the same trio. May return null if the data isn't loaded yet.
//
// pickThreeFallbackPoints: when the geometry-aware picker can't find a clean
// triangle, return any three globally distributed indices so the beat can
// still proceed (issue #18 root-cause fix).
//
// rotateToPointSet: rotates the globe to the densest sampled pocket of an
// index set. Search terms like "covid" appear across many topics; a global
// average can land between clusters and look like nothing happened.

export function pickThreeDemoPoints(state) {
  if (!state?.coords || !state?.cluster || !state?.N) return null;
  const N = state.N;
  const coords = state.coords;
  const cluster = state.cluster;
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
        if (d >= 0.035 && d <= 0.12 && (!sameBest || d < sameBest.d)) sameBest = { i, d, cl };
      } else {
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

// Failsafe: pick any three globally distributed valid indices.  We sample
// the corpus at 1/3, 1/2, 2/3 marks and walk forward to the first valid
// index after each. The beat advances on three clicks rather than on
// "same-cluster vs different-cluster" geometry, so this is safe.
export function pickThreeFallbackPoints(state) {
  if (!state?.coords || !state?.N) return null;
  const N = state.N;
  const coords = state.coords;
  const cluster = state.cluster;
  const seeds = [Math.floor(N / 4), Math.floor(N / 2), Math.floor(3 * N / 4)];
  const out = [];
  for (const s of seeds) {
    let i = s;
    let tries = 0;
    while (tries < N) {
      if (Number.isFinite(coords[2 * i]) && Number.isFinite(coords[2 * i + 1])) {
        out.push({
          idx: i,
          cluster: cluster ? cluster[i] : null,
          role: out.length === 0 ? 'A1' : (out.length === 1 ? 'A2' : 'B'),
        });
        break;
      }
      i = (i + 1) % N;
      tries++;
    }
  }
  return out.length === 3 ? out : null;
}

export function rotateToPointSet(globe, state, idxSet, distance = 1.22) {
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

// Brief "virtual click" visual pulse on a sidebar element.
export function pulseElement(selector) {
  try {
    const el = document.querySelector(selector);
    if (!el) return;
    el.classList.add('tour-pulse');
    setTimeout(() => el.classList.remove('tour-pulse'), 900);
  } catch {}
}

export function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

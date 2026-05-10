// search-find — per-post text search across the chunk corpus.

import { ZOOM_TO_POINT_FRAMING, SEARCH_HITS_FRAMING } from '../core/constants.js';

// Compute the rotation target for a hit set (#49). The naive "spherical
// mean of all hits" is fragile when matches are bimodal — e.g. "boiler"
// has the bulk in the Tenant Rights cluster and a smaller pocket in the
// HVAC/repair cluster, and the average vector lands somewhere on neither
// side. Instead, bucket hits into a coarse spherical grid, find the bin
// with the most hits, and average within that bin. The framing distance
// also tightens when the dense bin holds a minority of hits, so the user
// sees the dense mass instead of a wide shot.
//
// Tiny hit sets (< 30) skip bucketing — the global spherical mean is fine
// there, and bucketing on tiny sets just adds quantization noise.
function computeHitsCentroid(coords, hitSet, baseFraming) {
  if (!coords || !hitSet || hitSet.size === 0) return null;

  // Materialize valid (lat, lon) pairs once; we iterate them several times.
  const pts = [];
  for (const idx of hitSet) {
    const lat = coords[2 * idx];
    const lon = coords[2 * idx + 1];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    pts.push(lat, lon);
  }
  const N = pts.length / 2;
  if (N === 0) return null;

  // Spherical mean of the full set (used as a fallback and as a tiebreaker).
  const meanOf = (indices) => {
    let x = 0, y = 0, z = 0, k = 0;
    if (indices) {
      for (const i of indices) {
        const lat = pts[2 * i], lon = pts[2 * i + 1];
        const cl = Math.cos(lat);
        x += cl * Math.cos(lon); y += cl * Math.sin(lon); z += Math.sin(lat);
        k++;
      }
    } else {
      for (let i = 0; i < N; i++) {
        const lat = pts[2 * i], lon = pts[2 * i + 1];
        const cl = Math.cos(lat);
        x += cl * Math.cos(lon); y += cl * Math.sin(lon); z += Math.sin(lat);
        k++;
      }
    }
    if (k === 0) return null;
    return {
      lat: Math.atan2(z / k, Math.hypot(x / k, y / k)),
      lon: Math.atan2(y / k, x / k),
    };
  };

  // Tiny set: just take the spherical mean. No bucketing.
  if (N < 30) {
    const c = meanOf(null);
    return c ? { lat: c.lat, lon: c.lon, framing: baseFraming } : null;
  }

  // Coarse 16x16 lat/lon bucket grid (each cell ~π/8 rad on a side).
  // Equal-area would be ideal but adds complexity; for ~1000-point sets the
  // poles aren't a real failure mode here (data lives in mid-latitudes).
  const BIN = Math.PI / 8;
  const bins = new Map();
  for (let i = 0; i < N; i++) {
    const lat = pts[2 * i], lon = pts[2 * i + 1];
    const a = Math.floor((lat + Math.PI / 2) / BIN);
    const b = Math.floor((lon + Math.PI) / BIN);
    const key = a + ':' + b;
    let arr = bins.get(key);
    if (!arr) { arr = []; bins.set(key, arr); }
    arr.push(i);
  }

  // Outlier guard: only consider bins with at least max(2, 2% of hits).
  // Without this, a tied 1-point bin could win on small sets.
  const minBin = Math.max(2, Math.floor(0.02 * N));
  let bestKey = null, bestCount = 0;
  for (const [k, arr] of bins) {
    if (arr.length < minBin) continue;
    if (arr.length > bestCount) { bestCount = arr.length; bestKey = k; }
  }

  // Every bin filtered out (rare — extremely scattered hits). Use the
  // global spherical mean and the base framing.
  if (!bestKey) {
    const c = meanOf(null);
    return c ? { lat: c.lat, lon: c.lon, framing: baseFraming } : null;
  }

  const denseIdx = bins.get(bestKey);
  const c = meanOf(denseIdx);
  if (!c) return null;

  // Framing: if the dense bin is the overwhelming majority, the global
  // framing is fine. If it's a smaller fraction (the bimodal case), tighten
  // so the user actually sees the dense mass, not a wide shot of the sphere.
  // Floor at 0.85 so we never zoom past where individual posts blur.
  const frac = denseIdx.length / N;
  let framing = baseFraming;
  if (frac < 0.8) {
    framing = Math.max(0.85, baseFraming * 0.7);
  }

  return { lat: c.lat, lon: c.lon, framing };
}

export function init(ctx) {
  const { App, globe, getPointDetails, showDetailCard, setSelection } = ctx;

  async function ensureAllChunksLoaded(onProgress) {
    const st = App.state;
    const total = st.manifest.files.length;
    let done = 0;
    const promises = [];
    for (let ci = 0; ci < total; ci++) {
      let p = st.chunkCache.get(ci);
      if (!p) {
        // Evict rejected promises from the cache so a transient network
        // blip on first fetch doesn't permanently poison search (#48):
        // without this, every later `findPointsContaining` reuses the same
        // rejected promise and silently fails via the caller's `.catch`,
        // which is exactly the "search intermittently breaks" symptom.
        const idx = ci;
        p = fetch('tsne_chunks/' + st.manifest.files[idx])
          .then(r => {
            if (!r.ok) throw new Error('chunk ' + idx + ' http ' + r.status);
            return r.json();
          });
        p.catch(() => {
          if (st.chunkCache.get(idx) === p) st.chunkCache.delete(idx);
        });
        st.chunkCache.set(idx, p);
      }
      p.then(() => { done++; onProgress?.(done, total); }, () => {});
      promises.push(p);
    }
    return Promise.all(promises);
  }

  async function findPointsContaining(phrase, onProgress) {
    const lower = String(phrase || '').toLowerCase().trim();
    if (!lower) return new Set();
    const chunks = await ensureAllChunksLoaded(onProgress);
    const matches = new Set();
    for (const chunk of chunks) {
      const offset = chunk.offset;
      const titles = chunk.title || [];
      const hover = chunk.hover_body || [];
      const panel = chunk.panel_body || [];
      for (let i = 0; i < chunk.n; i++) {
        const t = ((titles[i] || '') + ' ' + (panel[i] || hover[i] || '')).toLowerCase();
        if (t.includes(lower)) matches.add(offset + i);
      }
    }
    return matches;
  }

  async function findPointForSnippet(snippetText) {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const target = norm(snippetText);
    if (!target) return -1;
    const lowTarget = target.toLowerCase();
    // Multiple probe windows so we tolerate prefix mismatch between the
    // snippet sample (which may start mid-sentence after the corpus
    // builder's clipping) and the full chunk text (which starts at the
    // post's actual title/body). The previous code only tried the FIRST
    // 80 chars from each side, so any leading whitespace or quote-marker
    // mismatch caused -1 and the click silently fell back to a synthetic
    // card with no globe pin (#43).
    const probes = [];
    const win = 60;
    for (let start = 0; start <= Math.min(lowTarget.length - win, 180); start += 40) {
      probes.push(lowTarget.slice(start, start + win));
    }
    if (!probes.length && lowTarget.length >= 12) probes.push(lowTarget);
    if (!probes.length) return -1;
    const chunks = await ensureAllChunksLoaded();
    for (const chunk of chunks) {
      const offset = chunk.offset;
      const titles = chunk.title || [];
      const hover = chunk.hover_body || [];
      const panel = chunk.panel_body || [];
      for (let i = 0; i < chunk.n; i++) {
        const body = norm((titles[i] || '') + ' ' + (panel[i] || hover[i] || '')).toLowerCase();
        if (!body) continue;
        for (const p of probes) {
          if (body.includes(p)) return offset + i;
        }
        // Fallback: target may BE the title (very short snippet); allow
        // body to match a prefix of target.
        if (body.length >= 24 && lowTarget.includes(body.slice(0, 60))) {
          return offset + i;
        }
      }
    }
    return -1;
  }

  async function pinPointByIndex(idx) {
    if (idx == null || idx < 0) return;
    setSelection({ pinnedIdx: idx });
    globe.setPinnedPoint(idx);
    const lat = App.state.coords[2 * idx];
    const lon = App.state.coords[2 * idx + 1];
    if (lat != null && lon != null) globe.rotateTo(lat, lon, ZOOM_TO_POINT_FRAMING);
    try {
      const details = await getPointDetails(App.state, idx);
      if (details) showDetailCard(details);
    } catch (e) {}
  }

  // Rotate to the densest sub-cluster of a hit set so a search like
  // "boiler" lands on the bulk of matches rather than on a centroid
  // pulled off-center by a smaller secondary pocket (#49). Single-hit
  // sets degrade naturally to pinPointByIndex's framing; empty sets do
  // nothing. computeHitsCentroid may also tighten the framing distance
  // when the densest bin is a minority of hits.
  function rotateToHitsCentroid(hitSet, framing = SEARCH_HITS_FRAMING) {
    if (!hitSet || hitSet.size === 0) return false;
    if (hitSet.size === 1) {
      const idx = hitSet.values().next().value;
      const lat = App.state.coords[2 * idx];
      const lon = App.state.coords[2 * idx + 1];
      if (lat == null || lon == null) return false;
      try { globe.rotateTo(lat, lon, framing); return true; } catch { return false; }
    }
    const c = computeHitsCentroid(App.state.coords, hitSet, framing);
    if (!c) return false;
    try { globe.rotateTo(c.lat, c.lon, c.framing ?? framing); return true; } catch { return false; }
  }

  App.findPointsContaining = findPointsContaining;
  App.findPointForSnippet = findPointForSnippet;
  App.pinPointByIndex = pinPointByIndex;
  App.rotateToHitsCentroid = rotateToHitsCentroid;

  return { ensureAllChunksLoaded, findPointsContaining, findPointForSnippet, pinPointByIndex, rotateToHitsCentroid };
}

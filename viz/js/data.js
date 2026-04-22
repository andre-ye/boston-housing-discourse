// Data loading + shared state.
// Exposes window.App = { coords, labels, clusters, subclusters, centroids, manifest, ... }

// Single source of truth for cluster identity. The SAME hue is used on the
// globe (saturated, to pop against the dark sphere) and in the nav (dimmed
// toward the panel background, so 50 stripes don't fight the eye). Cluster N
// gets the same *identity* in both places — the only thing that varies is
// intensity.
export const SPHERE_PALETTE = [
  "#5b9cff","#3fe9b8","#ff5a4a","#ffc233","#b16dff",
  "#ff7e1a","#1ed28e","#f25aaf","#1aa6ee","#ffbe1a",
  "#9b6bff","#33d160","#ff5a5a","#1ec5b0","#ff5278",
  "#9be21e","#e34cff","#3a8aff","#ffae1a","#5b6dff",
  "#5fd97a","#ff7878","#5a9eff","#c98aff","#33e6a8",
];

// Nav uses the SAME saturated sphere palette — cluster N is one colour
// whether you see it on the globe or in the sidebar stripes. No pastel
// dilution; the bars pop against the dark panel background.
export const CLUSTER_PALETTE = SPHERE_PALETTE.slice();

export function clusterColor(c) {
  const i = ((c % CLUSTER_PALETTE.length) + CLUSTER_PALETTE.length) % CLUSTER_PALETTE.length;
  return CLUSTER_PALETTE[i];
}

export function hexToRgb(hex) {
  const h = hex.replace('#','');
  const v = parseInt(h, 16);
  return [(v>>16)&255, (v>>8)&255, v&255];
}

// Shade a hex color by a factor (0..1 dims, >1 brightens).
export function shadeColor(hex, factor) {
  const [r,g,b] = hexToRgb(hex);
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${clamp(r*factor)},${clamp(g*factor)},${clamp(b*factor)})`;
}

// Convert (lat, lon) radians → unit sphere (x,y,z) with Y up.
// Longitude 0 maps to +X, pi/2 to +Z.
export function latLonToXYZ(lat, lon, radius = 1) {
  const cl = Math.cos(lat);
  return [
    radius * cl * Math.cos(lon),
    radius * Math.sin(lat),
    radius * cl * Math.sin(lon),
  ];
}

async function fetchBinary(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`fetch ${path}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function fetchJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`fetch ${path}: ${r.status}`);
  return r.json();
}

// Pure client-side fallback: project existing 2D t-SNE to a sphere using
// Lambert azimuthal equal-area projection. Used while UMAP is still running.
async function buildSphereFallback() {
  const manifest = await fetchJSON('tsne_chunks/manifest.json');
  const N = manifest.totalPoints;
  const xExt = manifest.extent.x;
  const yExt = manifest.extent.y;
  const cx = (xExt[0] + xExt[1]) / 2;
  const cy = (yExt[0] + yExt[1]) / 2;
  const halfW = (xExt[1] - xExt[0]) / 2;
  const halfH = (yExt[1] - yExt[0]) / 2;
  const coords = new Float32Array(N * 2); // lat, lon
  let filled = 0;
  for (let i = 0; i < manifest.files.length; i++) {
    const c = await fetchJSON('tsne_chunks/' + manifest.files[i]);
    const off = c.offset;
    for (let j = 0; j < c.n; j++) {
      // Normalize to [-1,1]
      const u = (c.x[j] - cx) / halfW;
      const v = (c.y[j] - cy) / halfH;
      // Lambert azimuthal equal-area on the unit disk → unit sphere
      // (u,v) ∈ disk radius 1; r² = u²+v²; if outside, clamp.
      const r2 = u*u + v*v;
      const k = 2 * Math.asin(Math.min(1, Math.sqrt(r2)) * 0.92); // colatitude from pole
      // Place patch centered on equator-front (lat=0, lon=0)
      // Map disk (u,v) → sphere via tangent plane on +X:
      //   x = cos(k)
      //   y = sin(k)*v/r
      //   z = sin(k)*u/r
      let sx, sy, sz;
      if (r2 < 1e-9) { sx = 1; sy = 0; sz = 0; }
      else {
        const rr = Math.sqrt(r2);
        sx = Math.cos(k);
        sy = Math.sin(k) * v / rr;
        sz = Math.sin(k) * u / rr;
      }
      const lat = Math.asin(sy);
      const lon = Math.atan2(sz, sx);
      coords[2*(off+j)] = lat;
      coords[2*(off+j)+1] = lon;
      filled++;
    }
    App.loadingMsg(`Loading sphere coords… ${Math.round(100*filled/N)}%`);
  }
  return { coords, source: 'fallback-lambert' };
}

async function loadSphereCoords() {
  // Try UMAP haversine binary first; fall back to Lambert projection of 2D.
  try {
    const manifest = await fetchJSON('tsne_chunks/sphere_manifest.json');
    const buf = await fetchBinary('tsne_chunks/sphere_coords.bin');
    const coords = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    return { coords, source: 'umap-haversine', N: manifest.n };
  } catch (e) {
    App.loadingMsg('UMAP sphere not yet built — using Lambert projection of 2D…');
    const out = await buildSphereFallback();
    return { ...out, N: out.coords.length / 2 };
  }
}

async function loadPointLabels(N) {
  const buf = await fetchBinary('tsne_chunks/point_labels.bin');
  // Each point: int16 cluster (LE) + uint8 subLocal → 3 bytes
  const cluster = new Int16Array(N);
  const subLocal = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const lo = buf[3*i];
    const hi = buf[3*i+1];
    // little-endian int16
    let v = (hi << 8) | lo;
    if (v & 0x8000) v = v - 0x10000;
    cluster[i] = v;
    subLocal[i] = buf[3*i+2];
  }
  return { cluster, subLocal };
}

export async function loadData(onProgress) {
  App.loadingMsg = onProgress;
  App.loadingMsg('Loading sphere coordinates…');
  const [sphere, clusters, subclusters] = await Promise.all([
    loadSphereCoords(),
    fetchJSON('tsne_chunks/cluster_labels.json'),
    fetchJSON('tsne_chunks/subcluster_labels.json'),
  ]);
  App.loadingMsg('Loading labels…');
  const labels = await loadPointLabels(sphere.N);

  App.loadingMsg('Loading centroids…');
  let centroids = null;
  try { centroids = await fetchJSON('tsne_chunks/sphere_centroids.json'); }
  catch (e) { centroids = computeCentroids(sphere.coords, labels); }

  // Density-peak anchors (see scripts/compute_label_anchors.py). Used for label
  // positioning since spherical centroids can drift into empty space when a
  // cluster sprawls across the globe.
  let anchors = null;
  try { anchors = await fetchJSON('tsne_chunks/label_anchors.json'); }
  catch (e) { /* fall back to centroids */ }

  // Position-level anchors (sub-sub-clusters): one per LLM-extracted position.
  // Each position has a density-peak location computed from the points actually
  // attributed to it (scripts/attribute_positions.py).
  let positionAnchors = null;
  let positionAssignments = null;
  try {
    positionAnchors = await fetchJSON('tsne_chunks/position_anchors.json');
    const buf = await fetchBinary('tsne_chunks/position_assignments.bin');
    positionAssignments = buf;   // uint8 per point
  } catch (e) { /* positions layer is optional */ }

  // Per-cluster / per-sub monthly histograms, pre-baked for O(1) sparklines.
  let timeHist = null;
  try { timeHist = await fetchJSON('tsne_chunks/time_histograms.json'); }
  catch (e) { /* temporal layer is optional */ }

  // Top-5 subreddits per cluster + per sub.
  let subredditBreakdown = null;
  try { subredditBreakdown = await fetchJSON('tsne_chunks/subreddit_breakdown.json'); }
  catch (e) { /* optional */ }

  // Per-point subreddit index (uint8) + id→name map. Enables live globe
  // filtering by subreddit: click a legend label → dim every other point.
  let subredditAssignments = null;
  let subredditNames = null;
  try {
    const buf = await fetchBinary('tsne_chunks/subreddit_assignments.bin');
    subredditAssignments = new Uint8Array(buf);
    subredditNames = await fetchJSON('tsne_chunks/subreddit_names.json');
  } catch (e) { /* optional */ }

  // Per-point month index for timeline filtering. 422 KB, complements
  // the by-sub monthly histograms (pre-baked aggregates) with per-point
  // detail so the globe can be sliced to a month range on hover.
  let monthAssignments = null;
  let monthLabels = null;
  try {
    const buf = await fetchBinary('tsne_chunks/month_assignments.bin');
    monthAssignments = new Uint8Array(buf);
    monthLabels = await fetchJSON('tsne_chunks/month_labels.json');
  } catch (e) { /* optional */ }

  // Per-position monthly histograms (pre-baked). Lets the position card
  // show *that stance's* temporal arc rather than its parent sub's.
  let positionTimeHist = null;
  try { positionTimeHist = await fetchJSON('tsne_chunks/time_histograms_positions.json'); }
  catch (e) { /* optional */ }

  // Street interview pin placements (optional; only present if the pipeline
  // has been run).
  let interviews = null, interviewPins = null;
  try {
    [interviews, interviewPins] = await Promise.all([
      fetchJSON('interviews/interviews.json'),
      fetchJSON('interviews/pin_placements.json'),
    ]);
  } catch (e) { /* pins are a bonus layer */ }

  App.loadingMsg('Loading chunk manifest…');
  const manifest = await fetchJSON('tsne_chunks/manifest.json');

  const state = {
    N: sphere.N,
    coords: sphere.coords,     // Float32 [lat, lon] interleaved
    sphereSource: sphere.source,
    cluster: labels.cluster,   // Int16 per point
    subLocal: labels.subLocal, // Uint8 per point
    clusterMeta: clusters.embedding || clusters,  // { "0": { name, ... } }
    subMeta: subclusters,      // { "0": [{sub, name, ...}] }
    centroids,
    anchors,                   // { clusters: {cl: {lat,lon,density,...}}, subclusters: {...} }
    positionAnchors,           // { gid: { positions: [{name, lat, lon, count, ...}] } }
    positionAssignments,       // Uint8Array of length N (255 = unassigned)
    interviews,                // { interviews: [{id, role, lives, ...}] }
    interviewPins,             // { placements: [{id, lat, lon, idx, cluster, sub, ...}] }
    timeHist,                  // { labels: [], total: [], by_cluster: {}, by_sub_gid: {} }
    subredditBreakdown,        // { by_cluster: {cl: [{r, n}]}, by_sub_gid: {...} }
    subredditAssignments,      // Uint8Array of length N, subreddit id per point
    subredditNames,            // [{id, name, count}, ...]
    monthAssignments,          // Uint8Array of length N, month idx per point
    monthLabels,               // [label, label, ...]
    positionTimeHist,          // { labels: [], by_position: { "<gid>:<pos>": [counts] } }
    manifest,
    // lazy-loaded per-chunk payload cache, keyed by chunk index → promise
    chunkCache: new Map(),
  };
  return state;
}

// Convenience: the best lat/lon anchor for a cluster label, preferring the
// density-peak over the spherical centroid.
export function clusterAnchor(state, cl) {
  const a = state.anchors?.clusters?.[String(cl)];
  if (a) return { lat: a.lat, lon: a.lon, count: a.count, density: a.density ?? 1, peaks: a.peaks };
  const c = state.centroids?.clusters?.[String(cl)];
  if (c) return { lat: c.lat, lon: c.lon, count: c.count, density: 1, peaks: null };
  return null;
}

export function subAnchor(state, cl, sub) {
  const key = `${cl}_${sub}`;
  const a = state.anchors?.subclusters?.[key];
  if (a) return { lat: a.lat, lon: a.lon, count: a.count, density: a.density ?? 1 };
  const c = state.centroids?.subclusters?.[key];
  if (c) return { lat: c.lat, lon: c.lon, count: c.count, density: 1 };
  return null;
}

function computeCentroids(coords, labels) {
  // Fallback client-side centroid computation by spherical mean.
  const byCluster = new Map();
  const N = coords.length / 2;
  for (let i = 0; i < N; i++) {
    const cl = labels.cluster[i];
    if (cl < 0) continue;
    if (!byCluster.has(cl)) byCluster.set(cl, { x:0, y:0, z:0, n:0 });
    const lat = coords[2*i]; const lon = coords[2*i+1];
    const cl_ = Math.cos(lat);
    const v = byCluster.get(cl);
    v.x += cl_ * Math.cos(lon);
    v.y += Math.sin(lat);
    v.z += cl_ * Math.sin(lon);
    v.n += 1;
  }
  const clusters = {};
  for (const [cl, v] of byCluster) {
    const r = Math.hypot(v.x, v.y, v.z) || 1;
    const x = v.x/r, y = v.y/r, z = v.z/r;
    clusters[cl] = {
      lat: Math.asin(y),
      lon: Math.atan2(z, x),
      count: v.n,
    };
  }
  return { clusters };
}

// Fetch which chunk contains a point index.
export function chunkForIndex(manifest, idx) {
  const cs = manifest.chunkSize;
  return Math.floor(idx / cs);
}

export async function loadChunk(state, chunkIdx) {
  if (state.chunkCache.has(chunkIdx)) return state.chunkCache.get(chunkIdx);
  const fname = state.manifest.files[chunkIdx];
  const p = fetch('tsne_chunks/' + fname).then(r => r.json());
  state.chunkCache.set(chunkIdx, p);
  return p;
}

export async function getPointDetails(state, idx) {
  const cs = state.manifest.chunkSize;
  const ci = Math.floor(idx / cs);
  const c = await loadChunk(state, ci);
  const j = idx - c.offset;
  return {
    idx,
    title: c.title[j] || '',
    body: c.panel_body[j] || c.hover_body[j] || '',
    subreddit: c.subreddit[j] || '',
    permalink: c.permalink[j] || '',
    type: c.type[j],
    score: c.score[j],
    month: c.year_month[j],
    cluster: c.cluster[j],
  };
}

// Subcluster → global "gid" mapping (combines cluster + local sub via subMeta order).
export function buildSubGidMap(subMeta) {
  // Returns: { byLocal: { cl: { sub: gid } }, byGid: { gid: {cl, sub, name} }, total }
  const byLocal = {};
  const byGid = {};
  let gid = 0;
  for (const clStr of Object.keys(subMeta).sort((a,b)=>+a-+b)) {
    const cl = +clStr;
    byLocal[cl] = {};
    for (const e of subMeta[clStr]) {
      byLocal[cl][e.sub] = gid;
      byGid[gid] = { cl, sub: e.sub, name: e.name, cx: e.cx, cy: e.cy };
      gid++;
    }
  }
  return { byLocal, byGid, total: gid };
}

// Cluster counts + ordered list for bar chart.
export function summarizeClusters(state) {
  const counts = new Map();
  for (let i = 0; i < state.N; i++) {
    const cl = state.cluster[i];
    counts.set(cl, (counts.get(cl) || 0) + 1);
  }
  const list = [];
  for (const [cl, n] of counts) {
    const meta = state.clusterMeta[String(cl)];
    if (!meta) continue;
    list.push({ cl, name: meta.name, count: n, color: clusterColor(cl) });
  }
  list.sort((a, b) => b.count - a.count);
  const total = list.reduce((s, d) => s + d.count, 0);
  for (const d of list) d.pct = d.count / total;
  return { list, total };
}

// Per-cluster subcluster counts.
export function summarizeSubs(state, cl, subGidMap) {
  const local = state.subLocal;
  const cluster = state.cluster;
  const counts = new Map();
  for (let i = 0; i < state.N; i++) {
    if (cluster[i] !== cl) continue;
    const s = local[i];
    if (s === 255) continue;
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  const subs = (state.subMeta[String(cl)] || []);
  const list = subs.map(e => {
    const gid = subGidMap.byLocal[cl] ? subGidMap.byLocal[cl][e.sub] : null;
    return {
      cl, sub: e.sub, gid, name: e.name,
      count: counts.get(e.sub) || 0,
    };
  });
  list.sort((a, b) => b.count - a.count);
  const total = list.reduce((s, d) => s + d.count, 0);
  for (const d of list) d.pct = total > 0 ? d.count / total : 0;
  return { list, total };
}

// Global state container attached to window.
export const App = {
  state: null,
  loadingMsg: () => {},
};
window.App = App;

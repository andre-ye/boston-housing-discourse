// search-find — per-post text search across the chunk corpus.

import { ZOOM_TO_POINT_FRAMING } from '../core/constants.js';

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
        p = fetch('tsne_chunks/' + st.manifest.files[ci]).then(r => r.json());
        st.chunkCache.set(ci, p);
      }
      p.then(() => { done++; onProgress?.(done, total); });
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

  App.findPointsContaining = findPointsContaining;
  App.findPointForSnippet = findPointForSnippet;
  App.pinPointByIndex = pinPointByIndex;

  return { ensureAllChunksLoaded, findPointsContaining, findPointForSnippet, pinPointByIndex };
}

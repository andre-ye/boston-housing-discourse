// Per-post text search across the chunk corpus. Loads all 22 chunks once
// (cached forever in chunkCache), then scans title + hover_body for substring
// matches. Heavy first call (~5-15s locally, longer over network); subsequent
// calls are instant.

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
    const targetKey = target.slice(0, 80).toLowerCase();
    const chunks = await ensureAllChunksLoaded();
    for (const chunk of chunks) {
      const offset = chunk.offset;
      const titles = chunk.title || [];
      const hover = chunk.hover_body || [];
      const panel = chunk.panel_body || [];
      for (let i = 0; i < chunk.n; i++) {
        const body = norm((titles[i] || '') + ' ' + (panel[i] || hover[i] || '')).toLowerCase();
        if (body.includes(targetKey) || targetKey.includes(body.slice(0, 80))) {
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
    if (lat != null && lon != null) globe.rotateTo(lat, lon, 1.8);
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

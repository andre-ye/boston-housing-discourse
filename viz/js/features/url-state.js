// URL hash + browser history. Each user-initiated focus change writes a
// history entry so back/forward arrows step through the same exploration
// path. Programmatic restores set `_suppressHashWrite` so applyHash and
// the tour don't poison history with their own beats.

export function init(ctx) {
  const { App, globe, nav, store, focusPosition, toggleSubredditFilter } = ctx;
  let _suppressHashWrite = false;
  let _pendingHashWrite = false;
  let _lastHashWritten = '';

  function _currentStateHash() {
    const parts = [];
    if (nav.focusCl != null) parts.push(`cl=${nav.focusCl}`);
    if (nav.focusGid != null) parts.push(`gid=${nav.focusGid}`);
    if (nav.focusPosIdx != null) parts.push(`pos=${nav.focusPosIdx}`);
    const mr = store.get().filters.monthRange;
    if (mr && Array.isArray(mr) && mr.length === 2) {
      parts.push(`from=${mr[0]}`, `to=${mr[1]}`);
    }
    const si = document.getElementById('search-input');
    if (si && si.value && si.value.trim()) {
      parts.push(`q=${encodeURIComponent(si.value.trim())}`);
    }
    return parts.length ? '#' + parts.join('&') : '';
  }
  function writeHash() {
    if (_suppressHashWrite) { _pendingHashWrite = true; return; }
    if (document.body.classList.contains('tour-active')) return;
    const next = _currentStateHash();
    if (next === _lastHashWritten) return;
    _lastHashWritten = next;
    try {
      history.pushState({ h: next }, '', next || (location.pathname + location.search));
    } catch {
      if (next) location.hash = next.slice(1);
      else if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    }
  }
  function parseHash() {
    const h = location.hash.replace(/^#/, '');
    if (!h) return {};
    const out = {};
    for (const kv of h.split('&')) {
      const [k, v] = kv.split('=');
      if (!v) continue;
      if (k === 'q') {
        try { out.q = decodeURIComponent(v); } catch { out.q = v; }
        continue;
      }
      const n = +v;
      if (Number.isFinite(n)) out[k] = n;
    }
    return out;
  }
  function applyHash() {
    const parsed = parseHash();
    let { cl, gid, pos, from, to, sr, q } = parsed;
    if (cl != null && !App.state.clusterMeta?.[String(cl)]) cl = gid = pos = null;
    if (gid != null && !App.subGidMap?.byGid?.[gid]) gid = pos = null;
    if (pos != null && gid != null) {
      const posList = App.state.positionAnchors?.[String(gid)]?.positions || [];
      if (pos < 0 || pos >= posList.length) pos = null;
    }
    _suppressHashWrite = true;
    try {
      if (cl == null) { nav.focus({}); }
      else if (gid == null) { nav.focus({ cl }); }
      else { nav.focus({ cl, gid }); }
      if (pos != null && gid != null) {
        setTimeout(() => focusPosition(cl, gid, pos), 200);
      }
      if (from != null && to != null) {
        if (window._tlApplyHashRange) window._tlApplyHashRange(from, to);
        else globe.setMonthRange({ lo: from, hi: to });
      } else {
        globe.setMonthRange(null);
      }
      if (sr != null) {
        const name = App.state.subredditNames?.find(n => n.id === sr)?.name;
        if (name) toggleSubredditFilter(sr, name, cl, gid);
      }
      if (q) {
        const si = document.getElementById('search-input');
        if (si && si.value !== q) {
          si.value = q;
          si.dispatchEvent(new Event('input', { bubbles: true }));
          const sugg = document.getElementById('search-suggestions');
          if (sugg) sugg.classList.add('hidden');
        }
      }
    } finally {
      setTimeout(() => {
        _suppressHashWrite = false;
        if (_pendingHashWrite) {
          _pendingHashWrite = false;
          writeHash();
        }
      }, 250);
    }
  }
  App.writeHash = writeHash;
  window.addEventListener('hashchange', applyHash);
  window.addEventListener('popstate', applyHash);
  if (location.hash) setTimeout(applyHash, 300);
  return { writeHash, applyHash, parseHash };
}

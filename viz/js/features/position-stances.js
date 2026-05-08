// position-stances — per-position subreddit breakdown + r/X reverse lookups.

const _posSubCache = new Map();

export function getPositionSubredditCounts(gid, posIdx) {
  const key = `${gid}:${posIdx}`;
  if (_posSubCache.has(key)) return _posSubCache.get(key);
  const st = window.App?.state;
  const table = window.App?._posSubTable;
  if (!table) { _posSubCache.set(key, null); return null; }
  const m = table.get((gid << 8) | posIdx);
  if (!m) { _posSubCache.set(key, null); return null; }
  const names = st?.subredditNames || [];
  const byId = new Map(names.map(r => [r.id, r.name]));
  const arr = [...m.entries()].map(([id, n]) => ({ id, name: byId.get(id) || `id${id}`, n }));
  arr.sort((a, b) => b.n - a.n);
  _posSubCache.set(key, arr);
  return arr;
}

// Shorthand: the top subreddit for a stance (or null if too few attributed
// points). Used on sibling/resonant chips to flag cross-community divides.
export function getPositionDominantSub(gid, posIdx) {
  const arr = getPositionSubredditCounts(gid, posIdx);
  if (!arr || arr.length === 0) return null;
  const total = arr.reduce((s, e) => s + e.n, 0);
  if (total < 5) return null;
  return { ...arr[0], pct: arr[0].n / total, total };
}

// Range-aware "what r/X voiced this period" lookup. Scans the 422k-point
// space once with a month filter, bucketing (gid, posIdx) → {sr count, total}.
// Heavier than the cached all-time variant (~10ms) but only fires on
// filter/range changes.
export function getTopStancesForSubredditInRange(srId, range, limit = 8) {
  const st = window.App?.state;
  const byLocal = window.App?.subGidMap?.byLocal;
  const anchors = st?.positionAnchors;
  if (!st?.cluster || !st.subLocal || !st.positionAssignments || !st.subredditAssignments
      || !st.monthAssignments || !byLocal || !anchors) return [];
  const cluster = st.cluster, subLocal = st.subLocal;
  const pa = st.positionAssignments, sa = st.subredditAssignments, ma = st.monthAssignments;
  const N = cluster.length;
  const hereByKey = new Map();     // sr-matching count
  const totalByKey = new Map();    // total in-range count (all subs)
  const lo = range.lo, hi = range.hi;
  for (let i = 0; i < N; i++) {
    const m = ma[i];
    if (m < lo || m > hi) continue;
    const p = pa[i]; if (p === 255) continue;
    const row = byLocal[cluster[i]]; if (!row) continue;
    const gid = row[subLocal[i]]; if (gid == null) continue;
    const key = (gid << 8) | p;
    totalByKey.set(key, (totalByKey.get(key) || 0) + 1);
    if (sa[i] === srId) hereByKey.set(key, (hereByKey.get(key) || 0) + 1);
  }
  const out = [];
  for (const [key, nHere] of hereByKey.entries()) {
    if (nHere < 3) continue;
    const total = totalByKey.get(key) || 1;
    if (total < 10) continue;
    const share = nHere / total;
    if (share < 0.2) continue;
    const gid = key >> 8;
    const posIdx = key & 0xff;
    const doc = anchors[String(gid)];
    if (!doc) continue;
    const pos = doc.positions?.[posIdx];
    if (!pos) continue;
    const score = share * Math.log(1 + nHere);
    out.push({ gid, posIdx, cl: doc.cl, sub_name: doc.sub_name,
               pos_name: pos.name, description: pos.description || '',
               count: nHere, total, share, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

// All-time variant: ranks by specialization, not just raw share. A 90% r/X
// voice in a sub that's only 50% r/X overall is a stronger signal than
// 90% r/X in a sub that's already 90% r/X (the latter says nothing about
// the stance). Skips monolithic subs (sub_top_share > 0.95) and bonus-scores
// positions whose share *exceeds* their parent sub's baseline.
export function getTopStancesForSubreddit(srId, limit = 8) {
  const table = window.App?._posSubTable;
  const anchors = window.App?.state?.positionAnchors;
  const subData = window.App?.state?.subredditBreakdown?.by_sub_gid;
  if (!table || !anchors) return [];
  const nameMap = new Map((window.App?.state?.subredditNames || []).map(r => [r.id, r.name]));
  const targetName = nameMap.get(srId);
  const out = [];
  for (const [key, m] of table.entries()) {
    const nHere = m.get(srId);
    if (!nHere || nHere < 5) continue;
    let total = 0;
    for (const [, n] of m.entries()) total += n;
    if (total < 20) continue;
    const share = nHere / total;
    if (share < 0.2) continue;
    const gid = key >> 8;
    const posIdx = key & 0xff;
    const doc = anchors[String(gid)];
    if (!doc) continue;
    const pos = doc.positions?.[posIdx];
    if (!pos) continue;
    const subBreakdown = subData?.[String(gid)] || [];
    const subTotal = subBreakdown.reduce((s, e) => s + e.n, 0) || 0;
    const subTop = subTotal ? (subBreakdown[0]?.n || 0) / subTotal : 0;
    if (subTop > 0.95) continue;
    const subEntry = subBreakdown.find(e => e.r === targetName);
    const subBaseShare = subEntry && subTotal ? subEntry.n / subTotal : 0;
    const specialization = subBaseShare > 0.01 ? share / subBaseShare : share / 0.05;
    if (share < 0.5 && specialization < 1.25) continue;
    const score = share * Math.log(1 + nHere) * (0.6 + 0.4 * Math.min(2, specialization));
    out.push({ gid, posIdx, cl: doc.cl, sub_name: doc.sub_name,
               pos_name: pos.name, description: pos.description || '',
               count: nHere, total, share, specialization, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

// Caller-side reposition helper: pin a card next to (cx, cy) without
// running off the parent's edge.
export function positionCard(card, cx, cy) {
  const pad = 14;
  const w = card.offsetWidth || 300;
  const h = card.offsetHeight || 80;
  let x = cx + 16;
  let y = cy + 16;
  const rect = card.parentElement.getBoundingClientRect();
  if (x + w > rect.right - pad) x = cx - w - 16;
  if (y + h > rect.bottom - pad) y = cy - h - 16;
  card.style.left = (x - rect.left) + 'px';
  card.style.top = (y - rect.top) + 'px';
}

// Wiring: loads data, constructs GlobeView + NavController, wires interactions.

import { loadData, App, buildSubGidMap, getPointDetails, clusterColor, SPHERE_PALETTE } from './data.js';
function sphereColor(c) {
  const i = ((c % SPHERE_PALETTE.length) + SPHERE_PALETTE.length) % SPHERE_PALETTE.length;
  return SPHERE_PALETTE[i];
}
import { NavController } from './nav.js';
import { GlobeView } from './globe.js';
import * as THREE from 'three';

const loadingEl = document.getElementById('loading');
const loadingMsg = document.getElementById('loading-msg');

function updateMsg(m) { loadingMsg.textContent = m; }

async function boot() {
  updateMsg('Loading sphere coordinates…');
  try {
    App.state = await loadData(updateMsg);
  } catch (e) {
    console.error(e);
    updateMsg('Failed to load: ' + (e.message || e));
    return;
  }
  App.subGidMap = buildSubGidMap(App.state.subMeta);

  updateMsg(`Building globe from ${App.state.N.toLocaleString()} points…`);

  const canvas = document.getElementById('globe-canvas');

  let nav, globe;
  try {
    nav = new NavController(App.state);
  } catch (e) { console.error('NavController failed:', e); updateMsg('Nav error: ' + e.message); throw e; }
  try {
    globe = new GlobeView(canvas, App.state);
    window.App.globe = globe;
    window.App.nav = nav;
  } catch (e) { console.error('GlobeView failed:', e); updateMsg('Globe error: ' + e.message); throw e; }

  // Hide loader on next macrotask — rAF can be starved by the render loop.
  setTimeout(() => {
    try {
      globe._resize();
      nav.drawRibbons();
      loadingEl.classList.add('gone');
    } catch (e) { console.error('post-mount failed:', e); updateMsg('Post-mount: ' + e.message); }
  }, 60);

  // Nav click → globe rotate + highlight
  nav.addEventListener('focus', (ev) => {
    const { cl, gid, posIdx } = ev.detail;
    globe.setHighlight({ cl, gid, posIdx });
    const focusCard = document.getElementById('focus-card');
    const fkind = document.getElementById('focus-kind');
    const ftitle = document.getElementById('focus-title');
    const fmeta = document.getElementById('focus-meta');

    if (cl == null) {
      globe.rotateTo(0, 0, 3.0, 700);
      focusCard.classList.remove('show');
      globe.loadThreadArcs([]);
      return;
    }
    if (gid == null) {
      const c = (App.state.centroids.clusters || {})[String(cl)];
      if (c) globe.rotateTo(c.lat, c.lon, 2.1);
      const meta = App.state.clusterMeta[String(cl)];
      ftitle.textContent = meta ? meta.name : `Cluster ${cl}`;
      ftitle.style.color = clusterColor(cl);
      fkind.textContent = 'cluster';
      fmeta.textContent = `${(c?.count ?? 0).toLocaleString()} items`;
      focusCard.classList.add('show');
      globe.loadThreadArcs([]);
      return;
    }
    // gid level
    const subs = (App.state.centroids.subclusters || {});
    const g = App.subGidMap.byGid[gid];
    const key = g ? `${g.cl}_${g.sub}` : null;
    const c = key ? subs[key] : null;
    if (c) globe.rotateTo(c.lat, c.lon, 1.7);
    ftitle.textContent = g ? g.name : `Sub ${gid}`;
    ftitle.style.color = clusterColor(g.cl);
    fkind.textContent = 'subtopic';
    fmeta.textContent = `${(c?.count ?? 0).toLocaleString()} items`;
    focusCard.classList.add('show');
    globe.loadThreadArcs([]);
  });

  // Globe hover → point card + thread arcs to siblings
  const pointCard = document.getElementById('point-card');
  let lastHoverIdx = -1;
  globe.addEventListener('hover', async (ev) => {
    const { idx, clientX, clientY } = ev.detail;
    lastHoverIdx = idx;
    if (idx < 0) {
      pointCard.classList.remove('show');
      // Don't clear cluster-level arcs; only clear hover-specific arcs.
      if (globe._hoverArcsActive) restoreFocusThreads();
      return;
    }
    try {
      const details = await getPointDetails(App.state, idx);
      const title = details.title || '(comment)';
      const body = (details.body || '').slice(0, 340);
      const meta = App.state.clusterMeta[String(details.cluster)];
      const catName = meta ? meta.name : `Cluster ${details.cluster}`;
      pointCard.innerHTML = '';
      const cat = document.createElement('div');
      cat.className = 'pc-subreddit';
      cat.style.color = sphereColor(details.cluster);
      cat.textContent = catName;
      pointCard.appendChild(cat);
      const meta2 = document.createElement('div');
      meta2.className = 'pc-subreddit';
      meta2.textContent = `r/${details.subreddit} · ${details.type} · ${details.month} · score ${details.score}`;
      pointCard.appendChild(meta2);
      if (title) {
        const t = document.createElement('div');
        t.className = 'pc-title';
        t.textContent = title;
        pointCard.appendChild(t);
      }
      const b = document.createElement('div');
      b.className = 'pc-body';
      b.textContent = body;
      pointCard.appendChild(b);
      positionCard(pointCard, clientX, clientY);
      pointCard.classList.add('show');
      // Build hover arcs: connect this point to its post (or all comments).
      buildHoverArcs(idx, details);
    } catch (e) {}
  });
  globe.addEventListener('hovermove', (ev) => {
    positionCard(pointCard, ev.detail.clientX, ev.detail.clientY);
  });
  globe.addEventListener('bgclick', () => pointCard.classList.remove('show'));
  globe.addEventListener('pointclick', async (ev) => {
    const details = await getPointDetails(App.state, ev.detail.idx);
    showDetailCard(details);
  });

  // HUD buttons
  const btnThreads = document.getElementById('btn-threads');
  btnThreads.onclick = () => {
    const next = !globe.threadArcsEnabled;
    globe.setThreadsEnabled(next);
    btnThreads.classList.toggle('on', next);
  };
  const btnLabels = document.getElementById('btn-labels');
  btnLabels.onclick = () => {
    labelsEnabled = !labelsEnabled;
    btnLabels.classList.toggle('on', labelsEnabled);
    document.getElementById('globe-labels').style.display = labelsEnabled ? '' : 'none';
  };
  const btnReset = document.getElementById('btn-reset');
  btnReset.onclick = () => { nav.focus({}); };

  // ─── Control pad (arrow + zoom buttons) ─────────────────────────
  const padHandlers = {
    up:    () => globe.nudge(0, -120),
    down:  () => globe.nudge(0, 120),
    left:  () => globe.nudge(-120, 0),
    right: () => globe.nudge(120, 0),
    zoomin:  () => globe.zoom(0.85),
    zoomout: () => globe.zoom(1.18),
  };
  for (const btn of document.querySelectorAll('#ctrlpad .kbkey')) {
    const act = btn.dataset.act;
    let timer = null;
    const tick = () => padHandlers[act]?.();
    btn.onpointerdown = (e) => {
      e.preventDefault();
      tick();
      timer = setInterval(tick, 80);
    };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    btn.onpointerup = stop;
    btn.onpointerleave = stop;
    btn.onpointercancel = stop;
  }

  // ─── Floating cluster + subcluster labels on the globe ─────────
  let labelsEnabled = true;
  const labelSvg = document.getElementById('globe-labels');
  // Build label DOM once.
  const clusterLabelEls = new Map();
  for (const [clStr, meta] of Object.entries(App.state.clusterMeta)) {
    const c = (App.state.centroids.clusters || {})[clStr];
    if (!c) continue;
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.classList.add('lbl-cluster');
    t.textContent = meta.name;
    t.style.fill = sphereColor(+clStr);
    labelSvg.appendChild(t);
    clusterLabelEls.set(+clStr, { el: t, lat: c.lat, lon: c.lon });
  }
  const subLabelEls = new Map();
  function rebuildSubLabels(cl) {
    for (const e of subLabelEls.values()) e.el.remove();
    subLabelEls.clear();
    if (cl == null) return;
    const subs = (App.state.subMeta[String(cl)] || []);
    for (const s of subs) {
      const key = `${cl}_${s.sub}`;
      const c = (App.state.centroids.subclusters || {})[key];
      if (!c) continue;
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.classList.add('lbl-sub');
      t.textContent = s.name;
      labelSvg.appendChild(t);
      subLabelEls.set(key, { el: t, lat: c.lat, lon: c.lon });
    }
  }

  // Each frame: project labels to screen, hide on back-of-sphere, drop overlapping ones.
  const proj = new THREE.Vector3();
  function approxTextSize(text, fontSize) {
    return { w: text.length * fontSize * 0.55, h: fontSize * 1.1 };
  }
  globe._onFrame = () => {
    if (!labelsEnabled) return;
    const w = globe.canvas.clientWidth;
    const h = globe.canvas.clientHeight;
    const camPos = globe.camera.position;
    const showSubs = nav.focusCl != null;
    // Build candidate list with sx, sy, priority
    const placed = [];
    function tryPlace(info, fontSize, priority) {
      const wp = globe.worldPositionOf(info.lat, info.lon, 1.0);
      const facing = wp.x*(camPos.x-wp.x) + wp.y*(camPos.y-wp.y) + wp.z*(camPos.z-wp.z);
      if (facing <= 0) return false;
      proj.copy(wp).project(globe.camera);
      if (proj.z > 1) return false;
      const sx = (proj.x * 0.5 + 0.5) * w;
      const sy = (-proj.y * 0.5 + 0.5) * h;
      const sz = approxTextSize(info.el.textContent || '', fontSize);
      const box = { x0: sx - sz.w/2, x1: sx + sz.w/2, y0: sy - sz.h/2, y1: sy + sz.h/2 };
      for (const p of placed) {
        if (box.x1 < p.x0 || box.x0 > p.x1) continue;
        if (box.y1 < p.y0 || box.y0 > p.y1) continue;
        return false;  // overlap
      }
      placed.push(box);
      info.el.setAttribute('x', sx);
      info.el.setAttribute('y', sy);
      info.el.style.opacity = String(0.6 + 0.4 * Math.min(1, facing / 1.0));
      return true;
    }
    // Pass 1: focused cluster + subclusters first (highest priority).
    if (nav.focusCl != null) {
      const cl = nav.focusCl;
      const focusInfo = clusterLabelEls.get(cl);
      if (focusInfo) tryPlace(focusInfo, 11.5, 0) || (focusInfo.el.style.opacity = '0');
      for (const [, info] of subLabelEls) {
        if (!tryPlace(info, 10.5, 1)) info.el.style.opacity = '0';
      }
    }
    // Pass 2: all other cluster labels (lower priority — drop on overlap).
    for (const [cl, info] of clusterLabelEls.entries()) {
      if (showSubs && cl === nav.focusCl) continue;
      if (showSubs) { info.el.style.opacity = '0'; continue; }
      if (!tryPlace(info, 11.5, 2)) info.el.style.opacity = '0';
    }
  };

  // ─── Hover arcs (per-point thread connections) ────────────────
  let lastFocusFilter = null;
  let hoverEpoch = 0;
  async function buildHoverArcs(idx, details) {
    const myEpoch = ++hoverEpoch;
    const st = App.state;
    const m = (details.permalink || '').match(/\/comments\/([a-z0-9]+)\//);
    const postId = m ? m[1] : null;
    if (!postId) { restoreFocusThreads(); return; }
    const postIdx = await buildPostIndex();
    if (myEpoch !== hoverEpoch) return;
    const pIdx = postIdx.get(postId);   // may be undefined (post filtered out)

    // Collect all sibling members of this thread (comments + post if present),
    // then draw arcs FROM the hovered point to each sibling. This works even
    // when the original post isn't in the dataset.
    const siblings = await siblingsForThread(postId);
    if (myEpoch !== hoverEpoch) return;
    const pairs = [];
    const anchor = pIdx != null ? pIdx : idx;
    for (const s of siblings) {
      if (s === anchor) continue;
      pairs.push([anchor, s]);
    }
    if (anchor !== idx) pairs.push([anchor, idx]);
    if (pairs.length === 0) { restoreFocusThreads(); return; }
    globe.loadThreadArcs(pairs.slice(0, 200));
    globe._hoverArcsActive = true;
  }

  // Cache: postId → [point indices] (any point whose permalink references that post)
  const siblingsCache = new Map();
  async function siblingsForThread(postId) {
    if (siblingsCache.has(postId)) return siblingsCache.get(postId);
    const st = App.state;
    const out = [];
    for (let ci = 0; ci < st.manifest.files.length; ci++) {
      let p = st.chunkCache.get(ci);
      if (!p) {
        p = fetch('tsne_chunks/' + st.manifest.files[ci]).then(r => r.json());
        st.chunkCache.set(ci, p);
      }
      const c = await p;
      const off = c.offset;
      for (let j = 0; j < c.n; j++) {
        const m = (c.permalink[j] || '').match(/\/comments\/([a-z0-9]+)\//);
        if (m && m[1] === postId) out.push(off + j);
      }
    }
    siblingsCache.set(postId, out);
    return out;
  }
  function restoreFocusThreads() {
    hoverEpoch++;             // cancel any pending arc build
    globe._hoverArcsActive = false;
    globe.loadThreadArcs([]);
  }
  // Cache per-post comment list
  const commentsCache = new Map();
  async function commentsForPost(postId, pIdx) {
    if (commentsCache.has(postId)) return commentsCache.get(postId);
    const st = App.state;
    const out = [];
    // Brute-force: scan loaded chunks for matching post id.
    for (let ci = 0; ci < st.manifest.files.length; ci++) {
      let p = st.chunkCache.get(ci);
      if (!p) continue; // skip non-loaded chunks for hover speed
      const c = await p;
      const off = c.offset;
      for (let j = 0; j < c.n; j++) {
        if (c.type[j] === 'submission' || c.type[j] === 'post') continue;
        const m = (c.permalink[j] || '').match(/\/comments\/([a-z0-9]+)\//);
        if (m && m[1] === postId) out.push([pIdx, off + j]);
      }
    }
    commentsCache.set(postId, out);
    return out;
  }

  // ─── Detail card ───────────────────────────────────────────────
  const dc = document.getElementById('detail-card');
  const dcMeta = document.getElementById('dc-meta');
  const dcTitle = document.getElementById('dc-title');
  const dcBody = document.getElementById('dc-body');
  const dcLink = document.getElementById('dc-link');
  document.getElementById('dc-close').onclick = () => dc.classList.add('hidden');
  function showDetailCard(d) {
    dcMeta.textContent = `r/${d.subreddit} · ${d.type} · ${d.month} · score ${d.score}`;
    dcTitle.textContent = d.title || (d.type === 'comment' ? '(comment)' : '(submission)');
    dcBody.textContent = (d.body || '').slice(0, 1600);
    if (d.permalink) { dcLink.href = d.permalink; dcLink.style.display = ''; }
    else dcLink.style.display = 'none';
    dc.classList.remove('hidden');
  }

  // Re-render sub labels when focus changes.
  nav.addEventListener('focus', (ev) => rebuildSubLabels(ev.detail.cl));

  // ─────────────────────────────────────────────────────────────────
  // Thread arc building: for a focused cluster or subtopic, pair each
  // comment with its parent post (by permalink base path).
  async function loadThreads(filter) {
    lastFocusFilter = filter;
    if (!filter) { globe.loadThreadArcs([]); return; }
    const pairs = await buildThreadPairs(filter);
    globe.loadThreadArcs(pairs.slice(0, 2500));
  }

  // Load pre-baked post-id → point-index map. Falls back to scanning chunks if missing.
  let postIndexPromise = null;
  async function buildPostIndex() {
    if (postIndexPromise) return postIndexPromise;
    postIndexPromise = (async () => {
      try {
        const r = await fetch('tsne_chunks/post_index.json');
        if (r.ok) {
          const d = await r.json();
          const m = new Map();
          for (let i = 0; i < d.ids.length; i++) m.set(d.ids[i], d.idx[i]);
          return m;
        }
      } catch (e) {}
      const st = App.state;
      const idx = new Map();
      for (let ci = 0; ci < st.manifest.files.length; ci++) {
        const c = await (st.chunkCache.get(ci) || (() => {
          const p = fetch('tsne_chunks/' + st.manifest.files[ci]).then(r => r.json());
          st.chunkCache.set(ci, p);
          return p;
        })());
        const off = c.offset;
        for (let j = 0; j < c.n; j++) {
          if (c.type[j] !== 'submission' && c.type[j] !== 'post') continue;
          const m = (c.permalink[j] || '').match(/\/comments\/([a-z0-9]+)\//);
          if (m) idx.set(m[1], off + j);
        }
      }
      return idx;
    })();
    return postIndexPromise;
  }

  const threadCache = new Map();
  async function buildThreadPairs(filter) {
    const key = filter.sub != null ? `${filter.cl}_${filter.sub}` : `${filter.cl}`;
    if (threadCache.has(key)) return threadCache.get(key);
    const st = App.state;
    const postIdx = await buildPostIndex();

    const members = [];
    for (let i = 0; i < st.N; i++) {
      if (st.cluster[i] !== filter.cl) continue;
      if (filter.sub != null && st.subLocal[i] !== filter.sub) continue;
      members.push(i);
    }
    // Group by chunk to minimize re-fetches; chunk cache is populated.
    const cs = st.manifest.chunkSize;
    const byChunk = new Map();
    for (const idx of members) {
      const ci = Math.floor(idx / cs);
      if (!byChunk.has(ci)) byChunk.set(ci, []);
      byChunk.get(ci).push(idx);
    }
    const pairs = [];
    const seen = new Set();
    for (const [ci, idxs] of byChunk) {
      let chunkPromise = st.chunkCache.get(ci);
      if (!chunkPromise) {
        chunkPromise = fetch('tsne_chunks/' + st.manifest.files[ci]).then(r => r.json());
        st.chunkCache.set(ci, chunkPromise);
      }
      const chunk = await chunkPromise;
      const off = chunk.offset;
      for (const idx of idxs) {
        const j = idx - off;
        const perm = chunk.permalink[j] || '';
        const type = chunk.type[j];
        const m = perm.match(/\/comments\/([a-z0-9]+)\//);
        if (!m) continue;
        const pid = m[1];
        if (type === 'submission' || type === 'post') continue; // only draw post→comment lines
        const postI = postIdx.get(pid);
        if (postI == null || postI === idx) continue;
        const k = `${postI}-${idx}`;
        if (seen.has(k)) continue;
        seen.add(k);
        pairs.push([postI, idx]);
        if (pairs.length >= 3000) break;
      }
      if (pairs.length >= 3000) break;
    }
    threadCache.set(key, pairs);
    return pairs;
  }
}

function positionCard(card, cx, cy) {
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

boot().catch(e => {
  console.error('boot crashed:', e);
  updateMsg('Boot crashed: ' + (e?.message || e));
});

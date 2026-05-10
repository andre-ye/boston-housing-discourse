// Wiring: loads data, constructs GlobeView + NavController, wires interactions.

import { loadData, App, buildSubGidMap, getPointDetails, clusterColor, SPHERE_PALETTE, CLUSTER_PALETTE, clusterAnchor, subAnchor, latLonToXYZ, prefetchAllChunks } from './data.js';
import { NavController } from './nav.js';
import { GlobeView } from './globe.js';
import { dom } from './core/dom.js';
import { storage } from './core/storage.js';
import { raf } from './core/raf.js';
import { keys } from './core/keys.js';
import { store } from './core/store.js';
import {
  POINT_RADIUS, DEFAULT_DISTANCE,
  TOPIC_FRAMING, SUB_FRAMING, STANCE_FRAMING, CLOSE_FRAMING, ZOOM_TO_POINT_FRAMING,
  SPROUT_EDGE_TRIM_FRAC, SPROUT_MAX_WIDTH_PX, SPROUT_BODY_MAX_CHARS,
  SPROUT_CARD_GAP_PX, SPROUT_VIEWPORT_MARGIN_PX,
  SPROUT_DISC_FRAC, SPROUT_DISC_RING_OFFSET_PX,
} from './core/constants.js';
import * as THREE from 'three';
import { escapeHtml, redditScoreInlineHtml, formatRedditKindLabel, highlightSearchHits, getActiveSearchParsed } from './features/html-utils.js';
import {
  renderSparklineBySeries,
  updateSparklineBands, initSparklineHover,
} from './features/sparklines.js';
import {
  computeTrend,
  getPositionSeries, getTrendInfo,
} from './features/series.js';
import {
  getTopStancesForSubredditInRange, getTopStancesForSubreddit, positionCard,
} from './features/position-stances.js';
import { init as initIdleRotate } from './features/idle-rotate.js';
import { init as initTimeline } from './features/timeline.js';
import { init as initSearchFind } from './features/search-find.js';
import { init as initSurprise } from './features/surprise.js';
import { init as initUrlState } from './features/url-state.js';

function sphereColor(c) {
  const i = ((c % SPHERE_PALETTE.length) + SPHERE_PALETTE.length) % SPHERE_PALETTE.length;
  return SPHERE_PALETTE[i];
}

// One-time global wiring for sparkline body-delegated handlers (idempotent).
initSparklineHover();

const loadingEl = document.getElementById('loading');
const loadingMsg = document.getElementById('loading-msg');

function updateMsg(m) { loadingMsg.textContent = m; }

// Drag-to-resize the left rail (#22). Default width is whatever index.html
// sets (--nav-w: 340px); when the user drags, persist the new width to
// storage under the existing 'pref' JSON key so it survives reloads. The
// globe re-fits on its own via its ResizeObserver, so no callback wiring
// is needed downstream.
const NAV_W_MIN = 320;
const NAV_W_MAX_FRAC = 0.55;   // never more than 55% of viewport
const NAV_W_PINNED_DEFAULT = 540; // ~1.6× the 340 default when pinned (#22)
function _setNavWidth(px) {
  const max = Math.floor(window.innerWidth * NAV_W_MAX_FRAC);
  const w = Math.max(NAV_W_MIN, Math.min(max, Math.round(px)));
  document.documentElement.style.setProperty('--nav-w', w + 'px');
  return w;
}
function _readNavPref() {
  const p = storage.getJSON('pref', {}) || {};
  return typeof p.navWidth === 'number' ? p.navWidth : null;
}
function _writeNavPref(w) {
  const p = storage.getJSON('pref', {}) || {};
  p.navWidth = w;
  storage.setJSON('pref', p);
}
function initNavResizeHandle() {
  const saved = _readNavPref();
  if (saved != null) _setNavWidth(saved);
  const handle = document.getElementById('nav-resize-handle');
  const navEl = document.getElementById('nav');
  const pinnedEl = document.getElementById('pinned-view');
  if (!handle || !navEl) return;
  // Lift the nav.css 34% cap so the user's chosen width applies up to our
  // own 55% clamp; we intentionally don't touch nav.css here.
  navEl.style.maxWidth = (NAV_W_MAX_FRAC * 100).toFixed(0) + 'vw';
  // When a pin opens and the user has no saved width, bump to a comfortable
  // reading width so the post + replies have room to breathe.
  if (pinnedEl && saved == null) {
    const mo = new MutationObserver(() => {
      if (!pinnedEl.classList.contains('hidden') && _readNavPref() == null) {
        _setNavWidth(NAV_W_PINNED_DEFAULT);
      }
    });
    mo.observe(pinnedEl, { attributes: true, attributeFilter: ['class'] });
  }
  let dragging = false;
  let pointerId = null;
  const onMove = (e) => {
    if (!dragging) return;
    const navRect = navEl.getBoundingClientRect();
    _setNavWidth(e.clientX - navRect.left);
  };
  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    navEl.style.transition = '';
    try { handle.releasePointerCapture(pointerId); } catch {}
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-w'));
    if (!isNaN(cur)) _writeNavPref(cur);
  };
  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    pointerId = e.pointerId;
    handle.classList.add('dragging');
    document.body.style.cursor = 'ew-resize';
    // Kill the nav.css width transition so drag feels live, not laggy.
    navEl.style.transition = 'none';
    try { handle.setPointerCapture(pointerId); } catch {}
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    e.preventDefault();
  });
  // Double-click resets to the default width.
  handle.addEventListener('dblclick', () => {
    _setNavWidth(NAV_W_PINNED_DEFAULT);
    _writeNavPref(NAV_W_PINNED_DEFAULT);
  });
}

// Shared #info-tooltip wired to every .pane-header-info button. We use one
// page-level fixed element instead of per-button ::after so the tooltip
// renders at popup tier and escapes the nav's overflow:hidden — otherwise
// it gets clipped inside the nav and never floats over the globe.
function initInfoTooltip() {
  const tip = document.getElementById('info-tooltip');
  if (!tip) return;
  let activeBtn = null;
  function show(btn) {
    const text = btn.getAttribute('data-tooltip');
    if (!text) return;
    activeBtn = btn;
    tip.textContent = text;
    // Position below + slightly right of the button. Clamp into the
    // viewport so the tooltip never overflows off-screen at any nav width.
    const r = btn.getBoundingClientRect();
    // Render once invisibly to measure.
    tip.style.left = '0px';
    tip.style.top = '0px';
    tip.classList.add('show');
    tip.setAttribute('aria-hidden', 'false');
    const tipRect = tip.getBoundingClientRect();
    const margin = 8;
    let left = r.left;
    let top = r.bottom + 6;
    if (left + tipRect.width + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - tipRect.width - margin);
    }
    if (top + tipRect.height + margin > window.innerHeight) {
      top = Math.max(margin, r.top - tipRect.height - 6);
    }
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
  function hide() {
    activeBtn = null;
    tip.classList.remove('show');
    tip.setAttribute('aria-hidden', 'true');
  }
  document.addEventListener('pointerover', (e) => {
    const btn = e.target?.closest?.('.pane-header-info');
    if (btn && btn !== activeBtn) show(btn);
  });
  document.addEventListener('pointerout', (e) => {
    const btn = e.target?.closest?.('.pane-header-info');
    if (!btn) return;
    // Hide when the pointer actually leaves the button (relatedTarget is
    // outside it). Avoid hiding when moving across the icon's children.
    if (e.relatedTarget && btn.contains(e.relatedTarget)) return;
    hide();
  });
  document.addEventListener('focusin', (e) => {
    const btn = e.target?.closest?.('.pane-header-info');
    if (btn) show(btn);
  });
  document.addEventListener('focusout', (e) => {
    const btn = e.target?.closest?.('.pane-header-info');
    if (btn === activeBtn) hide();
  });
  // Reposition on scroll/resize so the tooltip tracks its anchor.
  window.addEventListener('scroll', () => { if (activeBtn) show(activeBtn); }, true);
  window.addEventListener('resize', () => { if (activeBtn) show(activeBtn); });
}

// Vertical split between #nav-top (Topics) and #insp-body (Details Viewer).
// User drags #nav-vsplit-handle up/down to change how much of the nav each
// pane occupies. Saved as a percent (0..1) of the nav's inner height.
const VSPLIT_KEY = 'navVSplitFrac';
const VSPLIT_MIN = 0.18;
const VSPLIT_MAX = 0.82;
function _readVSplitPref() {
  try { const v = parseFloat(localStorage.getItem(VSPLIT_KEY)); return isNaN(v) ? null : v; }
  catch { return null; }
}
function _writeVSplitPref(frac) {
  try { localStorage.setItem(VSPLIT_KEY, String(frac)); } catch {}
}
function _applyVSplit(frac) {
  const top = document.getElementById('nav-top');
  const bot = document.getElementById('insp-body');
  if (!top || !bot) return;
  const f = Math.max(VSPLIT_MIN, Math.min(VSPLIT_MAX, frac));
  // Use percent flex-basis so the two panes still total to 100% of the
  // nav's inner height regardless of viewport / handle thickness.
  top.style.flex = `0 0 ${(f * 100).toFixed(2)}%`;
  bot.style.flex = `0 0 ${((1 - f) * 100).toFixed(2)}%`;
}
function initNavVSplit() {
  const handle = document.getElementById('nav-vsplit-handle');
  const navEl  = document.getElementById('nav');
  const top    = document.getElementById('nav-top');
  if (!handle || !navEl || !top) return;
  const saved = _readVSplitPref();
  if (saved != null) _applyVSplit(saved);
  let dragging = false, pid = null;
  const navInnerTop = () => navEl.getBoundingClientRect().top;
  const navInnerHeight = () => navEl.getBoundingClientRect().height;
  const onMove = (e) => {
    if (!dragging) return;
    const y = e.clientY - navInnerTop();
    const h = navInnerHeight();
    if (h <= 0) return;
    _applyVSplit(y / h);
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    navEl.classList.remove('vsplit-dragging');
    document.body.classList.remove('nav-vsplit-dragging');
    try { handle.releasePointerCapture(pid); } catch {}
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    const tFlex = parseFloat((top.style.flex || '').match(/(\d+(?:\.\d+)?)%/)?.[1]);
    if (!isNaN(tFlex)) _writeVSplitPref(tFlex / 100);
  };
  handle.addEventListener('pointerdown', (e) => {
    dragging = true; pid = e.pointerId;
    navEl.classList.add('vsplit-dragging');
    document.body.classList.add('nav-vsplit-dragging');
    try { handle.setPointerCapture(pid); } catch {}
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    e.preventDefault();
  });
  // Double-click resets to 50/50.
  handle.addEventListener('dblclick', () => {
    _applyVSplit(0.5);
    _writeVSplitPref(0.5);
  });
}

async function boot() {
  // Initialize core infrastructure first: storage migrates legacy keys
  // before any feature reads them; dom warms its element cache.
  storage.init();
  dom.init();
  keys.init();
  initNavResizeHandle();
  initNavVSplit();
  initInfoTooltip();
  updateMsg('Loading sphere coordinates…');
  try {
    App.state = await loadData(updateMsg);
  } catch (e) {
    console.error(e);
    // Attach a retry link so users hitting a transient fetch failure can
    // recover without reaching for the browser refresh. Uses textContent
    // plus an <a> node to avoid any innerHTML-injection of the error body.
    loadingMsg.textContent = 'Failed to load: ' + (e.message || e);
    const retry = document.createElement('a');
    retry.href = location.href;
    retry.textContent = 'retry';
    retry.style.cssText = 'display:inline-block;margin-top:10px;color:var(--accent);text-decoration:underline;cursor:pointer';
    retry.onclick = (ev) => { ev.preventDefault(); location.reload(); };
    loadingMsg.appendChild(document.createElement('br'));
    loadingMsg.appendChild(retry);
    return;
  }
  App.subGidMap = buildSubGidMap(App.state.subMeta);

  // Corpus-level growth ratio (recent 6 months / prior months). Used to
  // normalize per-series trends so "surging" means "faster than the
  // overall conversation is growing," not "has more recent data."
  // Without this, the Reddit corpus's own 2.2× growth over the window
  // makes nearly every sub/cluster read as ▲ and the marker becomes noise.
  (() => {
    const total = App.state.timeHist?.total || [];
    if (total.length < 12) { App._corpusRatio = 1; return; }
    const n = total.length;
    const rc = total.slice(n - 6).reduce((a, v) => a + v, 0) / 6;
    const bs = total.slice(0, n - 6).reduce((a, v) => a + v, 0) / (n - 6);
    App._corpusRatio = rc / Math.max(0.8, bs);
  })();

  // One-time scan of 422k points building a (gid,pos) → Map<srId,count>
  // table so the position card, sibling chips and resonant chips can all
  // cheaply answer "whose voice is this?" without each reopening a full
  // scan. ~50 ms on load, then O(1) lookups forever.
  (() => {
    const st = App.state;
    if (!st.positionAssignments || !st.subredditAssignments) return;
    const cluster = st.cluster, subLocal = st.subLocal;
    const pa = st.positionAssignments, sa = st.subredditAssignments;
    const N = cluster.length;
    const byLocal = App.subGidMap.byLocal;
    const table = new Map();
    for (let i = 0; i < N; i++) {
      const p = pa[i];
      if (p === 255) continue;
      const row = byLocal[cluster[i]];
      if (!row) continue;
      const gid = row[subLocal[i]];
      if (gid == null) continue;
      const sr = sa[i];
      if (sr === 255) continue;
      const key = (gid << 8) | p;
      let m = table.get(key);
      if (!m) { m = new Map(); table.set(key, m); }
      m.set(sr, (m.get(sr) || 0) + 1);
    }
    App._posSubTable = table;
  })();

  // ─── Palette reorder for max perceptual distinctness (#50) ────────
  // The 25-color sphere palette in data.js is hand-tuned but cluster IDs
  // are assigned in arbitrary frequency-rank order, so adjacent topics in
  // the sidebar can end up with near-identical hues (two muted blues,
  // two greens, etc.). Reorder the palette in place so the LARGEST
  // clusters get the most perceptually-distinct colors first.
  //
  // Algorithm: rank clusters by post count, then greedily assign each
  // rank the unused palette color whose HSL hue is farthest from the
  // colors already assigned to the prior K ranks. The greedy pass alone
  // is myopic — rank 9 only checks ranks 1..8, so it can land on a near-
  // duplicate of rank 0 (two blues at the top of the visible L1 stack).
  // After the greedy seed we run a small swap-based local-search pass
  // over the top T ranks: for every pair (i,j) in 1..T, try swapping and
  // keep the swap if it raises the minimum pairwise hue distance inside
  // any sliding W-rank window across 0..T-1. Iterates to a local optimum
  // (typically <5 passes; ~T² swaps each, each O(W) — cheap, runs once
  // at boot). Mutates SPHERE_PALETTE in-place — clusterColor() reads
  // through this same array so all downstream callers (globe, nav,
  // sparklines) see the reordered palette without further wiring.
  (() => {
    const meta = App.state.clusterMeta || {};
    const ranks = Object.keys(meta)
      .map(k => ({ cl: +k, count: meta[k]?.count || 0 }))
      .filter(r => Number.isInteger(r.cl))
      .sort((a, b) => b.count - a.count)
      .map(r => r.cl);
    if (!ranks.length) return;
    // Hue extraction for perceptual distance — we mostly care about hue
    // separation between large clusters, so HSL h is a fine proxy and
    // way faster than full LAB conversion. Ties broken by lightness so
    // a near-duplicate hue at very different lightness still scores
    // well.
    const rgbToHsl = (hex) => {
      const v = parseInt(hex.slice(1), 16);
      const r = ((v >> 16) & 255) / 255;
      const g = ((v >> 8) & 255) / 255;
      const b = (v & 255) / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const l = (mx + mn) / 2;
      let h = 0, s = 0;
      if (mx !== mn) {
        const d = mx - mn;
        s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
        if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
      }
      return [h, s, l];
    };
    const palette = SPHERE_PALETTE.slice();
    const paletteHsl = palette.map(rgbToHsl);
    const N = palette.length;
    const distHsl = (a, b) => {
      let dh = Math.abs(a[0] - b[0]);
      if (dh > 180) dh = 360 - dh;
      const dl = Math.abs(a[2] - b[2]) * 90;   // 0..90 in same scale as hue degrees
      return Math.hypot(dh, dl * 0.5);
    };
    // Greedy: for each cluster rank r, pick the unused palette index
    // that maximizes the minimum distance to the last K used hues. K=10
    // covers the full visible band of the L1 stack so rank 10 won't
    // accidentally collide with rank 0.
    const K = 10;
    const used = new Array(N).fill(false);
    const assigned = []; // assigned[r] = palette index for ranks[r]
    // First rank: keep palette[0]. Anchors the largest cluster's color
    // across loads.
    assigned.push(0); used[0] = true;
    for (let r = 1; r < ranks.length && r < N; r++) {
      const recent = assigned.slice(Math.max(0, r - K)).map(i => paletteHsl[i]);
      let bestIdx = -1, bestScore = -Infinity;
      for (let i = 0; i < N; i++) {
        if (used[i]) continue;
        let minD = Infinity;
        for (const h of recent) {
          const d = distHsl(paletteHsl[i], h);
          if (d < minD) minD = d;
        }
        if (minD > bestScore) { bestScore = minD; bestIdx = i; }
      }
      if (bestIdx < 0) break;
      assigned.push(bestIdx);
      used[bestIdx] = true;
    }
    // Swap-based local search over the top T ranks. Score = the smallest
    // pairwise hue distance found inside any W-rank sliding window over
    // 0..T-1. We keep a swap iff it strictly raises that score, so the
    // worst within-window collision in the visible band keeps shrinking.
    // The seed (rank 0) is pinned so the largest cluster's color is
    // stable.
    const T = Math.min(16, assigned.length);
    const W = 10;
    const score = (arr) => {
      let worst = Infinity;
      for (let i = 0; i < T; i++) {
        const lim = Math.min(i + W, T);
        for (let j = i + 1; j < lim; j++) {
          const d = distHsl(paletteHsl[arr[i]], paletteHsl[arr[j]]);
          if (d < worst) worst = d;
        }
      }
      return worst;
    };
    let improved = true;
    let guard = 0;
    while (improved && guard++ < 50) {
      improved = false;
      let cur = score(assigned);
      for (let i = 1; i < T; i++) {
        for (let j = i + 1; j < T; j++) {
          const tmp = assigned[i]; assigned[i] = assigned[j]; assigned[j] = tmp;
          const next = score(assigned);
          if (next > cur + 1e-9) { cur = next; improved = true; }
          else { assigned[j] = assigned[i]; assigned[i] = tmp; }
        }
      }
    }
    // Build the new palette ordering: position c in palette ← whichever
    // palette index was assigned to the cluster whose ID = c. (Cluster
    // IDs may not be 0..N-1 contiguous, so we fall back to identity for
    // any cluster ID we don't see in clusterMeta or that exceeds palette
    // length.)
    const newPalette = palette.slice();
    for (let r = 0; r < ranks.length && r < N; r++) {
      const cl = ranks[r];
      if (cl < 0 || cl >= N) continue;
      newPalette[cl % N] = palette[assigned[r]];
    }
    // Mutate SPHERE_PALETTE + CLUSTER_PALETTE in place. Both exported
    // const bindings point at distinct arrays (data.js does
    // CLUSTER_PALETTE = SPHERE_PALETTE.slice()) so we must update each.
    // Downstream callers — globe.js (raw SPHERE_PALETTE + clusterColor),
    // nav.js (clusterColor → CLUSTER_PALETTE), main.js sphereColor —
    // all read live from these arrays.
    for (let i = 0; i < N; i++) {
      SPHERE_PALETTE[i] = newPalette[i];
      if (CLUSTER_PALETTE && i < CLUSTER_PALETTE.length) CLUSTER_PALETTE[i] = newPalette[i];
    }
  })();

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

  // Build interview P-pins eagerly — they're needed by tour beat 2
  // ("interview-pins") which can be reached as soon as the user clicks
  // Begin on the hero. The richer voices list + click handlers below
  // still wire up later in boot.
  try {
    globe.setInterviewPins(App.state.interviewPins?.placements || [], App.state.interviews);
  } catch (e) { console.warn('setInterviewPins (early) failed:', e); }

  // Guided tour — Atlantic-style opener + three cluster beats. The hero with
  // "Begin tour" / "Explore" auto-opens on every cold load (no #hash); deep
  // links bypass it. The launcher pill is always available to re-open it.
  try {
    const { createTour } = await import('./tour/index.js');
    const tour = createTour({ globe, App, nav });
    window.App.tour = tour;
    const launcherEl = document.getElementById('tour-launcher');
    if (launcherEl) {
      launcherEl.classList.remove('hidden-until-completed');
      launcherEl.style.display = '';
      launcherEl.addEventListener('click', () => tour.start());
    }
    // Cold load auto-opens the tour. Deep-links (#cl=…) skip it. The inline
    // boot script in index.html may have already painted the hero overlay
    // before this module loaded — calling start() here is idempotent.
    //
    // Boot-flash gate: drop body.app-loading only AFTER the tour overlay's
    // own body classes are in place (start() applies tour-active +
    // tour-at-hero). Without this ordering the static sidebar would paint
    // for one frame between boot and the tour grabbing it.
    if (!location.hash) tour.start();
    document.body.classList.remove('app-loading');
  } catch (e) {
    console.warn('tour init failed:', e);
    // Tour failed — release the boot gate so the user isn't stuck on a
    // blank sidebar. The loading overlay's own dismissal still runs.
    document.body.classList.remove('app-loading');
  }

  // Empty-state + intro is the idle content of the bottom (details) pane.
  // Make sure it's parented to #insp-body — older sessions may have moved it
  // out under the previous "#insp-body is display:none" layout.
  const inspBodyMount = document.getElementById('insp-body');
  const inspEmptyMount = document.getElementById('insp-empty-main');
  if (inspEmptyMount && inspBodyMount && inspEmptyMount.parentElement !== inspBodyMount) {
    inspBodyMount.insertBefore(inspEmptyMount, inspBodyMount.firstChild);
  }

  // Dismiss the loader after the globe has actually rendered its first
  // frame — observable via renderer.info.render.calls incrementing. Polls
  // at rAF cadence with a hard cap so we always clear the splash.
  const dismissLoader = () => {
    try {
      globe._resize();
      nav.drawRibbons();
      loadingEl.classList.add('gone');
    } catch (e) { console.error('post-mount failed:', e); updateMsg('Post-mount: ' + e.message); }
  };
  (() => {
    let done = false;
    const finish = () => { if (!done) { done = true; dismissLoader(); } };
    let frames = 0;
    const waitForFrame = () => {
      if (done) return;
      const calls = globe.renderer?.info?.render?.calls ?? 0;
      if (calls > 0 || ++frames >= 20) finish();
      else requestAnimationFrame(waitForFrame);
    };
    requestAnimationFrame(waitForFrame);
    // Safety net — rAF is throttled in backgrounded tabs; clear the
    // splash within 500ms even if no frame has rendered.
    setTimeout(finish, 500);
  })();

  // Forward declaration: assigned after url-state.init() runs later in boot.
  // Many features call writeHash() opportunistically; they all guard with
  // `typeof writeHash === 'function'` so early calls are no-ops until then.
  let writeHash;

  // ─── Idle-time chunk prefetch ───────────────────────────────────
  // Globe is up; warm state.chunkCache in the background so the first
  // hover/search post-load doesn't pay a 200–800ms round-trip on slow
  // connections. One chunk per idle tick, no parallel burst. Skipped
  // entirely if the user is on a Save-Data connection.
  try { prefetchAllChunks(App.state); } catch (e) { /* non-fatal */ }

  // ─── Idle auto-rotate ───────────────────────────────────────────
  initIdleRotate({ globe, nav, keys, raf });

  function _rangeSum(series, lo, hi) {
    let s = 0;
    const end = Math.min(hi, series.length - 1);
    for (let i = Math.max(0, lo); i <= end; i++) s += series[i] || 0;
    return s;
  }

  // ─── Focus → globe rotate + highlight ────────────────────────────
  // The focus-card mini-dashboard that used to render here has been
  // removed. Topic / subtopic / stance clicks still drive the globe
  // (rotate + spotlight via nav.addEventListener('focus', ...) below);
  // the details viewer pane only fills in response to explicit point /
  // P-pin clicks on the globe.

  // Active subreddit filter state + chip UI in the nav header.
  let _activeSubredditFilter = null;   // { id, name }
  window.App.toggleSubredditFilter = (...args) => toggleSubredditFilter(...args);
  window.App.clearSubredditFilter = () => clearSubredditFilter();
  window.App.hasSubredditFilter = () => !!_activeSubredditFilter;
  function clearSubredditFilter() {
    if (!_activeSubredditFilter) return false;
    _activeSubredditFilter = null;
    globe.setSubredditHighlight(null);
    _updateSubredditFilterChip();
    if (typeof writeHash === 'function') writeHash();
    return true;
  }
  function toggleSubredditFilter(id, name, contextCl, contextGid) {
    if (_activeSubredditFilter && _activeSubredditFilter.id === id) {
      clearSubredditFilter();
      return;
    }
    _activeSubredditFilter = { id, name };
    const clSet = contextCl != null ? new Set([contextCl]) : null;
    const g = contextGid != null ? App.subGidMap.byGid[contextGid] : null;
    const subSet = g ? new Set([`${g.cl}_${g.sub}`]) : null;
    globe.setSubredditHighlight(new Set([id]), { extraClusters: clSet, extraSubs: subSet });
    _updateSubredditFilterChip();
    if (typeof writeHash === 'function') writeHash();
  }
  function _updateSubredditFilterChip() {
    const header = document.getElementById('nav-header');
    let chip = document.getElementById('sr-filter-chip');
    if (!_activeSubredditFilter) {
      chip?.remove();
      document.getElementById('sr-agenda-panel')?.remove();
      return;
    }
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'sr-filter-chip';
      chip.className = 'sr-filter-chip';
      header?.appendChild(chip);
    }
    // Count currently-bright points so the user sees the intersection
    // result (with any active cluster/sub focus already composed in).
    let bright = 0;
    const dim = globe.pointGeom?.attributes?.dim?.array;
    if (dim) { for (let i = 0; i < dim.length; i++) if (dim[i] >= 0.9) bright++; }
    chip.innerHTML = `<span><b>${bright.toLocaleString()}</b> in <b>r/${escapeHtml(_activeSubredditFilter.name)}</b></span><button class="sr-x" aria-label="Clear">×</button>`;
    chip.querySelector('.sr-x').onclick = () => {
      clearSubredditFilter();
    };
    _renderSubredditAgendaPanel();
  }

  // "What r/X voices most" — shown directly below the filter chip. Surfaces
  // the stances where this community dominates the conversation, turning a
  // simple dim-filter into a community-study entry point.
  function _renderSubredditAgendaPanel() {
    const host = document.getElementById('nav-header');
    let panel = document.getElementById('sr-agenda-panel');
    if (!_activeSubredditFilter) { panel?.remove(); return; }
    const range = store.get().filters.monthRange || null;
    const rows = range
      ? getTopStancesForSubredditInRange(_activeSubredditFilter.id, range, 6)
      : getTopStancesForSubreddit(_activeSubredditFilter.id, 6);
    if (!rows.length) { panel?.remove(); return; }
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'sr-agenda-panel';
      panel.className = 'sr-agenda-panel';
      host?.appendChild(panel);
    }
    const srName = _activeSubredditFilter.name;
    const listHtml = rows.map(r => {
      const col = sphereColor(r.cl);
      const t = getTrendInfo(getPositionSeries(r.gid, r.posIdx));
      const arrow = t.dir === 'up' ? '<span class="sra-up" title="trending up">▲</span>'
                  : t.dir === 'down' ? '<span class="sra-down" title="fading">▼</span>' : '';
      return `
        <button class="sra-row" data-cl="${r.cl}" data-gid="${r.gid}" data-pos="${r.posIdx}"
                title="${escapeHtml(r.description)}">
          <span class="sra-dot" style="background:${col}"></span>
          <span class="sra-name">${escapeHtml(r.pos_name)}</span>
          ${arrow}
          <span class="sra-sub">${escapeHtml(r.sub_name)}</span>
          <span class="sra-share">${Math.round(r.share * 100)}%</span>
        </button>
      `;
    }).join('');
    const headLabel = range
      ? `what <b>r/${escapeHtml(srName)}</b> voiced this period`
      : `what <b>r/${escapeHtml(srName)}</b> voices most`;
    panel.innerHTML = `
      <div class="sra-head">${headLabel}</div>
      <div class="sra-list">${listHtml}</div>
    `;
    panel.querySelectorAll('.sra-row').forEach(btn => {
      btn.onclick = () => {
        const cl = +btn.dataset.cl, gid = +btn.dataset.gid, posIdx = +btn.dataset.pos;
        nav.focus({ cl, gid });
        scheduleFocusPosition(cl, gid, posIdx, 180);
      };
    });
  }
  // Refresh the chip count whenever focus changes so the user sees the
  // new intersection size (e.g. "cl 32 + r/cambridgema = 1,571").
  nav.addEventListener('focus', () => {
    if (_activeSubredditFilter) setTimeout(_updateSubredditFilterChip, 50);
  });

  // ─── Right-side detail panel ────────────────────────────────────
  // Detail panel was removed per user request. All lookups return null
  // and the refresh function below guards against that.
  const detailEl = document.getElementById('detail');
  const detailKind = document.getElementById('detail-kind');
  const detailTitle = document.getElementById('detail-title');
  const detailDesc = document.getElementById('detail-desc');
  const detailMeta = document.getElementById('detail-meta');
  const detailList = document.getElementById('detail-list');
  const MAX_LIST = 40;

  function pickLinkedIndices(cl, gid, posIdx) {
    const st = App.state;
    if (!st.cluster || !st.subLocal) return [];
    const clusters = st.cluster, subLocals = st.subLocal;
    const pa = st.positionAssignments;
    const N = clusters.length;
    let targetCl = cl, targetSub = null;
    if (gid != null) {
      const g = App.subGidMap.byGid[gid];
      if (g) { targetCl = g.cl; targetSub = g.sub; }
    }
    const matches = [];
    // Single pass. Cap at a reasonable candidate count to keep this fast
    // even on 422 k points; downstream sort will narrow to MAX_LIST.
    for (let i = 0; i < N; i++) {
      if (targetCl != null && clusters[i] !== targetCl) continue;
      if (targetSub != null && subLocals[i] !== targetSub) continue;
      if (posIdx != null && pa && pa[i] !== posIdx) continue;
      matches.push(i);
      if (matches.length >= 1500) break;
    }
    return matches;
  }

  async function loadDetails(indices) {
    // Fetch in chunks — getPointDetails already caches chunks internally.
    const out = [];
    for (const i of indices) {
      try {
        const d = await getPointDetails(App.state, i);
        if (!d) continue;
        out.push({ idx: i, ...d });
      } catch (e) { /* skip */ }
    }
    return out;
  }

  function renderDetailList(rows) {
    detailList.innerHTML = '';
    if (!rows.length) {
      detailList.innerHTML = `<div class="dl-row"><div class="dl-body" style="color:var(--fg-mute); font-style:italic">No linked posts in the current filter.</div></div>`;
      return;
    }
    for (const d of rows) {
      const row = document.createElement('div');
      row.className = 'dl-row';
      const title = (d.title || '').trim();
      const body = (d.body || '').replace(/\n{3,}/g, '\n\n');
      row.innerHTML = `
        <div class="dl-meta">r/${escapeHtml(d.subreddit || '—')} · ${escapeHtml(formatRedditKindLabel(d.type))} · ${escapeHtml(d.month || '')}${d.score != null ? ' · ' + redditScoreInlineHtml(d.score) : ''}</div>
        ${title ? `<div class="dl-title">${escapeHtml(title)}</div>` : ''}
        ${body ? `<div class="dl-body">${escapeHtml(body)}</div>` : ''}
      `;
      row.onclick = () => row.classList.toggle('expanded');
      detailList.appendChild(row);
    }
  }

  let detailFetchToken = 0;
  async function refreshDetailPanel(cl, gid, posIdx) {
    if (!detailEl) return;   // panel removed
    const token = ++detailFetchToken;
    if (cl == null) {
      detailEl.classList.add('empty');
      detailKind.textContent = 'the whole globe';
      detailTitle.textContent = '422,114 voices';
      detailDesc.textContent = 'Pick a topic on the left to see what people in that region of the conversation are saying.';
      detailMeta.textContent = '';
      detailList.innerHTML = '';
      return;
    }
    detailEl.classList.remove('empty');

    // Header content depends on drill depth.
    if (posIdx != null && gid != null) {
      const doc = App.state.positionAnchors?.[String(gid)];
      const pos = doc?.positions?.[posIdx];
      const posDoc = App.state.positionsDoc?.[String(gid)]?.positions?.[posIdx]
                  || App.state.positionAnchors?.[String(gid)]?.positions?.[posIdx];
      const sub = App.subGidMap.byGid[gid];
      detailKind.textContent = 'point of view · within ' + (sub?.name || '');
      detailTitle.textContent = posDoc?.name || pos?.name || `Point of view ${posIdx}`;
      detailDesc.textContent = posDoc?.description || '';
      detailMeta.textContent = (pos?.count || 0).toLocaleString() + ' points tagged with this point of view';
    } else if (gid != null) {
      const sub = App.subGidMap.byGid[gid];
      const clMeta = App.state.clusterMeta?.[String(cl)];
      detailKind.textContent = 'subtopic · within ' + (clMeta?.name || '');
      detailTitle.textContent = sub?.name || `Subtopic ${gid}`;
      detailDesc.textContent = '';
      detailMeta.textContent = '';
    } else {
      const clMeta = App.state.clusterMeta?.[String(cl)];
      detailKind.textContent = 'topic';
      detailTitle.textContent = clMeta?.name || `Topic ${cl}`;
      detailDesc.textContent = '';
      detailMeta.textContent = '';
    }

    detailList.innerHTML = `<div class="dl-row"><div class="dl-body" style="color:var(--fg-mute); font-style:italic">Loading posts…</div></div>`;
    const all = pickLinkedIndices(cl, gid, posIdx);
    // Sample up to MAX_LIST — even stride across the match list so we
    // don't just get the first N (which would bias by chunk order).
    const step = Math.max(1, Math.floor(all.length / MAX_LIST));
    const picks = [];
    for (let i = 0; i < all.length && picks.length < MAX_LIST; i += step) {
      picks.push(all[i]);
    }
    const rows = await loadDetails(picks);
    if (token !== detailFetchToken) return;       // stale — newer focus fired
    // Sort: submissions first (more substantive), then by score desc.
    rows.sort((a, b) => {
      const ta = (a.type === 'submission' || a.type === 'post') ? 0 : 1;
      const tb = (b.type === 'submission' || b.type === 'post') ? 0 : 1;
      if (ta !== tb) return ta - tb;
      return (b.score || 0) - (a.score || 0);
    });
    renderDetailPanelMeta(all.length);
    renderDetailList(rows);
  }
  function renderDetailPanelMeta(total) {
    const existing = detailMeta.textContent;
    const bit = `${total.toLocaleString()} linked`;
    detailMeta.textContent = existing ? `${existing} · ${bit}` : bit;
  }

  nav.addEventListener('focus', (ev) => {
    const { cl, gid, posIdx } = ev.detail || {};
    refreshDetailPanel(cl, gid, posIdx);
  });
  // Initial empty state render once subGidMap is ready.
  refreshDetailPanel(null, null, null);

  const inspBody = document.getElementById('insp-body');
  const inspEmpty = document.getElementById('insp-empty-main');

  // Shared helpers for inspector state management.
  // Returning users who've already drilled in get a compact empty state
  // (intro copy hidden). Tracked in localStorage.
  function _markEmptyCompactIfSeen() {
    if (storage.get('intro-seen') === '1') {
      inspEmpty?.classList.add('compact');
    }
  }
  _markEmptyCompactIfSeen();

  const INTRO_CLUSTER_IDS = [37, 8, 43];
  let _introMultiHighlightActive = false;
  function clearIntroGlobeHighlightIfActive() {
    if (!_introMultiHighlightActive) return;
    globe.setMultiHighlight({});
    _introMultiHighlightActive = false;
  }
  function syncIntroGlobeHighlight() {
    if (!inspEmpty || inspEmpty.classList.contains('hidden') || inspEmpty.classList.contains('compact')) {
      clearIntroGlobeHighlightIfActive();
      return;
    }
    if (nav.focusCl != null || nav.focusGid != null) {
      clearIntroGlobeHighlightIfActive();
      return;
    }
    globe.setMultiHighlight({ clusters: new Set(INTRO_CLUSTER_IDS) });
    _introMultiHighlightActive = true;
  }

  function hideInspectorEmpty() {
    clearIntroGlobeHighlightIfActive();
    if (inspEmpty) {
      inspEmpty.classList.add('hidden');
      // First real navigation marks the intro as seen so future empty-state
      // visits are compact.
      storage.set('intro-seen', '1');
      inspEmpty.classList.add('compact');
    }
  }
  function showInspectorEmpty() {
    const anyOpen =
      !dom.el('pinnedView').classList.contains('hidden') ||
      !dom.el('interviewCard').classList.contains('hidden') ||
      !dom.el('voicesListInline').classList.contains('hidden');
    if (!anyOpen && inspEmpty) inspEmpty.classList.remove('hidden');
    syncIntroGlobeHighlight();
  }

  // Topic / subtopic / stance focus drives the globe (rotate + spotlight)
  // and nothing else. The details viewer pane intentionally stays in its
  // empty state — only an explicit click on a globe point or P-pin fills
  // it (see showDetailCard / showInterviewCard).
  nav.addEventListener('focus', (ev) => {
    const { cl, gid, posIdx } = ev.detail;
    globe.setHighlight({ cl, gid, posIdx });

    if (cl == null) {
      globe.rotateTo(0, 0, DEFAULT_DISTANCE, 700);
      showInspectorEmpty();
      return;
    }
    if (gid == null) {
      const a = clusterAnchor(App.state, cl);
      if (a) globe.rotateTo(a.lat, a.lon, TOPIC_FRAMING);
      return;
    }
    const g = App.subGidMap.byGid[gid];
    if (g) {
      const a = subAnchor(App.state, g.cl, g.sub);
      if (a) { globe.rotateTo(a.lat, a.lon, SUB_FRAMING); pulseAt(a.lat, a.lon, sphereColor(g.cl)); }
    }
  });

  document.querySelectorAll('.intro-cluster-chip').forEach((btn) => {
    const cl = +btn.dataset.cl;
    if (Number.isNaN(cl)) return;
    btn.style.setProperty('--intro-chip-color', sphereColor(cl));
    btn.addEventListener('click', () => {
      nav.focus({ cl });
    });
  });

  queueMicrotask(() => showInspectorEmpty());

  // Hoisted here so the hover handlers can check the toggle modes before
  // their key listeners are registered farther down.
  let _spaceDown = false;
  // Mirrors sprout-overlay activity. Called from sproutSpawn (after pushing
  // sprouts) and sproutClear (after teardown). Reads `activeSprouts.length`
  // + `_spaceDown` rather than threading a boolean through every callsite.
  function _publishSproutsMode() {
    try {
      const active = _spaceDown
        || (typeof activeSprouts !== 'undefined' && activeSprouts.length > 0);
      store.set({ modes: { sproutsActive: !!active } });
    } catch {}
  }

  // ─── Globe hover → floating cursor tooltip ───────────────────────
  // Tooltip is a fixed-position card that follows the mouse. It replaces
  // the old sidebar preview + the "Hot now" placeholder block.
  const pointTooltip = document.getElementById('point-tooltip');
  const positionTooltip = (cx, cy) => {
    // Flip to the other side of the cursor if we'd overflow the viewport.
    const r = pointTooltip.getBoundingClientRect();
    const pad = 18;
    let x = cx + 18, y = cy + 18;
    if (x + r.width + pad > window.innerWidth) x = cx - r.width - 18;
    if (y + r.height + pad > window.innerHeight) y = cy - r.height - 18;
    pointTooltip.style.left = `${Math.max(8, x)}px`;
    pointTooltip.style.top  = `${Math.max(8, y)}px`;
  };
  // Tracks the last idx we actually painted into the tooltip so we can
  // skip redundant DOM rebuilds on every mousemove that re-picks the same
  // point. Reset when the tooltip is hidden so a re-show always rebuilds.
  let _lastPaintedHoverIdx = -1;
  const hideTooltip = () => {
    pointTooltip.classList.remove('visible');
    pointTooltip.classList.add('hidden');
    _lastPaintedHoverIdx = -1;
  };
  // ─── Cursor-over-card guard ──────────────────────────────────────
  // Hover tooltip + halo read messy when the cursor is over a floating
  // panel: the tooltip can stack on top of the card body and the halo
  // shows for a point the user can't actually see. We track cursor
  // position globally and gate every hover affordance on whether the
  // cursor is currently over an opaque panel. Listener is in capture
  // phase so panel-internal pointermoves still register.
  const _cardSelectors = [
    '.pinned-view', '.interview-card',
    '#tour-overlay .tour-card', '#tour-overlay .tour-hero', '#tour-overlay .tour-outro',
    '#search-suggestions', '#nav', '.timeline',
  ].join(', ');
  let _cursorOverCard = false;
  const _isOverCard = (target) => {
    if (!target || !(target instanceof Element)) return false;
    return !!target.closest(_cardSelectors);
  };
  document.addEventListener('pointermove', (e) => {
    const overCard = _isOverCard(e.target);
    if (overCard !== _cursorOverCard) {
      _cursorOverCard = overCard;
      if (overCard) {
        hideTooltip();
        hoverPointIdx = -1;
        try { globe.setHoverPoint(-1); } catch {}
        try { globe.canvas.style.cursor = ''; } catch {}
      }
    }
  }, true);
  // Belt-and-braces: when the cursor enters #nav (or leaves the globe
  // canvas) at speed, the pointermove tracking above can lag a frame —
  // force the tooltip + hover state down immediately on these enter/leave
  // events so a stale popup never lingers over the left panel.
  const _forceHideHover = () => {
    _cursorOverCard = true;
    hideTooltip();
    hoverPointIdx = -1;
    try { globe.setHoverPoint(-1); } catch {}
    try { globe.canvas.style.cursor = ''; } catch {}
  };
  document.getElementById('nav')?.addEventListener('pointerenter', _forceHideHover);
  globe.canvas.addEventListener('pointerleave', _forceHideHover);
  function _paintHoverTooltip(details, clientX, clientY) {
    const title = (details.title || '').trim();
    const body = (details.body || '').replace(/\n{3,}/g, '\n\n');
    const meta = App.state.clusterMeta[String(details.cluster)];
    const catName = meta ? meta.name : `Topic ${details.cluster}`;
    const clColor = sphereColor(details.cluster);
    const _hvParsedQ = getActiveSearchParsed();
    pointTooltip.innerHTML = `
      <div class="hv-cluster" style="color:${clColor}">${catName}</div>
      <div class="hv-meta">r/${escapeHtml(details.subreddit || '—')} · ${escapeHtml(formatRedditKindLabel(details.type))} · ${escapeHtml(details.month || '')}${details.score != null ? ' · ' + redditScoreInlineHtml(details.score) : ''}</div>
      ${title ? `<div class="hv-title">${highlightSearchHits(title, _hvParsedQ)}</div>` : ''}
      <div class="hv-body">${highlightSearchHits(body, _hvParsedQ)}</div>
    `;
    pointTooltip.classList.remove('hidden');
    pointTooltip.classList.add('visible');
    if (clientX != null) positionTooltip(clientX, clientY);
    _lastPaintedHoverIdx = details.idx;
  }
  globe.addEventListener('hover', async (ev) => {
    // Suppress the hover card entirely while SPACE is held — otherwise
    // moving the mouse around to read the sprouts keeps flashing
    // tooltips at the cursor.
    if (_spaceDown) { hideTooltip(); return; }
    // Cursor is over a floating panel — let the panel take priority.
    // The globe still emits hover events because the canvas sits below;
    // we silence the affordance instead of fighting the event source.
    if (_cursorOverCard) { hideTooltip(); return; }
    const { idx, clientX, clientY } = ev.detail;
    if (idx < 0) {
      hideTooltip();
      return;
    }
    // Fast path: the hovered point hasn't changed since we last painted, and
    // chunk is warm. Skip the await + DOM rebuild entirely; reposition only.
    if (idx === _lastPaintedHoverIdx && pointTooltip.classList.contains('visible')) {
      if (clientX != null) positionTooltip(clientX, clientY);
      return;
    }
    try {
      const details = await getPointDetails(App.state, idx);
      // Bail conditions in priority order:
      //   1. Cursor moved onto a panel during the await — show nothing.
      //   2. Space is now down (sprouts mode) — show nothing.
      //   3. Cursor moved off the globe entirely (hoverPointIdx < 0) — show nothing.
      //   4. Cursor moved to a *different* point: drop this paint, but DO NOT
      //      bail outright — the new point's own hover event will (or already
      //      did) fire and resolve. Older code re-entered here and bailed for
      //      every transient idx switch, which made fast cursor sweeps feel
      //      sluggish (the user would see no tooltip until they stopped moving).
      if (_cursorOverCard || _spaceDown) { hideTooltip(); return; }
      if (hoverPointIdx < 0) { hideTooltip(); return; }
      if (hoverPointIdx !== idx) {
        // The current hover target moved on. Don't paint stale details, but
        // also don't hide — the live hover event for the new idx will paint.
        return;
      }
      _paintHoverTooltip(details, clientX, clientY);
    } catch (e) {}
  });
  globe.addEventListener('hovermove', (ev) => {
    if (!pointTooltip.classList.contains('visible')) return;
    const { clientX, clientY } = ev.detail || {};
    if (clientX != null) positionTooltip(clientX, clientY);
  });
  globe.addEventListener('bgclick', () => {
    hideInterviewCard();
  });
  globe.addEventListener('pointclick', async (ev) => {
    // During interactive tour steps that haven't whitelisted inspector
    // cards (`showChrome: ['cards']`), dot clicks are disabled. Otherwise
    // a click on the wrong dot opens a detail card before the user has
    // even been told what a dot is, blocking the tutorial flow.
    if (document.body.classList.contains('tour-step-mode')
        && !document.body.classList.contains('tour-step-show-cards')) {
      return;
    }
    const details = await getPointDetails(App.state, ev.detail.idx);
    // Only jump to the Reddit thread if the user held cmd/ctrl. Plain
    // clicks now open the side card instead — easier to skim, doesn't
    // hijack the tab on every mis-click.
    const e = ev.detail?.origEvent || ev.detail?.event;
    const wantsLink = !!(e && (e.metaKey || e.ctrlKey));
    if (wantsLink && details?.permalink) {
      window.open(details.permalink, '_blank', 'noopener,noreferrer');
    } else {
      _setSelection({ pinnedIdx: ev.detail.idx });
      globe.setPinnedPoint(pinnedPointIdx);
      showDetailCard(details);
    }
  });
  globe.addEventListener('pinhover', (ev) => {
    showPinTooltip(ev.detail);
  });
  globe.addEventListener('pinunhover', () => {
    hidePinTooltip();
  });
  // ─── Hover halo: bright ring on the currently-hovered point ────
  const hoverHaloEl = document.getElementById('hover-halo');
  let hoverPointIdx = -1;
  let pinnedPointIdx = -1;
  // Single chokepoint for selection writes — mirrors to the cross-module
  // store so non-owners (tour beats, debug helpers, …) can read
  // store.get().selection without reaching into this closure.
  function _setSelection({ pinnedIdx, hoveredIdx }) {
    if (pinnedIdx !== undefined) pinnedPointIdx = pinnedIdx;
    if (hoveredIdx !== undefined) hoverPointIdx = hoveredIdx;
    try {
      store.set({ selection: {
        ...(pinnedIdx !== undefined ? { pinnedIdx } : {}),
        ...(hoveredIdx !== undefined ? { hoveredIdx } : {}),
      } });
    } catch {}
  }
  function clearSelectedPoint(_opts = {}) {
    _setSelection({ pinnedIdx: -1, hoveredIdx: -1 });
    globe.setPinnedPoint(-1);
    globe.setHoverPoint(-1);
  }
  globe.addEventListener('hover', (ev) => {
    if (_spaceDown) { hoverPointIdx = -1; globe.setHoverPoint(-1); globe.canvas.style.cursor = ''; return; }
    if (_cursorOverCard) { hoverPointIdx = -1; globe.setHoverPoint(-1); globe.canvas.style.cursor = ''; return; }
    hoverPointIdx = ev?.detail?.idx ?? -1;
    globe.setHoverPoint(hoverPointIdx);
    globe.canvas.style.cursor = hoverPointIdx >= 0 ? 'pointer' : '';
  });
  function updateHoverHalo() {
    if (!hoverHaloEl) return;
    if (hoverPointIdx < 0 || !App.state?.coords) {
      hoverHaloEl.classList.remove('show');
      return;
    }
    const lat = App.state.coords[2 * hoverPointIdx];
    const lon = App.state.coords[2 * hoverPointIdx + 1];
    const wp = globe.worldPositionOf(lat, lon, POINT_RADIUS);
    const camPos = globe.camera.position;
    const facing = wp.x*(camPos.x-wp.x) + wp.y*(camPos.y-wp.y) + wp.z*(camPos.z-wp.z);
    if (facing <= 0) { hoverHaloEl.classList.remove('show'); return; }
    const p = wp.clone().project(globe.camera);
    if (p.z > 1) { hoverHaloEl.classList.remove('show'); return; }
    const canvasRect = globe.canvas.getBoundingClientRect();
    const overlayRect = hoverHaloEl.offsetParent?.getBoundingClientRect?.() || { left: 0, top: 0 };
    const sx = canvasRect.left - overlayRect.left + (p.x * 0.5 + 0.5) * canvasRect.width;
    const sy = canvasRect.top - overlayRect.top + (-p.y * 0.5 + 0.5) * canvasRect.height;
    const cl = App.state.cluster?.[hoverPointIdx];
    const col = cl != null ? sphereColor(cl) : '#ffffff';
    hoverHaloEl.style.left = `${sx}px`;
    hoverHaloEl.style.top = `${sy}px`;
    hoverHaloEl.style.borderColor = col;
    hoverHaloEl.style.boxShadow =
      `0 0 0 2px rgba(0,0,0,0.45), 0 0 20px 5px ${col}99, inset 0 0 10px 2px ${col}66`;
    hoverHaloEl.classList.add('show');
  }

  // ─── Space-to-sprout: ephemeral comment samples on the visible area
  const sproutsEl = document.getElementById('sprouts');
  const sproutLinesEl = document.getElementById('sprout-lines');
  const SPROUT_COUNT = 5;   // always exactly 5
  // SPROUT_BODY_MAX_CHARS / SPROUT_VIEWPORT_MARGIN_PX live in core/constants.js.
  const SPROUT_BODY_CAP = SPROUT_BODY_MAX_CHARS;
  const SPROUT_MARGIN_PX = SPROUT_VIEWPORT_MARGIN_PX;
  let activeSprouts = [];   // { idx, lat, lon, el, line, offX, offY, w, h }
  // Space is a toggle: first press opens a five-post spread, next press clears.
  let sproutClearTimer = null;
  let sproutRenderToken = 0;
  function cancelSproutClearTimer() {
    if (sproutClearTimer != null) {
      clearTimeout(sproutClearTimer);
      sproutClearTimer = null;
    }
  }
  // "In the current viewport" means both:
  //   1. forward-facing (facing > 0) — otherwise the point is on the back
  //      of the sphere and not rendered
  //   2. its projected screen position lies inside the canvas rect
  // _screenOf returns null when either fails.
  function _screenOf(lat, lon) {
    const wp = globe.worldPositionOf(lat, lon, POINT_RADIUS);
    const camPos = globe.camera.position;
    const facing = wp.x*(camPos.x-wp.x) + wp.y*(camPos.y-wp.y) + wp.z*(camPos.z-wp.z);
    if (facing <= 0.02) return null;
    const p = wp.clone().project(globe.camera);
    if (p.z > 1) return null;
    const w = globe.canvas.clientWidth;
    const h = globe.canvas.clientHeight;
    const x = (p.x * 0.5 + 0.5) * w;
    const y = (-p.y * 0.5 + 0.5) * h;
    if (x < SPROUT_MARGIN_PX || x > w - SPROUT_MARGIN_PX) return null;
    if (y < SPROUT_MARGIN_PX || y > h - SPROUT_MARGIN_PX) return null;
    return { x, y };
  }

  async function sproutSpawn(token = sproutRenderToken) {
    if (activeSprouts.length > 0) return;     // already up
    const state = App.state;
    if (!state?.coords || !state?.N) return;
    const N = state.N;
    const n = SPROUT_COUNT;

    // "Respects any filter, including hovering" → read the globe's own
    // dim buffer. dim[i] ≈ 1 means the point is drawn in full color
    // (it passes every active filter — focus, nav-segment hover, subreddit
    // filter, regex paint, timeline range). dim[i] ≈ 0.12 means faded —
    // skip those so the sprouts only come from what the user actually
    // sees as colored.
    const dimArr = globe.pointGeom?.attributes?.dim?.array;
    const matchesFocus = (i) => dimArr ? dimArr[i] > 0.5 : true;

    // 1) Collect on-screen + focus-matching points inside the centered
    //    sub-disc. Disc center = camera focal screen position (viewport
    //    center, since the globe is canvas-centered). Disc diameter =
    //    viewport_h * SPROUT_DISC_FRAC, so radius = viewport_h *
    //    SPROUT_DISC_FRAC / 2. With the default 0.5 the diameter is half
    //    the viewport height. Cards are placed on a ring strictly outside
    //    this disc so leader lines stay short and never cross (#25).
    const DISC_W = globe.canvas.clientWidth;
    const DISC_H = globe.canvas.clientHeight;
    const discCx = DISC_W * 0.5;
    const discCy = DISC_H * 0.5;
    const discR = DISC_H * SPROUT_DISC_FRAC * 0.5;
    const inDisc = (sx, sy) => {
      const ddx = sx - discCx;
      const ddy = sy - discCy;
      return (ddx * ddx + ddy * ddy) <= (discR * discR);
    };
    const POOL_CAP = 800;
    const pool = [];
    const stride = Math.max(1, Math.floor(N / 4000));
    const offset = Math.floor(Math.random() * stride);
    for (let idx = offset; idx < N && pool.length < POOL_CAP; idx += stride) {
      if (!matchesFocus(idx)) continue;
      const lat = state.coords[2 * idx];
      const lon = state.coords[2 * idx + 1];
      const s = _screenOf(lat, lon);
      if (!s) continue;
      if (!inDisc(s.x, s.y)) continue;
      pool.push({ idx, lat, lon, sx: s.x, sy: s.y });
    }
    // If we skipped too many by stride (e.g. zoomed way in, or filter is
    // narrow), do a dense second sweep.
    if (pool.length < n * 3 && stride > 1) {
      for (let idx = 0; idx < N && pool.length < POOL_CAP; idx++) {
        if (idx % stride === offset) continue;   // already tried
        if (!matchesFocus(idx)) continue;
        const lat = state.coords[2 * idx];
        const lon = state.coords[2 * idx + 1];
        const s = _screenOf(lat, lon);
        if (!s) continue;
        if (!inDisc(s.x, s.y)) continue;
        pool.push({ idx, lat, lon, sx: s.x, sy: s.y });
      }
    }
    if (pool.length === 0) {
      _showSproutsEmptyNote();
      return;
    }
    if (token !== sproutRenderToken) return;

    // 2) Pick 5 with margin-aware + greedy max-min spatial diversity.
    const W = globe.canvas.clientWidth;
    const H = globe.canvas.clientHeight;
    let kept = [];

    // ── Tutorial override hook ────────────────────────────────────────
    // When a tour beat sets App.tour.curatedSproutIndices = [...], the
    // next R fire returns that hand-picked set instead of rolling the
    // dice. The beat is responsible for clearing the array on cleanup.
    // Indices that aren't on screen (back of sphere, off-canvas) are
    // dropped — the beat should rotate the camera so the curated set is
    // visible before invoking R.
    const curated = window.App?.tour?.curatedSproutIndices;
    if (Array.isArray(curated) && curated.length > 0) {
      for (const idx of curated) {
        if (!Number.isFinite(idx) || idx < 0 || idx >= N) continue;
        const lat = state.coords[2 * idx];
        const lon = state.coords[2 * idx + 1];
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const s = _screenOf(lat, lon);
        if (!s) continue;
        kept.push({ idx, lat, lon, sx: s.x, sy: s.y });
      }
    } else {
      // 2a) Margin-aware inner pool: drop the outermost SPROUT_EDGE_TRIM_FRAC
      //     of candidates by angular distance to the visible-region center.
      //     The center is the centroid of unit-vectors of every pool point —
      //     equivalent to "what the camera is looking at" given the pool was
      //     already filtered to forward-facing on-screen points.
      let cx = 0, cy = 0, cz = 0;
      for (const c of pool) {
        const cl = Math.cos(c.lat);
        cx += cl * Math.cos(c.lon);
        cy += Math.sin(c.lat);
        cz += cl * Math.sin(c.lon);
      }
      const cmag = Math.hypot(cx, cy, cz) || 1;
      cx /= cmag; cy /= cmag; cz /= cmag;
      // Angular distance ~ 1 - dot(unit, center). Sort ascending (closest
      // to center first), then trim the tail.
      const scored = pool.map((c) => {
        const cl = Math.cos(c.lat);
        const ux = cl * Math.cos(c.lon);
        const uy = Math.sin(c.lat);
        const uz = cl * Math.sin(c.lon);
        const dot = ux * cx + uy * cy + uz * cz;
        return { c, dot };
      });
      scored.sort((a, b) => b.dot - a.dot);   // higher dot = closer to center
      const trim = Math.max(0, Math.min(scored.length - n,
        Math.floor(scored.length * SPROUT_EDGE_TRIM_FRAC)));
      const inner = scored.slice(0, scored.length - trim).map((s) => ({
        ...s.c,
        // Cache unit-vec for greedy angular distance below.
        ux: Math.cos(s.c.lat) * Math.cos(s.c.lon),
        uy: Math.sin(s.c.lat),
        uz: Math.cos(s.c.lat) * Math.sin(s.c.lon),
      }));
      // If trimming left fewer than n, fall back to the full pool with the
      // same unit-vec annotation.
      const candidates = inner.length >= n ? inner : pool.map((c) => ({
        ...c,
        ux: Math.cos(c.lat) * Math.cos(c.lon),
        uy: Math.sin(c.lat),
        uz: Math.cos(c.lat) * Math.sin(c.lon),
      }));

      // 2b) Greedy max-min angular distance.
      //     Seed with a random candidate (so each R press gives different
      //     compositions); thereafter pick the candidate that maximizes its
      //     minimum angular distance to anything already chosen.
      const seed = candidates[Math.floor(Math.random() * candidates.length)];
      kept = [seed];
      const used = new Set([seed.idx]);
      while (kept.length < n) {
        let best = null;
        let bestMinDot = 2;   // dot is in [-1, 1]; lower dot = larger angle
        for (const c of candidates) {
          if (used.has(c.idx)) continue;
          let maxDot = -2;
          for (const k of kept) {
            const d = c.ux * k.ux + c.uy * k.uy + c.uz * k.uz;
            if (d > maxDot) maxDot = d;
          }
          // We want minimum angular distance from c to any kept point to be
          // as large as possible — equivalently, the maximum dot to be as
          // small as possible.
          if (maxDot < bestMinDot) { bestMinDot = maxDot; best = c; }
        }
        if (!best) break;
        kept.push(best);
        used.add(best.idx);
      }
    }
    // If the viewport is literally so small we can't fit n distinct points,
    // keep whatever we have.
    if (kept.length === 0) return;

    // Preload details serially to keep DOM in sample-kept order.
    const details = [];
    for (const k of kept) {
      try {
        const d = await getPointDetails(state, k.idx);
        if (token !== sproutRenderToken) return;
        details.push({ k, d });
      } catch { /* skip */ }
    }
    if (token !== sproutRenderToken) return;

    // ── Phase 1: build DOM + measure ────────────────────────────────────
    // Each "rec" carries the anchor screen pos, measured card box, and a
    // proposed (bx, by). For the disc-radiate layout the seed is on the
    // ring (discR + SPROUT_DISC_RING_OFFSET_PX) at the anchor's angle from
    // the disc center; sorting by angle and de-conflicting along the ring
    // guarantees non-crossing leader lines (#12).
    activeSprouts = [];
    const recs = [];
    for (const { k, d } of details) {
      if (token !== sproutRenderToken) return;
      if (!d) continue;
      const title = (d.title || '').trim();
      const body = (d.body || '').replace(/\s+/g, ' ').trim();
      const bodyShort = body.length > SPROUT_BODY_CAP ? body.slice(0, SPROUT_BODY_CAP).trim() + '…' : body;
      if (!title && !bodyShort) continue;

      const pointCl = App.state.cluster?.[k.idx];
      const anchorColor = pointCl != null ? sphereColor(pointCl) : '#ffffff';

      const el = document.createElement('div');
      el.className = 'sprout';
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.style.maxWidth = `${SPROUT_MAX_WIDTH_PX}px`;
      el.addEventListener('click', (ev) => {
        ev.preventDefault();
        cancelSproutClearTimer();
        globe.rotateTo(k.lat, k.lon, ZOOM_TO_POINT_FRAMING);
        _setSelection({ pinnedIdx: k.idx });
        globe.setPinnedPoint(k.idx);
        showDetailCard(d);
        _spaceDown = false;
        sproutClear({ immediate: true });
      });
      // Border + thin glow in the cluster color so the caption reads as
      // belonging to the same cluster as its tether + halo.
      el.style.borderColor = anchorColor;
      el.style.boxShadow =
        `0 6px 18px rgba(0,0,0,0.5), 0 0 0 1px ${anchorColor}55, 0 0 12px ${anchorColor}44`;
      el.innerHTML = `
        <div class="sp-meta">r/${escapeHtml(d.subreddit || '—')} · ${escapeHtml(formatRedditKindLabel(d.type))}${d.month ? ' · ' + escapeHtml(d.month) : ''}${d.score != null ? ' · ' + redditScoreInlineHtml(d.score) : ''}</div>
        ${title ? `<div class="sp-title">${escapeHtml(title)}</div>` : ''}
        ${bodyShort ? `<div class="sp-body">${escapeHtml(bodyShort)}</div>` : ''}
      `;
      // Place off-screen for measurement so an unpolished position never
      // flashes on screen (we set the real coords after layout below).
      el.style.left = '-9999px';
      el.style.top = '-9999px';
      sproutsEl.appendChild(el);
      const bw = el.offsetWidth || 200;
      const bh = el.offsetHeight || 80;

      // Anchor angle: from disc center to the anchor's screen pos. Cards
      // place on a ring just outside the disc at that same angle.
      const ang = Math.atan2(k.sy - discCy, k.sx - discCx);
      recs.push({
        k, d, el, bw, bh, anchorColor,
        ax: k.sx, ay: k.sy, ang,
        bx: 0, by: 0,
      });
    }

    // ── Phase 2: ring-radial layout ────────────────────────────────────
    // Sort by anchor angle so iteration order matches visual order around
    // the disc; each card center sits on a ring at radius =
    // discR + RING_OFFSET + card_half_size, so the card's inner edge clears
    // the disc by RING_OFFSET. If two adjacent cards collide, slide the
    // later one along the ring until clear. After clamping inside the
    // viewport we re-project any card that crossed back into the disc.
    recs.sort((a, b) => a.ang - b.ang);
    const m = SPROUT_VIEWPORT_MARGIN_PX;
    const innerR = discR + SPROUT_DISC_RING_OFFSET_PX;
    const placeAtAngle = (r, ang) => {
      const cardHalf = Math.hypot(r.bw, r.bh) * 0.5;
      const ringR = innerR + cardHalf;
      const cxR = discCx + Math.cos(ang) * ringR;
      const cyR = discCy + Math.sin(ang) * ringR;
      let bx = cxR - r.bw * 0.5;
      let by = cyR - r.bh * 0.5;
      // Clamp inside viewport.
      bx = Math.max(m, Math.min(W - m - r.bw, bx));
      by = Math.max(m, Math.min(H - m - r.bh, by));
      // If the viewport clamp pulled the card center back inside the disc,
      // push it radially outward so its center sits on innerR again.
      const ccx = bx + r.bw * 0.5;
      const ccy = by + r.bh * 0.5;
      const dxC = ccx - discCx;
      const dyC = ccy - discCy;
      const distC = Math.hypot(dxC, dyC) || 1;
      if (distC < innerR) {
        const ux = dxC / distC;
        const uy = dyC / distC;
        bx = discCx + ux * innerR - r.bw * 0.5;
        by = discCy + uy * innerR - r.bh * 0.5;
        bx = Math.max(m, Math.min(W - m - r.bw, bx));
        by = Math.max(m, Math.min(H - m - r.bh, by));
      }
      r.bx = bx; r.by = by; r.ang = ang;
    };
    for (const r of recs) placeAtAngle(r, r.ang);
    // De-collide along the ring — bump each card's angle clockwise until
    // its bbox no longer overlaps the previous card's bbox.
    const gap = SPROUT_CARD_GAP_PX;
    const overlaps = (a, b) => {
      const ox = Math.min(a.bx + a.bw + gap, b.bx + b.bw + gap)
               - Math.max(a.bx - gap, b.bx - gap);
      const oy = Math.min(a.by + a.bh + gap, b.by + b.bh + gap)
               - Math.max(a.by - gap, b.by - gap);
      return ox > 0 && oy > 0;
    };
    const ANGLE_STEP = 0.04;
    for (let i = 1; i < recs.length; i++) {
      let safety = 80;
      while (safety-- > 0 && overlaps(recs[i - 1], recs[i])) {
        placeAtAngle(recs[i], recs[i].ang + ANGLE_STEP);
      }
    }

    // ── Phase 2b: dodge tour modal ─────────────────────────────────────
    // During the tour the modal floats over the bottom-right of the canvas.
    // A sprout card landing in that quadrant gets visually buried under it.
    // Treat any visible .tour-card as an obstacle bbox: bump the card's
    // angle until it clears, trying both directions so we don't loop the
    // ring uselessly.
    const obstacles = [];
    try {
      const canvasRect = globe.canvas.getBoundingClientRect();
      const PAD = SPROUT_CARD_GAP_PX;
      document.querySelectorAll('#tour-overlay .tour-card:not(.hidden)').forEach((tc) => {
        const r = tc.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return;
        const lx = r.left - canvasRect.left - PAD;
        const ly = r.top - canvasRect.top - PAD;
        const rw = r.width + PAD * 2;
        const rh = r.height + PAD * 2;
        // Only count obstacles that actually intrude into the canvas.
        if (lx + rw <= 0 || ly + rh <= 0 || lx >= W || ly >= H) return;
        obstacles.push({ bx: lx, by: ly, bw: rw, bh: rh });
      });
    } catch {}
    const hitsObstacle = (r) => {
      for (const o of obstacles) {
        const ox = Math.min(r.bx + r.bw, o.bx + o.bw) - Math.max(r.bx, o.bx);
        const oy = Math.min(r.by + r.bh, o.by + o.bh) - Math.max(r.by, o.by);
        if (ox > 0 && oy > 0) return true;
      }
      return false;
    };
    if (obstacles.length) {
      for (const r of recs) {
        if (!hitsObstacle(r)) continue;
        const startAng = r.ang;
        let cleared = false;
        // Try both rotational directions (up to ~2π) and pick the first
        // angle at which the card clears every obstacle.
        for (let step = 1; step <= 160 && !cleared; step++) {
          const delta = step * ANGLE_STEP;
          for (const sign of [-1, 1]) {
            placeAtAngle(r, startAng + sign * delta);
            if (!hitsObstacle(r)) { cleared = true; break; }
          }
        }
        if (!cleared) placeAtAngle(r, startAng);
      }
      // One more neighbor de-collide pass — angle-sort first since
      // dodging may have re-ordered cards around the ring.
      recs.sort((a, b) => a.ang - b.ang);
      for (let i = 1; i < recs.length; i++) {
        let safety = 80;
        while (safety-- > 0 && overlaps(recs[i - 1], recs[i])) {
          placeAtAngle(recs[i], recs[i].ang + ANGLE_STEP);
        }
      }
    }

    // ── Phase 3: commit positions + render leader lines + halos ─────────
    for (const r of recs) {
      if (token !== sproutRenderToken) return;
      r.el.style.left = `${r.bx}px`;
      r.el.style.top = `${r.by}px`;
      requestAnimationFrame(() => r.el.classList.add('show'));

      // Tether line from anchor to nearest box edge. Made bold + tinted
      // to the cluster color so the link between caption and point reads
      // at a glance. Opacity is controlled by the .show class so spawn /
      // clear fade it in lockstep with the caption box.
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('stroke', r.anchorColor);
      line.setAttribute('stroke-width', '2.5');
      line.setAttribute('stroke-opacity', '0.85');
      sproutLinesEl.appendChild(line);
      requestAnimationFrame(() => line.classList.add('show'));

      // Halo around the anchor point itself.
      const halo = document.createElement('div');
      halo.className = 'sprout-anchor';
      halo.style.borderColor = r.anchorColor;
      halo.style.boxShadow =
        `0 0 0 2px rgba(0,0,0,0.5), 0 0 18px 4px ${r.anchorColor}aa`;
      sproutsEl.appendChild(halo);
      requestAnimationFrame(() => halo.classList.add('show'));

      activeSprouts.push({
        idx: r.k.idx, lat: r.k.lat, lon: r.k.lon,
        el: r.el, line, halo,
        bx: r.bx, by: r.by, bw: r.bw, bh: r.bh,
      });
    }
    // Set SVG viewBox so line coords are in CSS pixels.
    sproutLinesEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
    sproutLinesEl.setAttribute('width', W);
    sproutLinesEl.setAttribute('height', H);
    _publishSproutsMode();
  }
  function sproutClear(opts = {}) {
    const immediate = !!opts.immediate;
    sproutRenderToken++;
    for (const s of activeSprouts) {
      s.el.classList.remove('show');
      s.line?.classList.remove('show');
      s.halo?.classList.remove('show');
      const el = s.el, line = s.line, halo = s.halo;
      if (immediate) {
        el.remove();
        line?.remove();
        halo?.remove();
      } else {
        setTimeout(() => { el.remove(); line?.remove(); halo?.remove(); }, 240);
      }
    }
    activeSprouts = [];
    if (immediate) {
      sproutsEl.innerHTML = '';
      slClearLinesSafe();
    } else {
      // Hide any lingering empty-note even on animated clears.
      const note = document.getElementById('sprouts-empty-note');
      if (note) { note.classList.remove('show'); setTimeout(() => note.remove(), 240); }
    }
    _publishSproutsMode();
  }
  function slClearLinesSafe() {
    if (!sproutLinesEl) return;
    while (sproutLinesEl.firstChild) sproutLinesEl.removeChild(sproutLinesEl.firstChild);
  }
  // Inline note shown when the disc-bound pool is empty (zoomed too far in,
  // narrow filter, or the user is looking at the back of the sphere). Auto-
  // dismisses; sproutClear also removes it.
  function _showSproutsEmptyNote() {
    if (!sproutsEl) return;
    const old = document.getElementById('sprouts-empty-note');
    if (old) old.remove();
    const note = document.createElement('div');
    note.id = 'sprouts-empty-note';
    note.className = 'sprout-empty-note';
    note.textContent = 'Few points here — try rotating';
    sproutsEl.appendChild(note);
    requestAnimationFrame(() => note.classList.add('show'));
    setTimeout(() => {
      note.classList.remove('show');
      setTimeout(() => note.remove(), 240);
    }, 1800);
  }
  function updateSprouts() {
    if (!activeSprouts.length) return;
    const W = globe.canvas.clientWidth;
    const H = globe.canvas.clientHeight;
    sproutLinesEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
    sproutLinesEl.setAttribute('width', W);
    sproutLinesEl.setAttribute('height', H);
    for (const s of activeSprouts) {
      const scr = _screenOf(s.lat, s.lon);
      if (!scr) {
        s.line.setAttribute('stroke-opacity', '0');
        if (s.halo) s.halo.style.opacity = '0';
        continue;
      }
      // Closest edge midpoint on the box to the anchor.
      const cx = Math.max(s.bx, Math.min(scr.x, s.bx + s.bw));
      const cy = Math.max(s.by, Math.min(scr.y, s.by + s.bh));
      s.line.setAttribute('x1', scr.x);
      s.line.setAttribute('y1', scr.y);
      s.line.setAttribute('x2', cx);
      s.line.setAttribute('y2', cy);
      s.line.setAttribute('stroke-opacity', '0.85');
      if (s.halo) {
        s.halo.style.left = `${scr.x}px`;
        s.halo.style.top = `${scr.y}px`;
        s.halo.style.opacity = '';   // let the class rule control opacity
      }
    }
  }

  function _sproutSpaceAllowed(e) {
    if (e.defaultPrevented) return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const ae = document.activeElement;
    const t = ae?.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || t === 'BUTTON' || t === 'A') return false;
    if (ae?.isContentEditable) return false;
    if (window.App?.tour?.isActive?.()) return false;
    return true;
  }
  /** R / random-five: same as Space except tour may be active and a focused
   *  tour button must not block (R does not activate buttons the way Space does). */
  function _sproutRandomKeyAllowed(e) {
    if (e.defaultPrevented) return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const ae = document.activeElement;
    const t = ae?.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return false;
    if (ae?.isContentEditable) return false;
    return true;
  }
  // Space: toggle sprouts (gated off during tour and on input/button focus).
  // when() also enforces the not-tour-active gate. Stage 3 will swap the
  // body-class probe for an overlayManager.isOpen('tour') call.
  keys.bind({
    keys: [' '],
    priority: 25,
    label: 'sprouts-toggle',
    helpLabel: 'Hold Space — sprout snippets from posts on screen',
    helpGroup: 'navigate',
    helpKeys: ['Space'],
    when: () => !document.body.classList.contains('tour-active'),
    handler: (e) => {
      if (!_sproutSpaceAllowed(e)) return false;
      cancelSproutClearTimer();
      e.preventDefault();
      _spaceDown = !_spaceDown;
      if (_spaceDown) sproutSpawn(++sproutRenderToken);
      else sproutClear({ immediate: true });
      _publishSproutsMode();
      return true;
    },
  });
  window.addEventListener('blur', () => {
    cancelSproutClearTimer();
  });

  globe.addEventListener('pinclick', (ev) => {
    showInterviewCard(ev.detail.pin);
    // Mark the pin as selected, others unselected
    document.querySelectorAll('.pin').forEach(el => el.classList.toggle('selected', el.dataset.id === ev.detail.pin.id));
  });

  // ─── HUD buttons ────────────────────────────────────────────────
  // Per-toggle preferences persist so the user doesn't have to re-disable
  // labels / pins on every reload. Keys: vizPref.labels, .pins — each 'on' | 'off'.
  // Defaults: labels on, pins on.
  const _prefKey = 'pref';
  const _prefs = storage.getJSON(_prefKey, {}) || {};
  function _savePrefs() {
    storage.setJSON(_prefKey, _prefs);
  }
  const btnLabels = document.getElementById('btn-labels');
  if (btnLabels) btnLabels.onclick = () => {
    labelsEnabled = !labelsEnabled;
    btnLabels.classList.toggle('on', labelsEnabled);
    document.getElementById('globe-labels').style.display = labelsEnabled ? '' : 'none';
    _prefs.labels = labelsEnabled ? 'on' : 'off';
    _savePrefs();
  };
  const btnPins = document.getElementById('btn-pins');
  if (btnPins) btnPins.onclick = () => {
    const next = !globe.pinsEnabled;
    globe.setPinsEnabled(next);
    btnPins.classList.toggle('on', next);
    document.getElementById('pin-labels').style.display = next ? '' : 'none';
    _prefs.pins = next ? 'on' : 'off';
    _savePrefs();
  };
  // Apply saved prefs after the rest of boot has run so any let-bindings
  // referenced by the click handlers (e.g. labelsEnabled at line ~1225)
  // are initialized. queueMicrotask guarantees we run after this tick.
  // Buttons were removed from the toolbar; we re-apply prefs by invoking
  // the handlers directly (via synthetic click when the button still
  // exists) so saved state survives.
  queueMicrotask(() => {
    if (_prefs.labels === 'off' && btnLabels?.classList.contains('on')) btnLabels.click();
    if (_prefs.pins === 'off' && btnPins?.classList.contains('on')) btnPins.click();
  });
  const btnReset = document.getElementById('btn-reset');
  // True reset — unwinds drill focus, subreddit filter, timeline range,
  // regex paint, text-search state, and any open overlays. A single
  // affordance that returns the viz to its fresh-load state.
  function resetAll() {
    // Focus drill
    nav.focus({});
    _spaceDown = false;
    cancelSproutClearTimer();
    sproutClear({ immediate: true });
    hideInterviewCard();
    clearSelectedPoint();
    // Subreddit filter
    if (_activeSubredditFilter) {
      _activeSubredditFilter = null;
      globe.setSubredditHighlight(null);
      _updateSubredditFilterChip();
    }
    // Regex / text paint
    if (typeof nav._clearRegexPaint === 'function') nav._clearRegexPaint();
    // Timeline range via scrubber API (exposed on App)
    if (typeof App._timelineClear === 'function') App._timelineClear();
    // Search input
    const si = document.getElementById('search-input');
    if (si) { si.value = ''; si.blur(); }
    const ss = document.getElementById('search-suggestions');
    ss?.classList.add('hidden');
    // Close pinned view if open
    hidePinnedView();
    // Drop the pinned back/forward stacks so ←/→ on the pinned-view don't
    // keep offering posts from the session before the reset.
    _pinnedBackStack.length = 0;
    _pinnedForwardStack.length = 0;
    _currentDetailPin = null;
    _syncPvBackBtn();
    // Clear hash last — after all state changes
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    globe?.resetCanonicalZoom?.();
  }
  App.resetAll = resetAll;
  if (btnReset) btnReset.onclick = resetAll;

  // ─── Share: copy the current page URL to clipboard.
  //   Button flashes "Copied!" for ~1.6s. Falls back to textarea/execCommand
  //   if navigator.clipboard is unavailable (e.g. insecure http).
  const btnShare = document.getElementById('btn-share');
  if (btnShare) {
    let shareResetTimer = null;
    btnShare.onclick = async () => {
      const url = window.location.href;
      let ok = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
          ok = true;
        }
      } catch (e) { /* ignored; fallback below */ }
      if (!ok) {
        const ta = document.createElement('textarea');
        ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { ok = document.execCommand('copy'); } catch (e) {}
        ta.remove();
      }
      btnShare.classList.toggle('copied', ok);
      btnShare.classList.toggle('share-err', !ok);
      btnShare.setAttribute('data-msg', ok ? 'Copied!' : 'Copy failed');
      clearTimeout(shareResetTimer);
      shareResetTimer = setTimeout(() => {
        btnShare.classList.remove('copied', 'share-err');
        btnShare.removeAttribute('data-msg');
      }, 1600);
    };
  }

  // ─── Timeline scrubber: drag a date range to filter the globe ───
  initTimeline({ App, globe, storage, store, writeHash: () => (typeof writeHash === "function") && writeHash(),
    refreshOnRange: () => {
      // Re-rank the subreddit agenda when the range changes so it reflects
      // the period the user is studying.
      if (_activeSubredditFilter) _renderSubredditAgendaPanel();
    },
  });

  // ─── Surprise Me: drop the user at a random, well-supported position.
  initSurprise({ App, nav, store, focusPosition,
    getActiveSubredditFilter: () => _activeSubredditFilter });

  // ─── Lateral keyboard navigation ───────────────────────────
  //   [ / ] → prev/next position within the current sub
  //   { / } → prev/next sub within the current cluster
  // Registered unconditionally (not gated on btn-surprise existing) so
  // these shortcuts work in the minimal layout too.
  keys.bind({
    keys: ['[', ']', '{', '}'],
    priority: 20,
    label: 'lateral-nav',
    helpLabel: '[ ] cycle stances · { } cycle subtopics within current topic',
    helpGroup: 'navigate',
    handler: (e) => {
      const k = e.key;
      if (k === '[' || k === ']') {
        const gid = nav.focusGid;
        if (gid == null) return false;
        const doc = App.state.positionAnchors?.[String(gid)];
        const positions = (doc?.positions || []).filter(p => p.count > 0);
        if (positions.length === 0) return false;
        const realIdxs = (doc.positions || []).map((p, i) => ({ p, i })).filter(o => o.p.count > 0).map(o => o.i);
        const currIdx = realIdxs.indexOf(currentFocusedPosition?.posIdx ?? nav.focusPosIdx ?? -1);
        let nextIdx;
        if (currIdx < 0) nextIdx = 0;
        else nextIdx = (currIdx + (k === ']' ? 1 : -1) + realIdxs.length) % realIdxs.length;
        focusPosition(doc.cl, gid, realIdxs[nextIdx]);
        e.preventDefault();
        return true;
      }
      if (k === '{' || k === '}') {
        const cl = nav.focusCl;
        if (cl == null) return false;
        const subs = App.state.subMeta?.[String(cl)] || [];
        if (subs.length === 0) return false;
        const gidList = subs.map(s => App.subGidMap.byLocal[cl]?.[s.sub]).filter(g => g != null);
        if (gidList.length === 0) return false;
        const curr = gidList.indexOf(nav.focusGid);
        const idx = curr < 0 ? 0 : (curr + (k === '}' ? 1 : -1) + gidList.length) % gidList.length;
        nav.focus({ cl, gid: gidList[idx] });
        e.preventDefault();
        return true;
      }
      return false;
    },
  });

  // ─── Control pad ─────────────────────────────────────────────
  // Pad buttons mirror arrow keys: the button arrow points at where content
  // will move on screen. Speed scales with distance for proportional feel.
  const padHandlers = {
    up:    () => { const s = padZoomScale(); globe.nudge(0, -120 * s); },
    down:  () => { const s = padZoomScale(); globe.nudge(0, 120 * s); },
    left:  () => { const s = padZoomScale(); globe.nudge(-120 * s, 0); },
    right: () => { const s = padZoomScale(); globe.nudge(120 * s, 0); },
    zoomin:  () => globe.zoom(0.85),
    zoomout: () => globe.zoom(1.18),
  };
  function padZoomScale() {
    return Math.max(0.35, (globe.distanceTarget || 3) / 3.0);
  }
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

  // ─── Floating cluster + subcluster labels ──────────────────────
  let labelsEnabled = true;
  const labelSvg = document.getElementById('globe-labels');

  // Build cluster labels, anchored at density peaks (not centroids).
  const clusterLabelEls = new Map();
  for (const [clStr, meta] of Object.entries(App.state.clusterMeta)) {
    const cl = +clStr;
    const a = clusterAnchor(App.state, cl);
    if (!a) continue;
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.classList.add('lbl-cluster');
    t.textContent = meta.name;
    t.style.fill = sphereColor(cl);
    labelSvg.appendChild(t);
    clusterLabelEls.set(cl, { el: t, lat: a.lat, lon: a.lon, cl, density: a.density, count: a.count, name: meta.name });
    // Secondary peaks for very sprawly clusters — a second, smaller label.
    if (a.peaks && a.peaks.length > 1) {
      for (let i = 1; i < Math.min(a.peaks.length, 2); i++) {
        const p = a.peaks[i];
        if (p.density < 0.08) continue;   // skip thin peaks
        const t2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t2.classList.add('lbl-cluster', 'lbl-secondary');
        t2.textContent = meta.name;
        t2.style.fill = sphereColor(cl);
        labelSvg.appendChild(t2);
        clusterLabelEls.set(`${cl}_s${i}`, {
          el: t2, lat: p.lat, lon: p.lon, cl, density: p.density,
          count: Math.round(a.count * p.density / a.density), name: meta.name, secondary: true
        });
      }
    }
  }

  const subLabelEls = new Map();
  // cl == null → build sub labels for ALL clusters (used at close zoom
  // without focus). cl != null → build only that cluster's subs.
  function rebuildSubLabels(cl) {
    for (const e of subLabelEls.values()) e.el.remove();
    subLabelEls.clear();
    const clusters = cl == null
      ? Object.keys(App.state.subMeta || {}).map(Number)
      : [cl];
    for (const c of clusters) {
      const subs = (App.state.subMeta[String(c)] || []);
      for (const s of subs) {
        const a = subAnchor(App.state, c, s.sub);
        if (!a) continue;
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.classList.add('lbl-sub');
        // Subtopic labels carry their parent cluster's colour proudly —
        // not a faint white. Stroke (set in cards.css) keeps them legible
        // against the globe.
        t.style.fill = clusterColor(c);
        t.style.fontWeight = '600';
        t.textContent = s.name;
        labelSvg.appendChild(t);
        subLabelEls.set(`${c}_${s.sub}`, { el: t, lat: a.lat, lon: a.lon, count: a.count, name: s.name, cl: c });
      }
    }
  }
  // Boot with the all-clusters set so close zoom shows subcluster labels
  // even before the user drills into anything.
  rebuildSubLabels(null);

  // ─── Position labels (sub-sub, LLM statement-style) ─────────────
  // Only populated when a specific subtopic is focused. Each label is
  // rendered as a little flag-shaped stance statement anchored at the
  // density peak of points attributed to that position.
  const posLabelEls = [];   // live position DOM elements
  // Position flags on the globe are disabled. They anchored each LLM
  // position to a single density-peak point, which was misleading —
  // positions should describe *stances held across many points*, not
  // one. The L3 nav stripe is the only place they surface now.
  function rebuildPositionLabels(_cl, _gid) {
    for (const e of posLabelEls) e.el.remove();
    posLabelEls.length = 0;
  }

  // A single named timer for deferred focusPosition() calls. Several call
  // sites used to use raw `setTimeout(() => focusPosition(...), 180)` with
  // no cancellation hook; if the user clicked twice quickly, both fired
  // and the second one fought the first. Funnel them all through this
  // helper so a fresh schedule cancels the prior one.
  let _focusPosTimer = null;
  function scheduleFocusPosition(cl, gid, posIdx, delay) {
    if (_focusPosTimer != null) clearTimeout(_focusPosTimer);
    _focusPosTimer = setTimeout(() => {
      _focusPosTimer = null;
      focusPosition(cl, gid, posIdx);
    }, delay);
  }

  let currentFocusedPosition = null;   // { cl, gid, posIdx }
  function focusPosition(cl, gid, posIdx) {
    currentFocusedPosition = { cl, gid, posIdx };
    applyPositionHighlight(cl, gid, posIdx);
    const g = App.subGidMap.byGid[gid];
    const doc = App.state.positionAnchors[String(gid)];
    const pos = doc?.positions?.[posIdx];
    if (pos && pos.lat != null) {
      // Fixed framing distance — do not fold scroll-zoom into _canonicalDistance
      // or "Reset view" / Esc cannot zoom back out after the user scrolls in.
      globe.rotateTo(pos.lat, pos.lon, CLOSE_FRAMING);
      pulseAt(pos.lat, pos.lon, sphereColor(cl));
    }
    // Mark the selected flag
    posLabelEls.forEach(p => p.el.classList.toggle('selected', p.posIdx === posIdx));
    if (typeof writeHash === 'function') writeHash();
  }

  // Dim all points except those attributed to this (cl, sub, posIdx).
  function applyPositionHighlight(cl, gid, posIdx) {
    // Route through the composite filter so position drill-down
    // intersects with (not overwrites) any active subreddit filter +
    // search-paint state.
    globe.setHighlight({ cl, gid, posIdx });
  }

  window.App.focusPosition = focusPosition;
  window.App.showSnippetCard = (hit) => {
    const label = hit.context || hit.clusterName || '';
    showDetailCard({ _metaOverride: label, title: '', body: hit.label || '', permalink: null });
  };

  // ─── Per-post text search across the chunk corpus ────────────────────
  const _searchAPI = initSearchFind({ App, globe, getPointDetails, showDetailCard,
    setSelection: _setSelection });
  const ensureAllChunksLoaded = _searchAPI.ensureAllChunksLoaded;
  const findPointsContaining = _searchAPI.findPointsContaining;
  const findPointForSnippet = _searchAPI.findPointForSnippet;
  const pinPointByIndex = _searchAPI.pinPointByIndex;

  // ─── URL hash + browser history ──────────────────────────────────
  const _urlAPI = initUrlState({ App, globe, nav, store, focusPosition,
    toggleSubredditFilter });
  writeHash = _urlAPI.writeHash;
  const applyHash = _urlAPI.applyHash;

  // L3 position-bar clicks emit a nav focus with posIdx set; route those
  // to focusPosition so the highlight + zoom actually fire. Guarded on
  // posIdx change to avoid re-calling on every filter tweak.
  let _lastFocusPosKey = null;
  nav.addEventListener("focus", (ev) => {
    const { cl, gid, posIdx } = ev.detail || {};
    if (cl == null || gid == null || posIdx == null) {
      _lastFocusPosKey = null;
      writeHash();
      return;
    }
    const key = cl + ":" + gid + ":" + posIdx;
    if (key === _lastFocusPosKey) return;
    _lastFocusPosKey = key;
    focusPosition(cl, gid, posIdx);
  });

  // Projection + per-frame label placement with greedy non-overlap.
  const proj = new THREE.Vector3();
  function approxTextSize(text, fontSize) {
    return { w: (text?.length || 0) * fontSize * 0.55, h: fontSize * 1.1 };
  }
  // Position flag screen-projection (each frame).
  function updatePositionFlags() {
    if (!posLabelEls.length) return;
    const w = globe.canvas.clientWidth, h = globe.canvas.clientHeight;
    const camPos = globe.camera.position;
    const v = new THREE.Vector3();
    for (const info of posLabelEls) {
      const wp = globe.worldPositionOf(info.lat, info.lon, POINT_RADIUS);
      const facing = wp.x*(camPos.x-wp.x) + wp.y*(camPos.y-wp.y) + wp.z*(camPos.z-wp.z);
      if (facing <= 0) { info.el.style.opacity = '0'; info.el.style.pointerEvents = 'none'; continue; }
      v.copy(wp).project(globe.camera);
      if (v.z > 1) { info.el.style.opacity = '0'; continue; }
      const sx = (v.x * 0.5 + 0.5) * w;
      const sy = (-v.y * 0.5 + 0.5) * h;
      info.el.style.transform = `translate(${sx}px, ${sy}px)`;
      info.el.style.opacity = String(Math.min(1, 0.6 + 0.4 * Math.min(1, facing)));
      info.el.style.pointerEvents = 'auto';
    }
  }

  // Off-screen focus compass: arrow at the globe's edge pointing toward the
  // focused target when it's hidden on the far side of the sphere.
  const compassEl = document.getElementById('focus-compass');
  if (compassEl) {
    compassEl.addEventListener('click', () => {
      const t = currentFocusTarget();
      if (!t) return;
      globe.rotateTo(t.lat, t.lon, t.distance);
      pulseAt(t.lat, t.lon, t.color);
    });
  }
  function currentFocusTarget() {
    if (currentFocusedPosition) {
      const { cl, gid, posIdx } = currentFocusedPosition;
      const doc = App.state.positionAnchors?.[String(gid)];
      const p = doc?.positions?.[posIdx];
      if (p?.lat != null) return { lat: p.lat, lon: p.lon, distance: CLOSE_FRAMING, color: sphereColor(cl) };
    }
    if (nav.focusGid != null) {
      const g = App.subGidMap.byGid[nav.focusGid];
      if (g) {
        const a = subAnchor(App.state, g.cl, g.sub);
        if (a) return { lat: a.lat, lon: a.lon, distance: SUB_FRAMING, color: sphereColor(g.cl) };
      }
    }
    if (nav.focusCl != null) {
      const a = clusterAnchor(App.state, nav.focusCl);
      if (a) return { lat: a.lat, lon: a.lon, distance: TOPIC_FRAMING, color: sphereColor(nav.focusCl) };
    }
    return null;
  }
  function updateFocusCompass() {
    if (!compassEl) return;
    const t = currentFocusTarget();
    if (!t) { compassEl.classList.remove('show'); return; }
    const wp = globe.worldPositionOf(t.lat, t.lon, 1.0);
    const camPos = globe.camera.position;
    const facing = wp.x*(camPos.x - wp.x) + wp.y*(camPos.y - wp.y) + wp.z*(camPos.z - wp.z);
    // Hide when target is facing the camera (front-of-globe, already visible).
    if (facing > 0.05) { compassEl.classList.remove('show'); return; }
    // Project onto screen; for far-side points the projection flips through
    // infinity, so instead compute a 2-D direction from the globe center.
    const w = globe.canvas.clientWidth, h = globe.canvas.clientHeight;
    const center = new THREE.Vector3(0, 0, 0).project(globe.camera);
    const cx = (center.x * 0.5 + 0.5) * w;
    const cy = (-center.y * 0.5 + 0.5) * h;
    // For back-facing points, negate to flip to the "behind" direction on-screen.
    const v = wp.clone().project(globe.camera);
    let dx = v.x * 0.5 * w, dy = -v.y * 0.5 * h;
    // If behind camera (v.z > 1), the projected x,y are mirrored — reverse.
    const flipped = (v.z > 1) || (facing < 0);
    if (flipped) { dx = -dx; dy = -dy; }
    const mag = Math.hypot(dx, dy) || 1;
    // Sit at 78% of the smaller half-dimension from the globe center.
    const edge = 0.42 * Math.min(w, h);
    const px = cx + (dx / mag) * edge;
    const py = cy + (dy / mag) * edge;
    compassEl.style.left = `${px}px`;
    compassEl.style.top = `${py}px`;
    compassEl.style.borderColor = t.color;
    compassEl.style.color = t.color;
    const angleDeg = Math.atan2(dy, dx) * 180 / Math.PI + 90;   // ▲ points up by default
    const arrow = compassEl.querySelector('.fc-arrow');
    if (arrow) arrow.style.transform = `rotate(${angleDeg}deg)`;
    compassEl.classList.add('show');
  }

  globe._onFrame = () => {
    // Pin DOM projection is owned by globe._tick now (runs immediately
    // after the camera tween updates), so we only drive the auxiliary
    // overlays from the per-frame hook.
    updatePositionFlags?.();
    updateFocusCompass?.();
    updateHoverHalo?.();
    updateSprouts?.();
    if (!labelsEnabled) {
      for (const info of clusterLabelEls.values()) info.el.style.opacity = '0';
      for (const info of subLabelEls.values()) info.el.style.opacity = '0';
      return;
    }
    const w = globe.canvas.clientWidth;
    const h = globe.canvas.clientHeight;
    const camPos = globe.camera.position;
    const dist = globe.distance;
    const zoomNorm = Math.max(0, Math.min(1, (dist - 1.18) / (3.0 - 1.18)));   // 0 close, 1 far
    const showSubs = nav.focusCl != null || dist < 1.85;
    const placed = [];

    function project(info, fontSize, strongPri = false) {
      if (!Number.isFinite(info.lat) || !Number.isFinite(info.lon)) return null;
      const wp = globe.worldPositionOf(info.lat, info.lon, 1.0);
      const facing = wp.x*(camPos.x-wp.x) + wp.y*(camPos.y-wp.y) + wp.z*(camPos.z-wp.z);
      if (facing <= 0) return null;
      proj.copy(wp).project(globe.camera);
      if (proj.z > 1) return null;
      const sx = (proj.x * 0.5 + 0.5) * w;
      const sy = (-proj.y * 0.5 + 0.5) * h;
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) return null;
      const sz = approxTextSize(info.el.textContent || '', fontSize);
      const pad = strongPri ? 2 : 6;
      const box = { x0: sx - sz.w/2 - pad, x1: sx + sz.w/2 + pad, y0: sy - sz.h/2 - pad, y1: sy + sz.h/2 + pad };
      return { sx, sy, box, facing };
    }
    function tryPlace(info, fontSize, opacityScale, strong = false) {
      const r = project(info, fontSize, strong);
      if (!r) return false;
      for (const p of placed) {
        if (r.box.x1 < p.x0 || r.box.x0 > p.x1) continue;
        if (r.box.y1 < p.y0 || r.box.y0 > p.y1) continue;
        return false;
      }
      placed.push(r.box);
      info.el.setAttribute('x', r.sx);
      info.el.setAttribute('y', r.sy);
      info.el.style.fontSize = `${fontSize}px`;
      info.el.style.opacity = String(Math.min(1, (0.5 + 0.5 * r.facing) * opacityScale));
      info.el.style.display = '';
      return true;
    }

    // Spherical-distance helper for distance-weighted fade (gestalt hierarchy:
    // nearby siblings stay legible, distant ones dissolve into the globe).
    function angDistTo(info, axyz) {
      if (!axyz || info.lat == null) return Math.PI;
      const [x,y,z] = latLonToXYZ(info.lat, info.lon, 1.0);
      const d = x*axyz[0] + y*axyz[1] + z*axyz[2];
      return Math.acos(Math.max(-1, Math.min(1, d)));
    }
    // Anchor xyz for the currently focused cluster / sub (if any).
    let focusClXYZ = null, focusSubXYZ = null;
    if (nav.focusCl != null) {
      const a = clusterAnchor(App.state, nav.focusCl);
      if (a) focusClXYZ = latLonToXYZ(a.lat, a.lon, 1.0);
    }
    if (nav.focusGid != null) {
      const g = App.subGidMap.byGid[nav.focusGid];
      if (g) { const a = subAnchor(App.state, g.cl, g.sub); if (a) focusSubXYZ = latLonToXYZ(a.lat, a.lon, 1.0); }
    }

    // Pass 1: focused cluster + its subs get top priority. When a sub is
    // focused and positions are showing, dim unrelated sub labels so the
    // focus sub's position flags can breathe.
    if (nav.focusCl != null) {
      const focusInfo = clusterLabelEls.get(nav.focusCl);
      if (focusInfo) {
        if (!tryPlace(focusInfo, 14, 1, true)) focusInfo.el.style.opacity = '0';
      }
      const focusGid = nav.focusGid;
      const focusKey = focusGid != null ? (() => {
        const g = App.subGidMap.byGid[focusGid];
        return g ? `${g.cl}_${g.sub}` : null;
      })() : null;
      for (const [key, info] of subLabelEls) {
        const size = 11 + (1 - zoomNorm) * 1.5;
        let op;
        if (focusKey == null) {
          op = 1;
        } else if (key === focusKey) {
          op = 1;
        } else {
          // Fade sub labels by angular distance to the focused sub, but
          // keep the falloff gentler than before so the cluster's other
          // subtopics still read brightly nearby.
          const ang = angDistTo(info, focusSubXYZ);
          op = Math.max(0.35, 0.95 - ang * 0.75);
        }
        if (!tryPlace(info, size, op)) info.el.style.opacity = '0';
      }
    }

    // Pass 2: cluster labels. When drilled into a single cluster, we hide
    // every OTHER cluster's label — only the focused cluster's label
    // stays (rendered in the "focused" big style by Pass 1, so we just
    // clear the rest). This keeps the globe readable at subtopic level.
    if (nav.focusCl != null) {
      for (const [, info] of clusterLabelEls) {
        if (info.cl !== nav.focusCl) info.el.style.opacity = '0';
      }
    } else {
      const primaries = [];
      const secondaries = [];
      for (const [, info] of clusterLabelEls) {
        (info.secondary ? secondaries : primaries).push(info);
      }
      // Order by importance: large + dense first so they claim space.
      primaries.sort((a, b) => (b.count * b.density) - (a.count * a.density));
      // Cluster labels shrink slightly at far zoom so many can coexist.
      // Size also scales with the log(count) so giant clusters read first.
      const baseSize = 10.5 + (1 - zoomNorm) * 2.2;
      // Count range for the live label set (used to normalize sizing).
      let maxCount = 0;
      for (const info of primaries) if (info.count > maxCount) maxCount = info.count;
      for (const info of primaries) {
        const w = maxCount > 0 ? Math.log(1 + info.count) / Math.log(1 + maxCount) : 0.5;
        const size = baseSize + 2.5 * w;   // range ~10.5..15
        if (!tryPlace(info, size, 1.0)) info.el.style.opacity = '0';
      }
      for (const info of secondaries) {
        if (!tryPlace(info, baseSize * 0.82, 0.75)) info.el.style.opacity = '0';
      }
    }

    // Pass 3: at close zoom without focus, fade in all subcluster labels
    // so the user can see the finer-grained topics as they zoom in.
    if (nav.focusCl == null) {
      // Fade schedule: dist 1.85 → 0 (invisible), dist 1.30 → 1 (full).
      // Same thresholds that previously gated the auto-popping captions.
      const t = Math.max(0, Math.min(1, (1.85 - dist) / (1.85 - 1.30)));
      if (t > 0.02) {
        const size = 10.5 + (1 - zoomNorm) * 1.2;
        for (const [, info] of subLabelEls) {
          if (!tryPlace(info, size, t)) info.el.style.opacity = '0';
        }
      } else {
        for (const [, info] of subLabelEls) info.el.style.opacity = '0';
      }
    }
  };

  // Rebuild sub labels + position labels when focus changes.
  nav.addEventListener('focus', (ev) => {
    rebuildSubLabels(ev.detail.cl);
    rebuildPositionLabels(ev.detail.cl, ev.detail.gid);
    // Clear prior position focus when the new focus has no posIdx.
    if (ev.detail.posIdx == null) {
      currentFocusedPosition = null;
    }
  });

  function interviewQuotes(iv) {
    if (!iv) return [];
    const arr = iv.quotes;
    if (Array.isArray(arr) && arr.length) return arr.map(x => String(x).trim()).filter(Boolean);
    if (iv.quote) return [String(iv.quote).trim()].filter(Boolean);
    return [];
  }
  // Per-id character sketches for the 18 interviews. interviews.json only
  // carries `id`, `themes`, `quotes` — no role/bio/lives — so a generic
  // theme-list template ("Cares about X, Y, Z.") reads like metadata
  // instead of a person. Hand-written sentences below paint each Px as
  // a human carrying those concerns, without fabricating demographics.
  const INTERVIEW_SKETCHES = {
    P1: "High schoolers caught at Quincy Red Line, walking-and-bussing to school and the mall while their family scouts a Braintree house to rent the old one out.",
    P2: "Legal assistant a week from retirement, lives on the water in Squantum and rides the ferry downtown — calls it half an hour of pure delight.",
    P3: "Retired homemaker and kids' crossing guard, interviewed at a Bánh Mi shop; her one transit wish is a self-driving car so she never parallel-parks again.",
    P4: "MBTA Transit Ambassador out of Weymouth, drives to a different assigned station every shift because most of them have nowhere for staff to park.",
    P5: "Electrician on the Braintree Commuter Rail platform, two hours each way to a Chelsea jobsite, finishes the trip on an electric scooter to skip parking.",
    P6: "Construction worker at the Braintree bus station, lives in Weymouth where no transit runs Sunday, so the only way to the station that day is an Uber.",
    P7: "Pastry chef at UMass/JFK working Back Bay and Seaport kitchens, has lived in Braintree, Southie, Beacon Hill, and Dorchester chasing a shorter commute.",
    P8: "South Shore high schoolers — Weymouth, Scituate — riding the commuter rail an hour-plus each way to a Boston exam school, making the case for free fares.",
    P9: "Practice assistant at Brigham and Women's, catches the 4:25am train out of Bedford because it was the only apartment that felt affordable after New York.",
    P10: "UMass Boston student commuting in from Brockton, juggling commuter rail and a bus-to-Red-Line backup once the morning trains stop running direct.",
    P11: "Delivers medical equipment for Boston Scientific from Dorchester to Quincy by commuter rail, glad to skip car payments, gas, and worrying about accidents.",
    P12: "Boston Public Schools teacher who bought a Dorchester house through the city's first-time buyer program and drives to Hyde Park; pregnant wife rides the T.",
    P13: "Medical technician in from Middleborough, 45 minutes by commuter rail and bus to Beth Israel, points out the MBTA app itself logs his line under 75% on-time.",
    P14: "UMass Amherst student raised in Brockton, home for the weekend at JFK/UMass, says he's actually happy with how transit works for him.",
    P15: "Startup CTO who left Seattle for SF to launch a company, takes two MUNI buses thirty minutes each way and wants the connection to vanish.",
    P16: "Medford homeowner Andrea, decade of working from home, wants to move into Cambridge to drop one car after her express bus was paused for COVID and never restored.",
    P17: "Philly resident from Fairmount visiting friends in Boston, drives 30 minutes to a New Jersey desk job in industrial pump rentals, frustrated PA transit lives or dies on state funding.",
    P18: "MIT postdoc, 31, lives in Somerville with three housemates because the salary won't cover a one-bedroom; bikes to lab year-round and calls Boston riding life-threatening.",
  };
  // Build a one-line human descriptor for an interview. Prefers a
  // hand-written sketch keyed by id; falls back to a themes paraphrase
  // for any interview added later that we haven't sketched yet.
  function interviewDescriptor(iv) {
    if (!iv) return '';
    const sketch = INTERVIEW_SKETCHES[iv.id];
    if (sketch) return sketch;
    const themes = Array.isArray(iv.themes) ? iv.themes.map(t => String(t).trim()).filter(Boolean) : [];
    if (!themes.length) return 'A street voice from the Boston housing & transit conversation.';
    const picks = themes.slice(0, 3);
    let phrase;
    if (picks.length === 1) phrase = picks[0];
    else if (picks.length === 2) phrase = `${picks[0]} and ${picks[1]}`;
    else phrase = `${picks.slice(0, -1).join(', ')}, and ${picks[picks.length - 1]}`;
    return `Carries the ${phrase} side of the conversation.`;
  }
  function subtopicLineForPin(pin) {
    if (pin == null || pin.sub == null) return '';
    const subs = App.state.subMeta?.[String(pin.cluster)] || [];
    const hit = subs.find(s => s.sub === pin.sub);
    return hit?.name || '';
  }

  // ─── Interview pins ───────────────────────────────────────────
  // (Pins themselves are built earlier in boot, right after GlobeView, so
  // they exist before tour beat 2 can reference them. The voices-list and
  // pin click wiring below depends only on App.state, not on pin DOM.)

  // Build voices list: 18 interviews grouped by cluster, each with a
  // quote excerpt so the user can scan for what interests them.
  const voicesInline = document.getElementById('voices-list-inline');
  (() => {
    const placements = App.state.interviewPins?.placements || [];
    if (!voicesInline || !placements.length) return;
    const ivMap = new Map((App.state.interviews?.interviews || []).map(iv => [iv.id, iv]));
    // Group by cluster (name → array of placements).
    const byCluster = new Map();
    for (const p of placements) {
      const name = App.state.clusterMeta?.[String(p.cluster)]?.name || `Topic ${p.cluster}`;
      if (!byCluster.has(p.cluster)) byCluster.set(p.cluster, { name, items: [] });
      byCluster.get(p.cluster).items.push(p);
    }
    // Order by cluster count desc (larger clusters first = more familiar).
    const groups = [...byCluster.entries()]
      .sort((a, b) => b[1].items.length - a[1].items.length);
    for (const g of groups) g[1].items.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));

    voicesInline.innerHTML = `<div class="vli-head"><span>Street interviews</span><span>${placements.length}</span></div>`;
    for (const [cl, g] of groups) {
      const col = sphereColor(cl);
      const groupEl = document.createElement('div');
      groupEl.className = 'voices-group';
      groupEl.innerHTML = `
        <div class="voices-group-head" style="--g-color:${col}">
          <span class="vg-dot" style="background:${col}"></span>
          <span class="vg-name">${escapeHtml(g.name)}</span>
          <span class="vg-count">${g.items.length}</span>
        </div>
      `;
      for (const p of g.items) {
        const iv = ivMap.get(p.id);
        const el = document.createElement('div');
        el.className = 'voice-item';
        el.dataset.id = p.id;
        const qs = interviewQuotes(iv);
        const preview = (qs[0] || '').trim();
        const themes = (iv?.themes || []).slice(0, 4);
        const themeHtml = themes.length
          ? `<div class="v-themes">${themes.map(t => `<button type="button" class="v-theme" data-theme="${escapeHtml(t)}" title="Search topics + posts for: ${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}</div>`
          : '';
        el.innerHTML = `
          <div class="v-head">
            <span class="v-id">${escapeHtml(p.id)}</span>
          </div>
          ${preview ? `<div class="v-quote">"${escapeHtml(preview)}"</div>` : ''}
          ${themeHtml}
        `;
        el.onclick = (evt) => {
          // Theme chip click: don't open the interview — run a search.
          const chip = evt.target.closest?.('.v-theme');
          if (chip) {
            evt.stopPropagation();
            const theme = chip.dataset.theme || '';
            const input = document.getElementById('search-input');
            if (input) {
              input.value = theme;
              input.focus();
              input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return;
          }
          globe.rotateTo(p.lat, p.lon, ZOOM_TO_POINT_FRAMING);
          const data = {
            ...p,
            cluster_name: App.state.clusterMeta?.[String(p.cluster)]?.name,
          };
          voicesInline.classList.add('hidden');
          document.getElementById('btn-voices').classList.remove('on');
          showInterviewCard(data);
          document.querySelectorAll('.voice-item').forEach(x => x.classList.toggle('selected', x.dataset.id === p.id));
          document.querySelectorAll('.pin').forEach(x => x.classList.toggle('selected', x.dataset.id === p.id));
        };
        groupEl.appendChild(el);
      }
      voicesInline.appendChild(groupEl);
    }
  })();

  // Toolbar: voices toggle shows the list inside the inspector body.
  const btnVoices = document.getElementById('btn-voices');
  if (btnVoices) btnVoices.onclick = () => {
    const showing = voicesInline.classList.toggle('hidden');
    btnVoices.classList.toggle('on', !showing);
    if (!showing) {
      // Showing voices → hide other cards
      hidePinnedView();
      document.getElementById('interview-card').classList.add('hidden');
      hideInspectorEmpty();
      clearSelectedPoint();
    } else {
      showInspectorEmpty();
    }
  };

  // Pin tooltip — uses the same floating card as globe-point hovers, so
  // street-interview pins feel like full "comments" rather than tiny
  // hover chips. The P# avatar is shown as a meta eyebrow.
  function showPinTooltip({ pin, clientX, clientY }) {
    if (_cursorOverCard) return;
    const iv = (App.state.interviews?.interviews || []).find(x => x.id === pin.id) || {};
    const cl = pin.cluster;
    const clColor = sphereColor(cl);
    const clName = pin.cluster_name || (App.state.clusterMeta?.[String(cl)]?.name) || `Topic ${cl}`;
    const subn = subtopicLineForPin(pin);
    const topicHead = subn ? `${clName} · ${subn}` : clName;
    const quotes = interviewQuotes(iv);
    const body = quotes.map(q => `“${q}”`).join('\n\n');
    pointTooltip.innerHTML = `
      <div class="hv-cluster" style="color:${clColor}">${escapeHtml(pin.id)} · ${escapeHtml(clName)}</div>
      <div class="hv-meta">${escapeHtml(topicHead)}</div>
      <div class="hv-title">Street voice</div>
      ${body ? `<div class="hv-body">${escapeHtml(body)}</div>` : ''}
    `;
    pointTooltip.classList.remove('hidden');
    pointTooltip.classList.add('visible');
    if (clientX != null) positionTooltip(clientX, clientY);
  }
  function hidePinTooltip() {
    pointTooltip.classList.remove('visible');
    pointTooltip.classList.add('hidden');
  }

  // Interview + pinned cards live INSIDE #insp-body — the permanent
  // bottom pane of the 50/50 nav split. They stack naturally and replace
  // the empty/intro state when active.
  const ic = document.getElementById('interview-card');
  const pvEl = dom.el('pinnedView');
  // Empty-state restoration: the bottom (details) pane is permanent.
  // Whenever every card in it is hidden, ensure the intro / empty state
  // is visible so the pane never reads as a blank dark band. Watching
  // class attributes catches every hide path (pv-back, Esc, tour
  // cleanup, hideInterviewCard, etc.) without us having to rewrite each
  // callsite.
  (() => {
    const navCards = [pvEl, ic].filter(Boolean);
    const inspEmptyEl = document.getElementById('insp-empty-main');
    if (navCards.length === 0 || !inspEmptyEl) return;
    const voicesEl = document.getElementById('voices-list-inline');
    const refresh = () => {
      const anyVisible = navCards.some(c => !c.classList.contains('hidden'))
        || (voicesEl && !voicesEl.classList.contains('hidden'));
      // When any inspector card is showing, hide the empty/intro and clear
      // the intro-globe highlight. When nothing is showing, restore it.
      if (anyVisible) {
        if (!inspEmptyEl.classList.contains('hidden')) {
          inspEmptyEl.classList.add('hidden');
          inspEmptyEl.classList.add('compact');
          try { storage.set('intro-seen', '1'); } catch {}
          try { clearIntroGlobeHighlightIfActive(); } catch {}
        }
      } else {
        if (inspEmptyEl.classList.contains('hidden')) {
          inspEmptyEl.classList.remove('hidden');
          try { syncIntroGlobeHighlight?.(); } catch {}
        }
      }
    };
    const obs = new MutationObserver(refresh);
    for (const c of navCards) obs.observe(c, { attributes: true, attributeFilter: ['class'] });
    if (voicesEl) obs.observe(voicesEl, { attributes: true, attributeFilter: ['class'] });
    refresh();
  })();
  const icClose = document.getElementById('ic-close');
  if (icClose) icClose.onclick = () => hideInterviewCard();
  function hideInterviewCard() {
    if (ic) ic.classList.add('hidden');
    document.querySelectorAll('.pin.selected').forEach(el => el.classList.remove('selected'));
  }
  async function showInterviewCard(pin) {
    if (!ic) return;
    hidePinnedView();
    clearSelectedPoint();
    if (voicesInline) voicesInline.classList.add('hidden');
    const btnV = document.getElementById('btn-voices'); if (btnV) btnV.classList.remove('on');
    hideInspectorEmpty();
    const iv = (App.state.interviews?.interviews || []).find(x => x.id === pin.id);
    if (!iv) return;
    const color = sphereColor(pin.cluster);
    const quotes = interviewQuotes(iv);
    const quotesHtml = quotes.length
      ? `<div class="ic-quotes">${quotes.map(q => `<blockquote class="ic-quote" style="border-left-color:${color}">“${escapeHtml(q)}”</blockquote>`).join('')}</div>`
      : '';
    const descriptor = interviewDescriptor(iv);
    ic.innerHTML = `
      <button class="ic-close" id="ic-close-btn" aria-label="Close">×</button>
      <div class="ic-head">
        <span class="ic-pin-chip" style="--rc-color:${color}">${escapeHtml(pin.id)}</span>
        <p class="ic-descriptor">${escapeHtml(descriptor)}</p>
      </div>
      ${quotesHtml}
    `;
    ic.classList.remove('hidden');
    scrollCardIntoView(ic);
    document.getElementById('ic-close-btn').onclick = hideInterviewCard;
    // Rotate the globe so the pin faces the camera, then drop the pulse.
    globe.rotateTo(pin.lat, pin.lon, STANCE_FRAMING);
    pulseAt(pin.lat, pin.lon, sphereColor(pin.cluster));
  }

  // ─── Landing-pulse: fires once when we rotate to a target, giving the
  //     eye a place to land as the globe spins (gestalt continuity).
  const overlayEl = document.getElementById('globe-overlay');
  function pulseAt(lat, lon, color = null) {
    if (!overlayEl) return;
    // Wait a tick so rotateTo's quaternion target has been applied to the
    // world group; we project against the *current* quaternion in rAF.
    const el = document.createElement('div');
    el.className = 'landing-pulse';
    if (color) el.style.borderColor = color;
    overlayEl.appendChild(el);
    let frames = 0;
    const tick = () => {
      if (frames > 54 || !el.isConnected) { el.remove(); return; }
      const wp = globe.worldPositionOf(lat, lon, 1.005);
      const camPos = globe.camera.position;
      const facing = wp.x*(camPos.x-wp.x) + wp.y*(camPos.y-wp.y) + wp.z*(camPos.z-wp.z);
      if (facing > 0) {
        const p = wp.clone().project(globe.camera);
        const sx = (p.x * 0.5 + 0.5) * globe.canvas.clientWidth;
        const sy = (-p.y * 0.5 + 0.5) * globe.canvas.clientHeight;
        el.style.left = `${sx}px`;
        el.style.top = `${sy}px`;
        el.style.opacity = '';
      } else {
        el.style.opacity = '0';
      }
      frames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(() => el.remove(), 1100);
  }

  // Esc cascade (#28): scattershot dismissal owns the highest non-tour Esc
  // slot. When sprouts are up, Esc dismisses just them and stops the
  // cascade so pinned cards / search / camera-zoom stay put. When sprouts
  // are absent it falls through to the priority-50 handlers below.
  keys.bind({
    keys: ['Escape'],
    priority: 75,
    label: 'esc-clear-sprouts',
    helpHidden: true,
    handler: (e) => {
      const sproutHang = sproutsEl?.querySelector?.('.sprout, .sprout-anchor');
      const hasSprouts = _spaceDown || activeSprouts.length > 0 || !!sproutHang;
      if (!hasSprouts) return false;
      _spaceDown = false;
      cancelSproutClearTimer();
      window.App.clearSprouts({ immediate: true });
      e.preventDefault();
      return true;
    },
  });
  keys.bind({
    keys: ['Escape'],
    priority: 50,
    label: 'esc-clear-pinned-point',
    helpHidden: true,
    handler: (e) => {
      if (pinnedPointIdx < 0) return false;
      clearSelectedPoint();
      e.preventDefault();
      return false;
    },
  });

  // Lookup of all points sharing the same Reddit thread (postId). Used
  // by `renderDetailContext` to populate the pinned-view's Thread Context
  // surface. Cached per postId for the life of the session.
  const siblingsCache = new Map();
  async function siblingsForThread(postId) {
    if (siblingsCache.has(postId)) return siblingsCache.get(postId);
    const st = App.state;
    // Coalesce all chunk fetches into a single Promise.all so a thread spanning
    // multiple chunks doesn't pay sequential round-trips. Previously each
    // unloaded chunk was awaited in series; on a cold cache that meant up to
    // 51 sequential 20MB fetches before the thread could render. With the idle
    // prefetcher most chunks are typically warm by the time a user pins a
    // post, but the worst-case (early pin / slow link) used to take seconds.
    const total = st.manifest.files.length;
    const promises = new Array(total);
    for (let ci = 0; ci < total; ci++) {
      let p = st.chunkCache.get(ci);
      if (!p) {
        const idx = ci;
        p = fetch('tsne_chunks/' + st.manifest.files[idx]).then(r => {
          if (!r.ok) throw new Error('chunk ' + idx + ' http ' + r.status);
          return r.json();
        });
        // Mirror the eviction discipline from search-find.js (#48): a rejected
        // promise stuck in the cache permanently poisons every later thread
        // load for any chunk that happened to flake on first fetch.
        p.catch(() => {
          if (st.chunkCache.get(idx) === p) st.chunkCache.delete(idx);
        });
        st.chunkCache.set(idx, p);
      }
      promises[ci] = p;
    }
    const chunks = await Promise.all(promises);
    const out = [];
    for (const c of chunks) {
      const off = c.offset;
      const links = c.permalink;
      for (let j = 0; j < c.n; j++) {
        const m = (links[j] || '').match(/\/comments\/([a-z0-9]+)\//);
        if (m && m[1] === postId) out.push(off + j);
      }
    }
    siblingsCache.set(postId, out);
    return out;
  }

  // ─── Pinned view (Reddit post/comment) — B1: lives in nav, not floating
  // Single-column thread layout: post on top, comments below, pinned row
  // gets an accent rail. See viz/css/pinned.css `.pv-row` family.
  const pinnedView    = dom.el('pinnedView');
  const pvBackBtn     = dom.el('pvBack');
  const pvForwardBtn  = dom.el('pvForward');
  const pvThreadEl    = dom.el('pvThread');
  // Clear button lives in the pane-header next to Back/Forward. Disabled when
  // nothing is pinned; click drops the thread + empties both nav stacks.
  const pvClearBtn    = document.getElementById('pv-clear');
  let _currentDetailPin = null;
  // Back/Forward stacks for pinned points (browser-history semantics).
  // Both capped at 10. Each entry is a pinned-pin payload (the same `d`
  // shape passed to showDetailCard). Back pops top → pushes current onto
  // Forward; Forward pops top → pushes current onto Back; any *new* pin
  // (via showDetailCard) clears the Forward stack.
  const PV_BACKSTACK_MAX = 10;
  const _pinnedBackStack = [];
  const _pinnedForwardStack = [];
  function _syncPvControls() {
    const canBack = _pinnedBackStack.length > 0;
    const canForward = _pinnedForwardStack.length > 0;
    const interviewOpen = !!ic && !ic.classList.contains('hidden');
    if (pvBackBtn) {
      pvBackBtn.disabled = !canBack;
      pvBackBtn.setAttribute('aria-disabled', canBack ? 'false' : 'true');
    }
    if (pvForwardBtn) {
      pvForwardBtn.disabled = !canForward;
      pvForwardBtn.setAttribute('aria-disabled', canForward ? 'false' : 'true');
    }
    // Clear is enabled whenever a pin is showing OR a P-pin interview card
    // is showing OR there is nav history in either direction.
    const canClear = !!_currentDetailPin || interviewOpen || canBack || canForward;
    if (pvClearBtn) {
      pvClearBtn.disabled = !canClear;
      pvClearBtn.setAttribute('aria-disabled', canClear ? 'false' : 'true');
    }
  }
  // Back-compat aliases — earlier code paths called _syncPvBackBtn().
  const _syncPvBackBtn = _syncPvControls;
  const _syncPvForwardBtn = _syncPvControls;
  function hidePinnedView() {
    if (!pinnedView) return;
    pinnedView.classList.add('hidden');
  }
  if (pvClearBtn) pvClearBtn.onclick = () => {
    // Clear becomes part of the navigation history: push the current pin
    // onto the back stack (so Back restores it), then drop the displayed
    // thread. The forward stack is dropped — Clear ends the user's
    // forward branch the same way a fresh pin would. Also dismisses the
    // P-pin interview card if one is open, so Clear is the single
    // "blank-slate" button regardless of which surface owns the focus.
    if (_currentDetailPin) {
      _pinnedBackStack.push(_currentDetailPin);
      if (_pinnedBackStack.length > PV_BACKSTACK_MAX) _pinnedBackStack.shift();
    }
    _pinnedForwardStack.length = 0;
    _currentDetailPin = null;
    hidePinnedView();
    hideInterviewCard();
    _syncPvControls();
    clearSelectedPoint();
  };
  // Shared re-pin helper: drives globe selection + camera and renders the
  // pinned view without touching either nav stack. Both Back and Forward
  // handlers route through here so the two flows stay symmetric.
  function _navigateToPin(target) {
    if (!target) return;
    if (typeof target.idx === 'number' && target.idx >= 0) {
      _setSelection({ pinnedIdx: target.idx });
      globe.setPinnedPoint(target.idx);
      const lat = App.state.coords?.[2 * target.idx];
      const lon = App.state.coords?.[2 * target.idx + 1];
      if (lat != null && lon != null) globe.rotateTo(lat, lon, ZOOM_TO_POINT_FRAMING);
    }
    _renderPinned(target);
  }
  if (pvBackBtn) pvBackBtn.onclick = () => {
    if (_pinnedBackStack.length === 0) return;
    const prev = _pinnedBackStack.pop();
    // Push the current pin onto the forward stack so Forward can return
    // to it. Cap at the same depth as the back stack.
    if (_currentDetailPin) {
      _pinnedForwardStack.push(_currentDetailPin);
      if (_pinnedForwardStack.length > PV_BACKSTACK_MAX) _pinnedForwardStack.shift();
    }
    _syncPvControls();
    _navigateToPin(prev);
  };
  if (pvForwardBtn) pvForwardBtn.onclick = () => {
    if (_pinnedForwardStack.length === 0) return;
    const next = _pinnedForwardStack.pop();
    // Push the current pin onto the back stack (mirror of Back's push to
    // forward) so the user can ← back to where they just were.
    if (_currentDetailPin) {
      _pinnedBackStack.push(_currentDetailPin);
      if (_pinnedBackStack.length > PV_BACKSTACK_MAX) _pinnedBackStack.shift();
    }
    _syncPvControls();
    _navigateToPin(next);
  };
  /** Prefer opening the Reddit thread in a new tab when we have a permalink. */
  function openRedditThreadOrDetail(d) {
    const raw = (d?.permalink || '').trim();
    if (raw) {
      const abs = /^https?:\/\//i.test(raw) ? raw : `https://www.reddit.com${raw.startsWith('/') ? '' : '/'}${raw}`;
      window.open(abs, '_blank', 'noopener,noreferrer');
      return;
    }
    showDetailCard(d);
  }
  // Public-stable name (search-find.js, App.showSnippetCard, etc. call this).
  // Renders into the new pinned-view inside the nav.
  function showDetailCard(d) {
    // Push the previous pin onto the back-stack so ← can return to it.
    // Skip the push when re-pinning the same idx (would just clutter the
    // stack with duplicates) or when there is no prior pin.
    const sameIdx =
      _currentDetailPin != null && d != null
      && _currentDetailPin.idx != null && d.idx != null
      && _currentDetailPin.idx === d.idx;
    if (_currentDetailPin && d && !sameIdx) {
      _pinnedBackStack.push(_currentDetailPin);
      if (_pinnedBackStack.length > PV_BACKSTACK_MAX) _pinnedBackStack.shift();
    }
    // Standard browser-history semantics: any *new* pin (i.e. not a same-idx
    // re-render) invalidates the forward stack. Back/Forward handlers route
    // through _renderPinned directly so they don't trip this clear.
    if (d && !sameIdx) _pinnedForwardStack.length = 0;
    _renderPinned(d);
  }
  function _renderPinned(d) {
    if (!pinnedView) return;
    if (ic) ic.classList.add('hidden');
    if (voicesInline) voicesInline.classList.add('hidden');
    const btnV = document.getElementById('btn-voices'); if (btnV) btnV.classList.remove('on');
    hideInspectorEmpty();
    _currentDetailPin = d;
    _syncPvControls();
    pinnedView.classList.remove('hidden');
    // Render an immediate fallback (just the pinned row, highlighted) so
    // the panel never appears empty while the thread fetch resolves.
    _paintThread(d, [], { loading: true });
    renderDetailContext(d).catch(() => {});
    scrollCardIntoView(pinnedView);
  }

  // ─── Thread renderer ────────────────────────────────────────────
  // Builds the unified Reddit-style column inside #pv-thread:
  //   row 0   = the OP (post)        — `.pv-row--post`
  //   rows 1+ = sibling comments     — `.pv-row--comment`
  // The pinned target gets `.pv-row--pinned` (accent rail + tint).
  // Thread membership comes from `siblingsForThread(postId)` which walks
  // every chunk and collects all idxs whose permalink shares the same
  // /comments/{postId}/ id. Chunk data has no parent_id/link_id, so we
  // render a flat list (ordered: comments by score desc).
  function _renderRowHtml(det, { idx, isPinned, isPost, parsedQ, depth = 1 }) {
    const col = det != null ? sphereColor(det.cluster) : '#666';
    const cls = [
      'pv-row',
      isPost ? 'pv-row--post' : 'pv-row--comment',
      isPinned ? 'pv-row--pinned' : '',
    ].filter(Boolean).join(' ');
    const titleRaw = (det?.title || '').trim();
    const title = (isPost && titleRaw)
      ? `<h3 class="pv-row-title">${highlightSearchHits(titleRaw, parsedQ)}</h3>`
      : '';
    // No truncation — the full body is always rendered. Long threads are
    // managed by chunked lazy loading in _paintThread (IntersectionObserver
    // on a sentinel <li>) rather than per-row clamps + "… more" buttons.
    const rawBody = ((det?.body || '').replace(/\s+\n/g, '\n').trim()) || (isPost ? '' : '(no text)');
    const meta = det
      ? `r/${escapeHtml(det.subreddit || '—')} · ${escapeHtml(formatRedditKindLabel(det.type))}${det.month ? ' · ' + escapeHtml(det.month) : ''}${det.score != null ? ' · ' + redditScoreInlineHtml(det.score) : ''}`
      : 'unknown';
    const linkUrl = (det?.permalink || '').trim();
    const linkAttr = linkUrl
      ? (/^https?:\/\//i.test(linkUrl) ? linkUrl : `https://www.reddit.com${linkUrl.startsWith('/') ? '' : '/'}${linkUrl}`)
      : '';
    // Tiny "open in new tab" glyph: square frame + arrow popping out top-right.
    // Replaces the prior "View on Reddit ↗" text link to keep rows uncluttered.
    const link = linkAttr
      ? `<a class="pv-row-link" href="${escapeHtml(linkAttr)}" target="_blank" rel="noopener" data-act="open" aria-label="Open on Reddit" title="Open on Reddit">
           <svg class="pv-row-link-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
             <path d="M9.5 2.5h4v4"/>
             <path d="M13.5 2.5L7 9"/>
             <path d="M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/>
           </svg>
         </a>`
      : '';
    // Reddit-thread layout for posts: title sits at top (big), then meta,
    // then body. Comments use meta → body (no title) so they read as
    // replies under the post.
    const inner = isPost
      ? `${title}
         <div class="pv-row-meta">
           <span class="pv-row-dot" style="background:${col}"></span>
           <span class="pv-row-meta-text">${meta}</span>
           ${link}
         </div>
         <div class="pv-row-body">${highlightSearchHits(rawBody, parsedQ)}</div>`
      : `<div class="pv-row-meta">
           <span class="pv-row-dot" style="background:${col}"></span>
           <span class="pv-row-meta-text">${meta}</span>
           ${link}
         </div>
         <div class="pv-row-body">${highlightSearchHits(rawBody, parsedQ)}</div>`;
    return `
      <li>
        <button type="button" class="${cls}" data-idx="${idx}" data-depth="${depth}"
                aria-pressed="${isPinned ? 'true' : 'false'}"
                title="${isPinned ? 'Pinned' : 'Click to pin and rotate to this point'}">
          ${inner}
        </button>
      </li>
    `;
  }

  // Render a (possibly partial) thread immediately. `postDet` may be null
  // when the post belonging to a pinned comment isn't resolvable; in that
  // case the pinned comment is promoted to the top "post" slot and no
  // siblings are shown. `loading` paints a spinner-line under the rows.
  //
  // Comments are not capped: we render the post + pinned comment + first
  // CHUNK_SIZE siblings, then drop a sentinel <li> at the bottom that an
  // IntersectionObserver watches against the single scroll container
  // (#insp-body, ~200px rootMargin). When it intersects, the next chunk is
  // appended in place. When all siblings are rendered we replace the
  // sentinel with a quiet "loaded all N comments" footer.
  //
  // Depth>1 collapse hook: chunk data carries no parent_id today so all
  // rows render at depth=1 (flat). If/when parent_id arrives, comments
  // with depth > 1 are grouped under their parent and rendered into a
  // collapsed `<ul class="pv-row-replies hidden">` toggled by a small
  // "show N replies" button. The hook lives in _wireRowClicks below.
  let _threadObserver = null;
  function _disposeThreadObserver() {
    if (_threadObserver) { try { _threadObserver.disconnect(); } catch {} _threadObserver = null; }
  }
  const PV_CHUNK_SIZE = 12;

  function _wireRowClicks(rowEl, pinnedIdx) {
    rowEl.addEventListener('click', (ev) => {
      if (ev.target.closest('a[data-act="open"]')) return;
      if (ev.target.closest('.pv-replies-toggle')) return;
      ev.stopPropagation();
      const idx = +rowEl.dataset.idx;
      if (isNaN(idx) || idx === pinnedIdx) return;
      // Canonical "pin this index" entry point: selects on globe,
      // rotates camera, re-renders pinned-view (which lands the new
      // highlighted row in this same panel). See features/search-find.js.
      pinPointByIndex(idx);
    });
  }

  function _paintThread(d, allDetailsByIdx, { loading = false, postIdx = null } = {}) {
    if (!pvThreadEl) return;
    _disposeThreadObserver();
    const parsedQ = getActiveSearchParsed();
    const pinnedIdx = d?.idx ?? -1;
    const map = allDetailsByIdx instanceof Map
      ? allDetailsByIdx
      : new Map((allDetailsByIdx || []).map(x => [x?.idx, x]));
    // Always keep a copy of the pinned d in the map so we don't refetch it.
    if (pinnedIdx >= 0 && !map.has(pinnedIdx)) map.set(pinnedIdx, d);

    // Determine which idx is the post (type === 'submission').
    let resolvedPostIdx = postIdx;
    if (resolvedPostIdx == null) {
      for (const [i, det] of map) {
        if (det?.type === 'submission') { resolvedPostIdx = i; break; }
      }
    }
    // Whether the pinned target IS the post itself.
    const pinnedIsPost = resolvedPostIdx != null && resolvedPostIdx === pinnedIdx;

    let rowsHtml = '';

    // Row 1: the post. The corpus only sampled a fraction of every Reddit
    // thread — for many comments the parent post isn't in our data. In
    // that case we still render an empty placeholder post slot so the
    // viewer always reads as Reddit-thread-shaped (post on top, comments
    // below). The pinned comment then renders as the first comment.
    if (resolvedPostIdx != null) {
      const postDet = map.get(resolvedPostIdx);
      rowsHtml += _renderRowHtml(postDet, {
        idx: resolvedPostIdx,
        isPost: true,
        isPinned: pinnedIsPost,
        parsedQ,
      });
    } else {
      rowsHtml += `<li>
        <div class="pv-row pv-row--post pv-row--placeholder" aria-hidden="true">
          <div class="pv-row-meta">
            <span class="pv-row-dot pv-row-dot--placeholder"></span>
            <span class="pv-row-meta-text">Original post not in our sample</span>
          </div>
        </div>
      </li>`;
    }

    // Rows 2+: comments. If the pinned target is itself a comment, place
    // it FIRST so the user's pinned context is visible without scrolling.
    const commentIdxs = [];
    for (const [i, det] of map) {
      if (i === resolvedPostIdx) continue;
      if (det == null) continue;
      commentIdxs.push(i);
    }
    // Sort: pinned-comment first, then by score desc (null score sinks).
    commentIdxs.sort((a, b) => {
      if (a === pinnedIdx) return -1;
      if (b === pinnedIdx) return 1;
      const sa = map.get(a)?.score ?? -Infinity;
      const sb = map.get(b)?.score ?? -Infinity;
      return sb - sa;
    });

    // First chunk renders inline; the rest stream in via IntersectionObserver.
    const firstChunk = commentIdxs.slice(0, PV_CHUNK_SIZE);
    for (const i of firstChunk) {
      const det = map.get(i);
      rowsHtml += _renderRowHtml(det, {
        idx: i,
        isPost: false,
        isPinned: i === pinnedIdx,
        parsedQ,
      });
    }

    if (loading) {
      rowsHtml += `<li class="pv-thread-loading">Loading thread context…</li>`;
    } else if (commentIdxs.length > firstChunk.length) {
      // Sentinel for the IntersectionObserver. No visible label — we don't
      // want a "+N more" affordance; chunks just appear as the user scrolls.
      rowsHtml += `<li class="pv-thread-sentinel" aria-hidden="true"></li>`;
    } else if (commentIdxs.length > 0) {
      rowsHtml += `<li class="pv-thread-end">All ${commentIdxs.length} comment${commentIdxs.length === 1 ? '' : 's'} loaded</li>`;
    }

    pvThreadEl.innerHTML = rowsHtml;
    pvThreadEl.classList.remove('hidden');

    // Wire up clicks on the rows we just painted.
    pvThreadEl.querySelectorAll('.pv-row').forEach(rowEl => _wireRowClicks(rowEl, pinnedIdx));

    // Set up chunked lazy load if more comments remain.
    if (!loading && commentIdxs.length > firstChunk.length) {
      let cursor = firstChunk.length;
      const root = document.getElementById('insp-body'); // single scroll container
      const sentinel = pvThreadEl.querySelector('.pv-thread-sentinel');
      if (sentinel && 'IntersectionObserver' in window) {
        const renderNextChunk = () => {
          // Guard against re-entry: the IntersectionObserver can fire multiple
          // queued entries for the same sentinel before the layout settles, so
          // skip when we're already past the end (was a no-op before disconnect
          // landed, but cheaper to bail early here than build an empty fragment).
          if (cursor >= commentIdxs.length) return;
          const next = commentIdxs.slice(cursor, cursor + PV_CHUNK_SIZE);
          if (!next.length) return;
          // Build chunk HTML, then insert before the sentinel so the sentinel
          // stays at the bottom and re-fires on the next scroll.
          const frag = document.createDocumentFragment();
          const tmp = document.createElement('ul');
          tmp.innerHTML = next.map(i => _renderRowHtml(map.get(i), {
            idx: i,
            isPost: false,
            isPinned: i === pinnedIdx,
            parsedQ,
          })).join('');
          while (tmp.firstChild) {
            const li = tmp.firstChild;
            li.querySelectorAll('.pv-row').forEach(rowEl => _wireRowClicks(rowEl, pinnedIdx));
            frag.appendChild(li);
          }
          pvThreadEl.insertBefore(frag, sentinel);
          cursor += next.length;
          if (cursor >= commentIdxs.length) {
            // Done — replace sentinel with a quiet end-of-thread footer.
            _disposeThreadObserver();
            const end = document.createElement('li');
            end.className = 'pv-thread-end';
            end.textContent = `All ${commentIdxs.length} comments loaded`;
            sentinel.replaceWith(end);
          }
        };
        _threadObserver = new IntersectionObserver((entries) => {
          for (const e of entries) if (e.isIntersecting) renderNextChunk();
        }, { root, rootMargin: '200px 0px', threshold: 0 });
        _threadObserver.observe(sentinel);
      } else if (sentinel) {
        // No IntersectionObserver support → just render everything.
        const rest = commentIdxs.slice(cursor);
        const tmp = document.createElement('ul');
        tmp.innerHTML = rest.map(i => _renderRowHtml(map.get(i), {
          idx: i,
          isPost: false,
          isPinned: i === pinnedIdx,
          parsedQ,
        })).join('');
        const frag = document.createDocumentFragment();
        while (tmp.firstChild) {
          const li = tmp.firstChild;
          li.querySelectorAll('.pv-row').forEach(rowEl => _wireRowClicks(rowEl, pinnedIdx));
          frag.appendChild(li);
        }
        sentinel.replaceWith(frag);
      }
    }
  }

  // Thread context fetcher. Walks every chunk via siblingsForThread()
  // (defined above), then per-idx getPointDetails for body/score, then
  // hands the lot to _paintThread for layout.
  let _detailContextToken = 0;
  async function renderDetailContext(d) {
    if (!pvThreadEl) return;
    const token = ++_detailContextToken;
    const m = (d?.permalink || '').match(/\/comments\/([a-z0-9]+)\//);
    const postId = m ? m[1] : null;
    if (!postId || d?.idx == null) {
      // No way to compute thread → fall back: pinned item alone.
      _paintThread(d, [d], { loading: false });
      return;
    }
    let siblings;
    try { siblings = await siblingsForThread(postId); }
    catch { siblings = [d.idx]; }
    if (token !== _detailContextToken) return;
    if (!siblings.includes(d.idx)) siblings = [d.idx, ...siblings];

    // siblingsForThread guarantees every chunk is in chunkCache before it
    // returns, so getPointDetails resolves synchronously off cached promises.
    // Still wrap in Promise.all to preserve order and tolerate any race-cleared
    // cache entry, but no extra network round-trips happen here.
    const allDetails = await Promise.all(
      siblings.map(i => i === d.idx ? Promise.resolve(d) : getPointDetails(App.state, i).catch(() => null))
    );
    if (token !== _detailContextToken) return;
    const map = new Map();
    siblings.forEach((i, k) => { if (allDetails[k]) map.set(i, allDetails[k]); });
    _paintThread(d, map, { loading: false });
  }
  _syncPvBackBtn();

  // Public API: stable signature kept for tour beats + search-find +
  // App.showSnippetCard.
  window.App.showDetailCard = showDetailCard;

  // ─── Random-five action ──────────────────────────────────────────
  // Random-sample is now an *action*, not a toggle: each fire clears
  // any currently-displayed sprouts and immediately spawns a fresh
  // five (so the user can keep pressing R to see new samples without
  // first needing to press it again to clear). The R keybind and the
  // bottom-dock `#random-hint` chip both call this same path.
  //
  // Legacy aliases (`App.toggleSprouts`, `App.clearSprouts`) stay
  // around so the existing Space keybind continues to work for muscle
  // memory; their semantics shift to "always end up with sprouts on
  // screen" / "always end up with no sprouts".
  window.App.sampleFiveRandom = () => {
    cancelSproutClearTimer();
    _spaceDown = false;       // legacy state — keep cleared
    sproutClear({ immediate: true });  // synchronous DOM wipe — no orphaned cards
    const token = ++sproutRenderToken;
    requestAnimationFrame(() => {
      if (token !== sproutRenderToken) return;
      _spaceDown = true;
      sproutSpawn(token);
      // Visual ack: flash the chip's keycap so the user sees the
      // action register even when sprouts spawn off-camera.
      const ch = document.getElementById('random-hint');
      if (ch) {
        ch.classList.remove('flash');
        // force a reflow so the same animation can replay.
        void ch.offsetWidth;
        ch.classList.add('flash');
        setTimeout(() => ch.classList.remove('flash'), 360);
      }
    });
  };
  window.App.clearSprouts = (opts = {}) => {
    cancelSproutClearTimer();
    _spaceDown = false;
    sproutClear(opts);
  };
  // Legacy alias — retained because the existing Space keybind path
  // still calls toggleSprouts under the hood. Now treats every press
  // as "show me five fresh ones" rather than a true toggle, which
  // matches the new R semantics.
  window.App.toggleSprouts = () => {
    if (activeSprouts.length > 0) { window.App.clearSprouts({ immediate: true }); return false; }
    window.App.sampleFiveRandom();
    return true;
  };
  // Tour helpers — used by `tour.close()` to leave the user in a
  // clean state when they exit the tour.
  window.App.clearPinnedPoint = () => {
    try { clearSelectedPoint({ refreshRelations: false }); } catch {}
  };
  // Clear the pinned back/forward stacks and the "currently pinned detail"
  // pointer so the ←/→ buttons on the pinned-view stop offering stale prior
  // pins. Used wherever we hard-reset pinned state (App.resetAll, tour close,
  // tour Esc cascade, beat cleanups that owned the pin lifecycle).
  window.App.clearPinnedBackStack = () => {
    _pinnedBackStack.length = 0;
    _pinnedForwardStack.length = 0;
    _currentDetailPin = null;
    _syncPvBackBtn();
  };
  // Public alias so tour beats can hide the pinned-view through the same path
  // the close button uses, instead of poking #pinned-view.classList directly.
  window.App.hidePinnedView = () => { hidePinnedView(); };
  // Toggle helper: R / chip click dismisses scattershot when it's already
  // up (#26), otherwise resamples. We branch here rather than in
  // sampleFiveRandom() so the tour beat (which calls sampleFiveRandom
  // directly with curated indices) keeps its always-spawn semantics.
  const _scattershotActive = () =>
    activeSprouts.length > 0
    || !!sproutsEl?.querySelector?.('.sprout, .sprout-anchor');
  window.App.toggleScattershot = () => {
    if (_scattershotActive()) {
      cancelSproutClearTimer();
      _spaceDown = false;
      sproutClear({ immediate: true });
      return false;
    }
    window.App.sampleFiveRandom();
    return true;
  };
  // Make the floating chip act as a toggle button.
  (() => {
    const chip = document.getElementById('random-hint');
    if (!chip) return;
    chip.addEventListener('click', (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      window.App.toggleScattershot();
    });
  })();
  // R keybind. Allowed during the guided tour (Space stays gated there).
  // We don't gate on the body.tour-active class — R should still fire then.
  keys.bind({
    keys: ['r'],
    priority: 25,
    label: 'random-five',
    helpLabel: 'Scattershot — sample 5 random posts (press again to dismiss)',
    helpGroup: 'navigate',
    handler: (e) => {
      if (!_sproutRandomKeyAllowed(e)) return false;
      e.preventDefault();
      window.App.toggleScattershot();
      return true;
    },
  });

  // When multiple cards stack in #insp-body, scroll the newly-activated one
  // into view so it isn't hidden below the fold (proximity + continuity).
  function scrollCardIntoView(el) {
    if (!el) return;
    const body = document.getElementById('insp-body');
    if (!body) return;
    requestAnimationFrame(() => {
      const top = el.offsetTop - body.offsetTop;
      body.scrollTo({ top: Math.max(0, top - 8), behavior: 'smooth' });
    });
  }

  // Stage 1.5 — keys-coverage check. Walk every chip-rendered key annotation
  // in the DOM (kbd.sh-key plus aria-keyshortcuts attributes) and confirm
  // each resolves to a registered handler. Catches drift like the beat-6
  // "Press Esc to dismiss cards" hint that lies (#26).
  setTimeout(() => {
    try {
      const stale = [];
      const norm = (s) => {
        const t = String(s || '').trim().toLowerCase();
        if (t === 'esc' || t === 'escape') return 'Escape';
        if (t === 'space') return ' ';
        return t;
      };
      const check = (raw, hint) => {
        const k = norm(raw);
        if (!k) return;
        if (!keys.hasHandlerFor(k)) stale.push({ hint, key: raw });
      };
      document.querySelectorAll('kbd.sh-key').forEach((el) => {
        check(el.textContent, el.outerHTML.slice(0, 120));
      });
      document.querySelectorAll('[aria-keyshortcuts]').forEach((el) => {
        const v = el.getAttribute('aria-keyshortcuts') || '';
        for (const tok of v.split(/\s+/)) check(tok, el.tagName + '#' + (el.id || '?'));
      });
      for (const s of stale) {
        console.warn('[keys] visible hint without handler:', s);
      }
    } catch (err) {
      console.warn('[keys] coverage check failed:', err);
    }
  }, 0);
}

boot().catch(e => {
  console.error('boot crashed:', e);
  updateMsg('Boot crashed: ' + (e?.message || e));
});

// Wiring: loads data, constructs GlobeView + NavController, wires interactions.

import { loadData, App, buildSubGidMap, getPointDetails, clusterColor, SPHERE_PALETTE, clusterAnchor, subAnchor, latLonToXYZ } from './data.js?v=234';
function sphereColor(c) {
  const i = ((c % SPHERE_PALETTE.length) + SPHERE_PALETTE.length) % SPHERE_PALETTE.length;
  return SPHERE_PALETTE[i];
}

/** Signed net score on the meta line (display only). */
function redditScoreInlineHtml(score) {
  if (score == null || score === '') return '';
  const n = typeof score === 'number' ? score : +score;
  if (Number.isNaN(n)) return '';
  const t = Math.trunc(n);
  const cls = t > 0 ? 'is-positive' : (t < 0 ? 'is-negative' : 'is-zero');
  const text = t > 0 ? `+${t}` : String(t);
  return `<span class="reddit-score-inline ${cls}" title="Reddit score" aria-label="Score ${t}">${escapeHtml(text)}</span>`;
}

/** Meta strip label for Reddit items — post vs. comment is not shown; always "Thread". */
function formatRedditKindLabel(_type) {
  return 'Thread';
}
import { NavController } from './nav.js?v=253';
import { GlobeView } from './globe.js?v=272';
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
    document.getElementById('reset-view-hint')?.addEventListener('click', () => {
      globe?.resetCanonicalZoom?.();
    });
  } catch (e) { console.error('GlobeView failed:', e); updateMsg('Globe error: ' + e.message); throw e; }

  // Guided tour — Atlantic-style opener + three cluster beats. Launcher
  // button is always visible; auto-open on every visit unless the URL
  // carries a non-empty hash (so deep-links still land where expected).
  try {
    const { createTour } = await import('./tour.js?v=279');
    const tour = createTour({ globe, App, nav });
    window.App.tour = tour;
    document.getElementById('tour-launcher')?.addEventListener('click', () => tour.start());
    // Cold load: index.html shows a title slide first; tour starts after Continue
    // (or immediately if the user continued before this module finished loading).
    // Deep-links (#cl=…) skip the title slide and the auto tour.
    if (!location.hash) {
      const titleEl = document.getElementById('presentation-title-overlay');
      const stillOnTitle = titleEl && !titleEl.classList.contains('hidden');
      if (!stillOnTitle || window.__presentationContinueRequested) {
        tour.start();
      }
    }
  } catch (e) { console.warn('tour init failed:', e); }

  // Empty-state + intro live here (not inside #insp-body, which is display:none
  // in the minimal layout).
  const navMount = document.getElementById('nav');
  const navBarsMount = document.getElementById('nav-bars');
  const inspEmptyMount = document.getElementById('insp-empty-main');
  if (inspEmptyMount && navBarsMount && navMount && inspEmptyMount.parentElement !== navMount) {
    navBarsMount.insertAdjacentElement('afterend', inspEmptyMount);
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

  // ─── Idle auto-rotate ───────────────────────────────────────────
  // Slow continuous drift toward the top-right until the user touches
  // the globe (drag, wheel, or arrow/zoom key) or drills into a cluster.
  // Typing in the search box does NOT stop it.
  (() => {
    let spinning = true;
    const DX = 0.18;   // rightward px-equivalent per frame (~11 px/sec @60fps)
    const DY = -0.09;  // upward
    const STOP_KEYS = new Set([
      'ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
      'w','W','s','S','+','=','-','_',
    ]);
    const stop = () => {
      if (!spinning) return;
      spinning = false;
      canvas.removeEventListener('pointerdown', stop, true);
      canvas.removeEventListener('wheel', stop, true);
      window.removeEventListener('keydown', onKey, true);
      nav?.removeEventListener?.('focus', stop);
    };
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (STOP_KEYS.has(e.key)) stop();
    };
    canvas.addEventListener('pointerdown', stop, true);
    canvas.addEventListener('wheel', stop, true);
    window.addEventListener('keydown', onKey, true);
    nav?.addEventListener?.('focus', stop);
    const tick = () => {
      if (!spinning) return;
      // Pause idle drift while the guided tour is driving the camera.
      if (!window.App?.tour?.isActive()) globe.nudge?.(DX, DY);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })();

  function _rangeSum(series, lo, hi) {
    let s = 0;
    const end = Math.min(hi, series.length - 1);
    for (let i = Math.max(0, lo); i <= end; i++) s += series[i] || 0;
    return s;
  }

  // ─── Focus → globe rotate + highlight + focus card ───────────────
  const focusCard = document.getElementById('focus-card');
  const fkind = document.getElementById('focus-kind');
  const ftitle = document.getElementById('focus-title');
  const fmeta = document.getElementById('focus-meta');
  const fspark = document.getElementById('focus-spark');
  const fcrumbs = document.getElementById('fc-breadcrumbs');
  const fvoices = document.getElementById('focus-voices');
  const fsubs = document.getElementById('focus-subs');

  // Copy-as-markdown for the focus card, mirroring the position card's
  // affordance. Reads current focus state at click-time so one handler
  // covers both cluster and sub focus. Includes the subreddit mix, a
  // "top stances" list at cluster level, trend, and a deep-link.
  (() => {
    const btn = document.getElementById('fc-copy-md');
    if (!btn) return;
    btn.onclick = async () => {
      const cl = nav.focusCl;
      const gid = nav.focusGid;
      if (cl == null) return;
      const clMeta = App.state.clusterMeta?.[String(cl)];
      const clName = clMeta?.name || `Topic ${cl}`;
      const range = globe._filter?.monthRange || null;
      const rangeLabel = range
        ? ` (${App.state.monthLabels[range.lo]} → ${App.state.monthLabels[range.hi]})`
        : '';
      const title = gid != null ? (App.subGidMap.byGid[gid]?.name || `sub ${gid}`) : clName;
      const series = gid != null ? getSubSeries(gid) : getClusterSeries(cl);
      const t = getTrendInfo(series);
      const trendStr = t.dir === 'up' ? ' ▲ trending' : t.dir === 'down' ? ' ▼ fading' : '';
      // Subreddit mix (top 3)
      const bd = gid != null
        ? (App.state.subredditBreakdown?.by_sub_gid?.[String(gid)] || [])
        : (App.state.subredditBreakdown?.by_cluster?.[String(cl)] || []);
      const subTotal = bd.reduce((s, e) => s + (e.n || 0), 0);
      const mixLine = bd.slice(0, 3)
        .map(e => `r/${e.r} ${Math.round(100 * e.n / subTotal)}%`)
        .join(' · ');
      const total = series ? series.reduce((s, v) => s + v, 0) : 0;
      // Top stances — only at cluster level (sub has its own drill list).
      let stancesBlock = '';
      if (gid == null) {
        const rows = [...document.querySelectorAll('#focus-stances .fc-stance')]
          .slice(0, 5)
          .map(row => {
            const name = row.querySelector('.fc-st-name')?.textContent?.trim();
            const sub = row.querySelector('.fc-st-sub')?.textContent?.trim();
            const count = row.querySelector('.fc-st-count')?.textContent?.trim();
            return name ? `- ${name} *(${sub})* — ${count}` : null;
          })
          .filter(Boolean);
        if (rows.length) stancesBlock = '\n**Loudest points of view:**\n' + rows.join('\n');
      }
      // Shareable link — carry every active filter so the recipient lands
      // on the exact view (matches the position-card link in v=193).
      const parts = [`cl=${cl}`];
      if (gid != null) parts.push(`gid=${gid}`);
      if (range) { parts.push(`from=${range.lo}`); parts.push(`to=${range.hi}`); }
      if (_activeSubredditFilter) parts.push(`sr=${_activeSubredditFilter.id}`);
      const q = document.getElementById('search-input')?.value?.trim();
      if (q) parts.push(`q=${encodeURIComponent(q)}`);
      const link = `${location.origin}${location.pathname}#${parts.join('&')}`;
      const md = [
        `## ${title}${trendStr}${rangeLabel}`,
        gid != null ? `*${clName} ▸ ${title}*` : '',
        '',
        `**Volume:** ${total.toLocaleString()} posts`,
        mixLine ? `**Voiced by:** ${mixLine}` : '',
        stancesBlock,
        `\n[View on globe](${link})`,
      ].filter(Boolean).join('\n').trim();
      let ok = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(md);
          ok = true;
        }
      } catch {}
      if (!ok) {
        const ta = document.createElement('textarea');
        ta.value = md; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { ok = document.execCommand('copy'); } catch {}
        ta.remove();
      }
      btn.classList.toggle('copied', ok);
      btn.classList.toggle('copy-err', !ok);
      btn.setAttribute('data-msg', ok ? 'Copied!' : 'Copy failed');
      setTimeout(() => {
        btn.classList.remove('copied', 'copy-err');
        btn.removeAttribute('data-msg');
      }, 1600);
    };
  })();

  // Which subreddits dominate this cluster / sub? Renders a 3-segment
  // horizontal bar + labels. Tiny file (~32 KB) pre-baked by
  // scripts/compute_subreddit_breakdown.py.
  function renderFocusSubreddits(cl, gid, color) {
    if (!fsubs) return;
    fsubs.innerHTML = '';
    const data = App.state.subredditBreakdown;
    if (!data) return;
    const top = gid != null
      ? (data.by_sub_gid?.[String(gid)] || [])
      : (data.by_cluster?.[String(cl)] || []);
    if (!top.length) return;
    const picks = top.slice(0, 3);
    const total = picks.reduce((s, e) => s + (e.n || 0), 0);
    if (total === 0) return;
    const segs = picks.map(e => {
      const pct = (100 * e.n / total).toFixed(0);
      return `<span class="fs-seg" style="flex:${e.n}; background:${color}" title="r/${escapeHtml(e.r)}: ${e.n.toLocaleString()} posts (${pct}% of top-3 shown)"></span>`;
    }).join('<span class="fs-gap"></span>');
    const names = App.state.subredditNames || [];
    const labels = picks.map(e => {
      const pct = Math.round(100 * e.n / total);
      const match = names.find(n => n.name === e.r);
      const srId = match?.id ?? -1;
      const activeCls = (_activeSubredditFilter && _activeSubredditFilter.id === srId) ? ' active' : '';
      return `
        <button class="fs-lbl${activeCls}" data-sr-id="${srId}" data-sr-name="${escapeHtml(e.r)}"
                title="${e.n.toLocaleString()} posts · click to filter globe to r/${escapeHtml(e.r)}">
          <span class="fs-lbl-name">r/${escapeHtml(e.r)}</span>
          <span class="fs-lbl-pct">${pct}%</span>
        </button>
      `;
    }).join('');
    // Hint shown only to first-time visitors; localStorage flag below marks
    // seen after the user actually clicks one.
    const hintSeen = (() => { try { return localStorage.getItem('vizFsHintSeen') === '1'; } catch(e) { return false; } })();
    const hintHtml = hintSeen ? '' : ' <span class="fs-hint">· click to filter globe</span>';
    fsubs.innerHTML = `
      <div class="fs-head">where it lives${hintHtml}</div>
      <div class="fs-bar">${segs}</div>
      <div class="fs-legend">${labels}</div>
    `;
    fsubs.querySelectorAll('.fs-lbl').forEach(btn => {
      btn.onclick = () => {
        const id = +btn.dataset.srId;
        if (id < 0) return;
        try { localStorage.setItem('vizFsHintSeen', '1'); } catch(e) {}
        toggleSubredditFilter(id, btn.dataset.srName, cl, gid);
      };
    });
  }
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
    renderFocusSubreddits(nav.focusCl, nav.focusGid, nav.focusCl != null ? sphereColor(nav.focusCl) : '#7cf0c9');
    if (nav.focusCl != null && nav.focusGid == null) renderFocusStances(nav.focusCl);
    if (typeof writeHash === 'function') writeHash();
    if (typeof refreshCaptions === 'function') setTimeout(refreshCaptions, 200);
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
    renderFocusSubreddits(nav.focusCl, nav.focusGid, nav.focusCl != null ? sphereColor(nav.focusCl) : '#7cf0c9');
    // Cluster-level stance list now gates by the active sub.
    if (nav.focusCl != null && nav.focusGid == null) renderFocusStances(nav.focusCl);
    if (typeof writeHash === 'function') writeHash();
    if (typeof refreshCaptions === 'function') setTimeout(refreshCaptions, 200);
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
    const range = globe._filter?.monthRange || null;
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
        setTimeout(() => focusPosition(cl, gid, posIdx), 180);
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

  // Find street-interview subjects whose pin is within this cluster (or
  // sub, when gid given). Makes the anchor-to-real-voices connection
  // much more visible than leaving users to notice matching colors.
  function renderFocusVoices(cl, gid) {
    if (!fvoices) return;
    fvoices.innerHTML = '';
    const pins = App.state.interviewPins?.placements || [];
    const ivs = App.state.interviews?.interviews || [];
    const ivById = new Map(ivs.map(i => [i.id, i]));
    const g = gid != null ? App.subGidMap.byGid[gid] : null;
    const matches = pins.filter(p => {
      if (p.cluster !== cl) return false;
      if (g && p.sub !== g.sub) return false;
      return true;
    });
    if (matches.length === 0) return;
    const chips = matches.map(p => {
      const iv = ivById.get(p.id);
      const qs = interviewQuotes(iv);
      const preview = (qs[0] || '').slice(0, 96);
      return `
        <button class="fc-voice" data-id="${p.id}" title="${escapeHtml(preview)}">
          <span class="fc-voice-id">${p.id}</span>
          <span class="fc-voice-role">${escapeHtml(preview ? `${preview}${preview.length >= 96 ? '…' : ''}` : 'Street voice')}</span>
        </button>
      `;
    }).join('');
    fvoices.innerHTML = `
      <div class="fc-voices-label">${matches.length === 1 ? 'Voice pinned here' : `Voices pinned here · ${matches.length}`}</div>
      <div class="fc-voices-list">${chips}</div>
    `;
    fvoices.querySelectorAll('.fc-voice').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const pin = pins.find(p => p.id === id);
        if (pin) {
          // Enrich with interview data fields the card renderer expects
          const iv = ivById.get(id);
          const meta = App.state.clusterMeta?.[String(pin.cluster)];
          const full = { ...pin, cluster_name: meta?.name };
          showInterviewCard(full);
        }
      };
    });
  }

  // At cluster level, drill the reader straight into the loudest voices
  // across all subs within — a shortcut that lets them hit a specific
  // stance without first picking a sub. Ranks by volume with a trend
  // boost, so surging minority stances surface alongside the mainstays.
  const fstances = document.getElementById('focus-stances');
  function renderFocusStances(cl) {
    if (!fstances) return;
    fstances.innerHTML = '';
    if (cl == null) return;
    const anchors = App.state.positionAnchors;
    if (!anchors) return;
    // Honor the active timeline filter so the "loudest here" list reflects
    // the period the user is studying, not all-time totals.
    const range = globe._filter?.monthRange || null;
    const entries = [];
    // Respect an active subreddit filter: when r/X is pinned the user
    // is studying that community — the "loudest here" list should reflect
    // stances where r/X actually voices, not generic all-time tops.
    const srId = _activeSubredditFilter?.id ?? null;
    const posSubTable = App._posSubTable;
    for (const [gidStr, doc] of Object.entries(anchors)) {
      if (doc.cl !== cl) continue;
      const gid = +gidStr;
      const positions = doc.positions || [];
      positions.forEach((p, idx) => {
        const allCount = p.count || 0;
        if (allCount < 30) return;
        let subCount = null;
        if (srId != null && posSubTable) {
          const m = posSubTable.get((gid << 8) | idx);
          const n = m ? (m.get(srId) || 0) : 0;
          if (n < 5) return;
          subCount = n;
        }
        const series = getPositionSeries(gid, idx);
        const rawCount = range
          ? (series ? _rangeSum(series, range.lo, range.hi) : 0)
          : allCount;
        if (range && rawCount < 10) return;
        // Prefer the sub count when a sub filter is active, so weighting
        // matches what the user cares about in this view.
        const count = subCount != null ? subCount : rawCount;
        const t = getTrendInfo(series);
        const boost = Math.max(0, t.rel - 1) * 0.5;
        const score = (range || subCount != null) ? count : count * (1 + boost);
        entries.push({ gid, posIdx: idx, cl: doc.cl, name: p.name,
                       sub_name: doc.sub_name, count, rel: t.rel, dir: t.dir,
                       score, description: p.description || '', inRange: !!range, inSub: !!srId });
      });
    }
    if (entries.length === 0) return;
    entries.sort((a, b) => b.score - a.score);
    const top = entries.slice(0, 6);
    const color = sphereColor(cl);
    // What's the cluster's dominant voice? Used as a reference point so
    // each stance row can flag when it diverges — a "most stances here
    // are r/boston but this one is r/medfordma" callout, in line with
    // the ⇋ marker already used on the position card.
    const cData = App.state.subredditBreakdown?.by_cluster?.[String(cl)] || [];
    const clusterTopName = cData[0]?.r || null;
    const chips = top.map(e => {
      const arrow = e.dir === 'up' ? '<span class="fc-st-up" title="trending up">▲</span>'
                  : e.dir === 'down' ? '<span class="fc-st-down" title="fading">▼</span>' : '';
      const dom = getPositionDominantSub(e.gid, e.posIdx);
      const different = dom && clusterTopName && dom.name !== clusterTopName;
      const voice = dom ? `
        <span class="fc-st-voice${different ? ' fc-st-voice-diff' : ''}"
              title="${escapeHtml(different ? `voiced mostly in r/${dom.name} — different from this topic's dominant r/${clusterTopName}` : `voiced mostly in r/${dom.name}`)}">
          ${different ? '<span class="fc-st-cross">⇋</span>' : ''}r/${escapeHtml(dom.name)}
        </span>` : '';
      // Full name + description in tooltip for the ellipsized fc-st-name.
      const titleTxt = e.description ? `${e.name} — ${e.description}` : e.name;
      return `
        <button class="fc-stance${different ? ' fc-stance-diff' : ''}"
                data-cl="${e.cl}" data-gid="${e.gid}" data-pos="${e.posIdx}"
                style="--stance-color:${color}"
                title="${escapeHtml(titleTxt)}">
          <span class="fc-st-name">${escapeHtml(e.name)}</span>
          ${arrow}
          ${voice}
          <span class="fc-st-sub">${escapeHtml(e.sub_name)}</span>
          <span class="fc-st-count">${e.count.toLocaleString()}</span>
        </button>
      `;
    }).join('');
    let sectionLabel = 'loudest points of view here';
    if (top[0]?.inSub && top[0]?.inRange) sectionLabel = `loudest in r/${_activeSubredditFilter.name} · this period`;
    else if (top[0]?.inSub) sectionLabel = `loudest in r/${_activeSubredditFilter.name}`;
    else if (top[0]?.inRange) sectionLabel = 'loudest points of view — this period';
    fstances.innerHTML = `
      <div class="fc-stances-label">${sectionLabel}</div>
      <div class="fc-stances-list">${chips}</div>
    `;
    fstances.querySelectorAll('.fc-stance').forEach(btn => {
      btn.onclick = () => {
        const cl2 = +btn.dataset.cl, gid2 = +btn.dataset.gid, posIdx2 = +btn.dataset.pos;
        nav.focus({ cl: cl2, gid: gid2 });
        setTimeout(() => focusPosition(cl2, gid2, posIdx2), 180);
      };
    });
  }

  // Render up-navigation breadcrumbs inside the focus card. The default
  // header crumbs are tiny; these are big enough to reliably hit.
  function renderFocusCrumbs(cl, gid) {
    if (!fcrumbs) return;
    const parts = [`<button class="fc-up" data-level="all">← All topics</button>`];
    if (cl != null && gid != null) {
      const clName = App.state.clusterMeta?.[String(cl)]?.name || `Topic ${cl}`;
      parts.push(`<button class="fc-up" data-level="cluster" style="color:${sphereColor(cl)}">${escapeHtml(clName)}</button>`);
    }
    fcrumbs.innerHTML = parts.join('<span class="fc-sep">›</span>');
    fcrumbs.querySelectorAll('.fc-up').forEach(b => {
      b.onclick = () => {
        const lvl = b.dataset.level;
        if (lvl === 'all') nav.focus({});
        else if (lvl === 'cluster') nav.focus({ cl });
      };
    });
  }
  const inspBody = document.getElementById('insp-body');
  const inspEmpty = document.getElementById('insp-empty-main');

  // Shared helpers for inspector state management.
  // Returning users who've already drilled in get a compact empty state
  // (intro copy hidden). Tracked in localStorage.
  function _markEmptyCompactIfSeen() {
    try {
      if (localStorage.getItem('vizIntroSeen') === '1') {
        inspEmpty?.classList.add('compact');
      }
    } catch {}
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
      try { localStorage.setItem('vizIntroSeen', '1'); } catch {}
      inspEmpty.classList.add('compact');
    }
  }
  function showInspectorEmpty() {
    const anyOpen =
      !focusCard.classList.contains('hidden') ||
      !document.getElementById('detail-card').classList.contains('hidden') ||
      !document.getElementById('interview-card').classList.contains('hidden') ||
      !document.getElementById('position-card').classList.contains('hidden') ||
      !document.getElementById('voices-list-inline').classList.contains('hidden');
    if (!anyOpen && inspEmpty) inspEmpty.classList.remove('hidden');
    syncIntroGlobeHighlight();
  }

  nav.addEventListener('focus', (ev) => {
    const { cl, gid, posIdx } = ev.detail;
    globe.setHighlight({ cl, gid, posIdx });

    if (cl == null) {
      globe.rotateTo(0, 0, 3.0, 700);
      focusCard.classList.add('hidden');
      if (fspark) fspark.innerHTML = '';
      globe.loadThreadArcs([]);
      showInspectorEmpty();
      return;
    }
    // Focusing a cluster/sub closes any open interview card — the user
    // shifted their attention away from the pinned voice.
    const iv = document.getElementById('interview-card');
    if (iv && !iv.classList.contains('hidden')) {
      iv.classList.add('hidden');
      document.querySelectorAll('.pin.selected').forEach(el => el.classList.remove('selected'));
    }
    hideInspectorEmpty();
    if (gid == null) {
      const a = clusterAnchor(App.state, cl);
      if (a) globe.rotateTo(a.lat, a.lon, 1.9);
      const meta = App.state.clusterMeta[String(cl)];
      ftitle.textContent = meta ? meta.name : `Topic ${cl}`;
      ftitle.style.color = sphereColor(cl);
      fkind.innerHTML = `topic ${renderTrendBadge(getClusterSeries(cl))}`;
      fmeta.textContent = `${(a?.count ?? 0).toLocaleString()} items`;
      if (fspark) fspark.innerHTML = renderClusterSparkline(cl, sphereColor(cl));
      renderFocusCrumbs(cl, null);
      renderFocusSubreddits(cl, null, sphereColor(cl));
      renderFocusStances(cl);
      renderFocusVoices(cl, null);
      focusCard.classList.remove('hidden');
      globe.loadThreadArcs([]);
      return;
    }
    const g = App.subGidMap.byGid[gid];
    if (g) {
      const a = subAnchor(App.state, g.cl, g.sub);
      if (a) { globe.rotateTo(a.lat, a.lon, 1.55); pulseAt(a.lat, a.lon, sphereColor(g.cl)); }
      ftitle.textContent = g.name;
      ftitle.style.color = sphereColor(g.cl);
      fkind.innerHTML = `subtopic ${renderTrendBadge(getSubSeries(gid))}`;
      fmeta.textContent = `${(a?.count ?? 0).toLocaleString()} items`;
      if (fspark) fspark.innerHTML = renderSubSparkline(gid, sphereColor(g.cl));
      renderFocusCrumbs(cl, gid);
      renderFocusSubreddits(cl, gid, sphereColor(g.cl));
      renderFocusStances(null);  // clear the cluster-level shortcut
      renderFocusVoices(cl, gid);
      focusCard.classList.remove('hidden');
    }
    globe.loadThreadArcs([]);
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
  let _shiftActive = false;
  let _shiftEpoch = 0;
  let _priorThreadsEnabled = false;

  // ─── Globe hover → floating cursor tooltip + thread arcs ────────
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
  const hideTooltip = () => {
    pointTooltip.classList.remove('visible');
    pointTooltip.classList.add('hidden');
  };
  globe.addEventListener('hover', async (ev) => {
    // Suppress the hover card entirely while SPACE is held — otherwise
    // moving the mouse around to read the sprouts keeps flashing
    // tooltips at the cursor.
    if (_spaceDown) { hideTooltip(); return; }
    const { idx, clientX, clientY } = ev.detail;
    if (idx < 0) {
      hideTooltip();
      if (globe._hoverArcsActive) restoreFocusThreads();
      return;
    }
    try {
      const details = await getPointDetails(App.state, idx);
      const title = (details.title || '').trim();
      const body = (details.body || '').replace(/\n{3,}/g, '\n\n');
      const meta = App.state.clusterMeta[String(details.cluster)];
      const catName = meta ? meta.name : `Topic ${details.cluster}`;
      const clColor = sphereColor(details.cluster);
      pointTooltip.innerHTML = `
        <div class="hv-cluster" style="color:${clColor}">${catName}</div>
        <div class="hv-meta">r/${escapeHtml(details.subreddit || '—')} · ${escapeHtml(formatRedditKindLabel(details.type))} · ${escapeHtml(details.month || '')}${details.score != null ? ' · ' + redditScoreInlineHtml(details.score) : ''}</div>
        ${title ? `<div class="hv-title">${escapeHtml(title)}</div>` : ''}
        <div class="hv-body">${escapeHtml(body)}</div>
      `;
      pointTooltip.classList.remove('hidden');
      pointTooltip.classList.add('visible');
      if (clientX != null) positionTooltip(clientX, clientY);
      if (!_shiftActive || pinnedPointIdx < 0) buildHoverArcs(idx, details);
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
    const details = await getPointDetails(App.state, ev.detail.idx);
    // Only jump to the Reddit thread if the user held cmd/ctrl. Plain
    // clicks now open the side card instead — easier to skim, doesn't
    // hijack the tab on every mis-click.
    const e = ev.detail?.origEvent || ev.detail?.event;
    const wantsLink = !!(e && (e.metaKey || e.ctrlKey));
    if (wantsLink && details?.permalink) {
      window.open(details.permalink, '_blank', 'noopener,noreferrer');
    } else {
      pinnedPointIdx = ev.detail.idx;
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
  function clearSelectedPoint({ refreshRelations = true } = {}) {
    const hadPinned = pinnedPointIdx >= 0;
    pinnedPointIdx = -1;
    hoverPointIdx = -1;
    globe.setPinnedPoint(-1);
    globe.setHoverPoint(-1);
    if (hadPinned && refreshRelations && _shiftActive) {
      shiftHideRelations();
      shiftShowRelations();
    }
  }
  globe.addEventListener('hover', (ev) => {
    if (_spaceDown) { hoverPointIdx = -1; globe.setHoverPoint(-1); return; }
    hoverPointIdx = ev?.detail?.idx ?? -1;
    globe.setHoverPoint(hoverPointIdx);
  });
  function updateHoverHalo() {
    if (!hoverHaloEl) return;
    if (hoverPointIdx < 0 || !App.state?.coords) {
      hoverHaloEl.classList.remove('show');
      return;
    }
    const lat = App.state.coords[2 * hoverPointIdx];
    const lon = App.state.coords[2 * hoverPointIdx + 1];
    const wp = globe.worldPositionOf(lat, lon, 1.012);
    const camPos = globe.camera.position;
    const facing = wp.x*(camPos.x-wp.x) + wp.y*(camPos.y-wp.y) + wp.z*(camPos.z-wp.z);
    if (facing <= 0) { hoverHaloEl.classList.remove('show'); return; }
    const p = wp.clone().project(globe.camera);
    if (p.z > 1) { hoverHaloEl.classList.remove('show'); return; }
    const w = globe.canvas.clientWidth;
    const h = globe.canvas.clientHeight;
    const sx = (p.x * 0.5 + 0.5) * w;
    const sy = (-p.y * 0.5 + 0.5) * h;
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
  const SPROUT_BODY_CAP = 240;
  const SPROUT_MARGIN_PX = 14;
  let activeSprouts = [];   // { idx, lat, lon, el, line, offX, offY, w, h }
  // Space is a toggle: first press opens a five-post spread, next press clears.
  let sproutClearTimer = null;
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
    const wp = globe.worldPositionOf(lat, lon, 1.012);
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

  async function sproutSpawn() {
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

    // 1) Collect ALL on-screen + focus-matching points (up to a cap).
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
        pool.push({ idx, lat, lon, sx: s.x, sy: s.y });
      }
    }
    if (pool.length === 0) return;

    // 2) Pick 5 with progressive spatial diversity. Start with a generous
    //    min-distance threshold and relax if we can't fill the quota.
    const W = globe.canvas.clientWidth;
    const H = globe.canvas.clientHeight;
    const minAxis = Math.min(W, H);
    const diversitySteps = [0.18, 0.13, 0.08, 0.04, 0];   // fractions of minAxis
    let kept = [];
    for (const frac of diversitySteps) {
      const min2 = (minAxis * frac) ** 2;
      const order = pool.slice().sort(() => Math.random() - 0.5);
      kept = [];
      for (const c of order) {
        if (kept.length >= n) break;
        let ok = true;
        for (const k of kept) {
          const dx = k.sx - c.sx, dy = k.sy - c.sy;
          if (dx*dx + dy*dy < min2) { ok = false; break; }
        }
        if (ok) kept.push(c);
      }
      if (kept.length >= n) break;
    }
    // If the viewport is literally so small we can't fit n distinct points,
    // keep whatever we have.
    if (kept.length === 0) return;

    // Fetch details and build DOM boxes.
    const placed = [];   // {x,y,w,h} already-placed boxes
    const margin = 8;

    // Preload details serially to keep DOM in sample-kept order.
    const details = [];
    for (const k of kept) {
      try {
        const d = await getPointDetails(state, k.idx);
        details.push({ k, d });
      } catch { /* skip */ }
    }

    // Layout + render.
    activeSprouts = [];
    for (const { k, d } of details) {
      if (!d) continue;
      const title = (d.title || '').trim();
      const body = (d.body || '').replace(/\s+/g, ' ').trim();
      const bodyShort = body.length > SPROUT_BODY_CAP ? body.slice(0, SPROUT_BODY_CAP).trim() + '…' : body;
      if (!title && !bodyShort) continue;

      const pointClEarly = App.state.cluster?.[k.idx];
      const anchorColorEarly = pointClEarly != null ? sphereColor(pointClEarly) : '#ffffff';

      const el = document.createElement('div');
      el.className = 'sprout';
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.addEventListener('click', (ev) => {
        ev.preventDefault();
        cancelSproutClearTimer();
        globe.rotateTo(k.lat, k.lon, 1.8);
        pinnedPointIdx = k.idx;
        globe.setPinnedPoint(k.idx);
        showDetailCard(d);
        _spaceDown = false;
        sproutClear();
      });
      // Border + thin glow in the cluster color so the caption reads as
      // belonging to the same cluster as its tether + halo.
      el.style.borderColor = anchorColorEarly;
      el.style.boxShadow =
        `0 6px 18px rgba(0,0,0,0.5), 0 0 0 1px ${anchorColorEarly}55, 0 0 12px ${anchorColorEarly}44`;
      el.innerHTML = `
        <div class="sp-meta">r/${escapeHtml(d.subreddit || '—')} · ${escapeHtml(formatRedditKindLabel(d.type))}${d.month ? ' · ' + escapeHtml(d.month) : ''}${d.score != null ? ' · ' + redditScoreInlineHtml(d.score) : ''}</div>
        ${title ? `<div class="sp-title">${escapeHtml(title)}</div>` : ''}
        ${bodyShort ? `<div class="sp-body">${escapeHtml(bodyShort)}</div>` : ''}
      `;
      sproutsEl.appendChild(el);
      // Measure.
      const bw = el.offsetWidth || 200;
      const bh = el.offsetHeight || 80;

      // Try many offsets radially around the anchor to find a spot that
      // both fits inside the viewport and doesn't overlap any previously
      // placed box (with a 12 px buffer). If nothing works on the first
      // pass, expand the search radius up to 6× — guarantees no overlap
      // so long as the viewport has room.
      const BUFFER = 12;
      const overlaps = (bx, by) => {
        for (const p of placed) {
          if (bx < p.x + p.w + BUFFER &&
              bx + bw + BUFFER > p.x &&
              by < p.y + p.h + BUFFER &&
              by + bh + BUFFER > p.y) {
            return true;
          }
        }
        return false;
      };
      const R = Math.max(60, Math.min(bw, bh) * 0.8);
      const anchor = { x: k.sx, y: k.sy };
      let bestPos = null;
      for (let r = R; r < R * 6 && !bestPos; r *= 1.25) {
        const angleJitter = Math.random() * Math.PI * 2;
        for (let a = 0; a < 24 && !bestPos; a++) {
          const ang = (a / 24) * Math.PI * 2 + angleJitter;
          const ox = Math.cos(ang) * r;
          const oy = Math.sin(ang) * r;
          const bx = anchor.x + ox - (ox < 0 ? bw : 0);
          const by = anchor.y + oy - (oy < 0 ? bh : 0);
          if (bx < margin || by < margin || bx + bw > W - margin || by + bh > H - margin) continue;
          if (overlaps(bx, by)) continue;
          bestPos = { bx, by };
        }
      }
      // Last-ditch: scan the canvas on a 40 px grid for any non-overlapping
      // spot, even if it's far from the anchor. Guarantees we never draw
      // overlapping boxes (at worst, the tether line is long).
      if (!bestPos) {
        outer:
        for (let by = margin; by + bh <= H - margin; by += 40) {
          for (let bx = margin; bx + bw <= W - margin; bx += 40) {
            if (!overlaps(bx, by)) { bestPos = { bx, by }; break outer; }
          }
        }
      }
      if (!bestPos) { el.remove(); continue; }

      el.style.left = `${bestPos.bx}px`;
      el.style.top = `${bestPos.by}px`;
      placed.push({ x: bestPos.bx, y: bestPos.by, w: bw, h: bh });
      requestAnimationFrame(() => el.classList.add('show'));

      // Per-anchor cluster color so line + halo visually tie back to the
      // matching point.
      const pointCl = App.state.cluster?.[k.idx];
      const anchorColor = pointCl != null ? sphereColor(pointCl) : '#ffffff';

      // Tether line from anchor to nearest box edge. Made bold + tinted
      // to the cluster color so the link between caption and point reads
      // at a glance. Opacity is controlled by the .show class so spawn /
      // clear fade it in lockstep with the caption box.
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('stroke', anchorColor);
      line.setAttribute('stroke-width', '2.5');
      line.setAttribute('stroke-opacity', '0.85');
      sproutLinesEl.appendChild(line);
      requestAnimationFrame(() => line.classList.add('show'));

      // Halo around the anchor point itself.
      const halo = document.createElement('div');
      halo.className = 'sprout-anchor';
      halo.style.borderColor = anchorColor;
      halo.style.boxShadow =
        `0 0 0 2px rgba(0,0,0,0.5), 0 0 18px 4px ${anchorColor}aa`;
      sproutsEl.appendChild(halo);
      requestAnimationFrame(() => halo.classList.add('show'));

      activeSprouts.push({
        idx: k.idx, lat: k.lat, lon: k.lon,
        el, line, halo,
        bx: bestPos.bx, by: bestPos.by, bw, bh,
      });
    }
    // Set SVG viewBox so line coords are in CSS pixels.
    sproutLinesEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
    sproutLinesEl.setAttribute('width', W);
    sproutLinesEl.setAttribute('height', H);
  }
  function sproutClear() {
    for (const s of activeSprouts) {
      s.el.classList.remove('show');
      s.line?.classList.remove('show');
      s.halo?.classList.remove('show');
      const el = s.el, line = s.line, halo = s.halo;
      setTimeout(() => { el.remove(); line?.remove(); halo?.remove(); }, 240);
    }
    activeSprouts = [];
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
    const pres = document.getElementById('presentation-title-overlay');
    if (pres && !pres.classList.contains('hidden')) return false;
    if (window.App?.tour?.isActive?.()) return false;
    return true;
  }
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (e.repeat) return;
    if (!_sproutSpaceAllowed(e)) return;
    cancelSproutClearTimer();
    e.preventDefault();
    _spaceDown = !_spaceDown;
    if (_spaceDown) sproutSpawn();
    else sproutClear();
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
  const btnThreads = document.getElementById('btn-threads');
  // Per-toggle preferences persist so the user doesn't have to re-disable
  // labels / pins / threads on every reload. Keys: vizPref.labels, .pins,
  // .threads — each 'on' | 'off'. Defaults: labels on, pins on, threads off.
  const _prefKey = 'vizPref';
  const _prefs = (() => {
    try { return JSON.parse(localStorage.getItem(_prefKey) || '{}'); }
    catch { return {}; }
  })();
  function _savePrefs() {
    try { localStorage.setItem(_prefKey, JSON.stringify(_prefs)); } catch {}
  }
  if (btnThreads) btnThreads.onclick = () => {
    const next = !globe.threadArcsEnabled;
    globe.setThreadsEnabled(next);
    btnThreads.classList.toggle('on', next);
    _prefs.threads = next ? 'on' : 'off';
    _savePrefs();
  };
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
    if (_prefs.threads === 'on' && btnThreads && !btnThreads.classList.contains('on')) btnThreads.click();
  });
  const btnReset = document.getElementById('btn-reset');
  // True reset — unwinds drill focus, subreddit filter, timeline range,
  // regex paint, text-search state, and any open overlays. A single
  // affordance that returns the viz to its fresh-load state.
  if (btnReset) btnReset.onclick = () => {
    // Focus drill
    nav.focus({});
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
    // Close position card if open
    document.getElementById('position-card')?.classList.add('hidden');
    // Clear hash last — after all state changes
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  };

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
  (() => {
    const tl = document.getElementById('timeline-scrubber');
    const svg = document.getElementById('tl-svg');
    const toggle = document.getElementById('tl-toggle');
    const labelEl = document.getElementById('tl-label');
    const clearBtn = document.getElementById('tl-clear');
    const hintEl = document.getElementById('tl-hint');
    const labels = App.state.monthLabels;
    const total = App.state.timeHist?.total;
    if (!tl || !svg || !labels || !total) return;

    const N = labels.length;
    let lo = 0, hi = N - 1;
    const maxCount = total.reduce((m, v) => v > m ? v : m, 1);
    function buildBg() {
      svg.innerHTML = '';
      const w = svg.clientWidth || 500;
      const h = svg.clientHeight || 42;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      const bw = w / N;
      for (let i = 0; i < N; i++) {
        const v = total[i];
        const bh = (v / maxCount) * h * 0.8 + 2;
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('class', 'tl-bar');
        r.setAttribute('x', (i * bw).toFixed(2));
        r.setAttribute('y', (h - bh).toFixed(2));
        r.setAttribute('width', Math.max(1, bw - 0.5).toFixed(2));
        r.setAttribute('height', bh.toFixed(2));
        r.dataset.idx = i;
        svg.appendChild(r);
      }
      for (let i = 0; i < N; i++) {
        if (!labels[i].endsWith('-01')) continue;
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('class', 'tl-tick');
        t.setAttribute('x', (i * bw).toFixed(2));
        t.setAttribute('y', h - 1);
        t.textContent = labels[i].slice(0, 4);
        svg.appendChild(t);
      }
    }
    function paintRange() {
      svg.querySelectorAll('.tl-bar').forEach(b => {
        const i = +b.dataset.idx;
        b.classList.toggle('in-range', i >= lo && i <= hi);
      });
    }
    function rangeCount() {
      let s = 0;
      for (let i = lo; i <= hi; i++) s += total[i] || 0;
      return s;
    }
    function updateLabel() {
      const full = lo === 0 && hi === N - 1;
      if (full) {
        labelEl.innerHTML = `<b>Whole corpus</b> · ${rangeCount().toLocaleString()} posts`;
        hintEl.style.display = '';
      } else {
        labelEl.innerHTML = `<b>${escapeHtml(labels[lo])} → ${escapeHtml(labels[hi])}</b> · ${rangeCount().toLocaleString()} posts`;
        hintEl.style.display = 'none';
      }
    }
    // Always-visible chip mirroring the sub-filter one so the active time
    // range is legible even when the scrubber is collapsed. Header has
    // limited space — keep the label compact (MMM YYYY → MMM YYYY).
    function _updateTimelineChip() {
      const header = document.getElementById('nav-header');
      let chip = document.getElementById('tl-filter-chip');
      if (lo === 0 && hi === N - 1) { chip?.remove(); return; }
      if (!chip) {
        chip = document.createElement('div');
        chip.id = 'tl-filter-chip';
        chip.className = 'tl-filter-chip';
        header?.appendChild(chip);
      }
      const fmt = (iso) => {
        // labels are "YYYY-MM"; re-format to "MMM YYYY".
        const [y, m] = iso.split('-');
        const mName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1] || m;
        return `${mName} ${y}`;
      };
      // Sum of in-range monthly totals — gives users an immediate sense
      // of how restrictive the filter is (vs. the 422k corpus). Labels
      // have gaps for months with no data, so report calendar-month span
      // (derived from the two endpoints) rather than label-array length.
      let n = 0;
      for (let i = lo; i <= hi; i++) n += total[i] || 0;
      const [y1, m1] = labels[lo].split('-').map(Number);
      const [y2, m2] = labels[hi].split('-').map(Number);
      const calMonths = (y2 - y1) * 12 + (m2 - m1) + 1;
      const monthsStr = calMonths >= 12 ? `${(calMonths/12).toFixed(1)} yr` : `${calMonths} mo`;
      const countStr = n >= 100000 ? `${Math.round(n/1000)}k` : n.toLocaleString();
      chip.innerHTML = `<span><b>${escapeHtml(fmt(labels[lo]))}</b> → <b>${escapeHtml(fmt(labels[hi]))}</b> <span class="tl-chip-count">· ${monthsStr} · ${countStr} posts</span></span><button class="tl-x" aria-label="Clear">×</button>`;
      chip.querySelector('.tl-x').onclick = () => { lo = 0; hi = N - 1; applyFilter(); };
    }
    function applyFilter() {
      const range = (lo === 0 && hi === N - 1) ? null : { lo, hi };
      globe.setMonthRange(range);
      paintRange();
      updateLabel();
      _updateTimelineChip();
      // Paint the active range as a band on every mini-sparkline so
      // the user sees the filter reflected wherever they look.
      updateSparklineBands(lo, hi, N - 1);
      // If a cluster focus card is open, re-render its "loudest stances"
      // list so in-range counts replace the all-time numbers.
      if (nav.focusCl != null && nav.focusGid == null) {
        renderFocusStances(nav.focusCl);
      }
      // If the subreddit filter is active, re-rank its agenda panel so
      // "what r/X voiced" reflects the selected period, not all-time.
      if (_activeSubredditFilter) {
        _renderSubredditAgendaPanel();
      }
      // Persist to URL hash so deep-links carry timeline state.
      if (typeof writeHash === 'function') writeHash();
      // Refresh zoom captions so they surface posts from the new period.
      if (typeof refreshCaptions === 'function') {
        setTimeout(refreshCaptions, 200);
      }
    }
    // Let freshly-rendered sparklines pick up the current range.
    window._tlApplyBands = () => updateSparklineBands(lo, hi, N - 1);

    // Play button — time-lapse sweep with a 12-month rolling window.
    const playBtn = document.getElementById('tl-play');
    let _playTimer = null;
    const stopPlay = () => {
      if (_playTimer) { clearInterval(_playTimer); _playTimer = null; }
      if (playBtn) { playBtn.textContent = '▶'; playBtn.classList.remove('playing'); }
    };
    const startPlay = () => {
      if (_playTimer) { stopPlay(); return; }
      const WINDOW = 12;
      const STEP_MS = 280;
      let head = Math.max(hi, WINDOW - 1);
      if (!isRangeActive()) head = WINDOW - 1;
      playBtn.textContent = '❚❚';
      playBtn.classList.add('playing');
      _playTimer = setInterval(() => {
        lo = Math.max(0, head - WINDOW + 1);
        hi = head;
        applyFilter();
        head++;
        if (head > N - 1) stopPlay();
      }, STEP_MS);
    };
    if (playBtn) playBtn.onclick = startPlay;
    svg.addEventListener('pointerdown', () => stopPlay());
    if (clearBtn) {
      const prevOnclick = clearBtn.onclick;
      clearBtn.onclick = (e) => { stopPlay(); if (prevOnclick) prevOnclick.call(clearBtn, e); };
    }

    // URL hash restore entry point — applied when a deep-link includes
    // from=X&to=Y. Opens the scrubber silently so bands + chip reflect.
    window._tlApplyHashRange = (newLo, newHi) => {
      lo = Math.max(0, Math.min(N - 1, newLo));
      hi = Math.max(0, Math.min(N - 1, newHi));
      if (tl.classList.contains('hidden')) {
        tl.classList.remove('hidden');
        toggle.classList.add('active');
        setTimeout(() => { if (!svg.childElementCount) { buildBg(); } paintRange(); updateLabel(); applyFilter(); }, 30);
      } else {
        applyFilter();
      }
    };
    // dragMode:
    //   'new'      — reset range from mousedown index (default when
    //                clicking outside the current range or when there IS
    //                no active range)
    //   'edge-lo'  — drag the low edge; hi stays pinned
    //   'edge-hi'  — drag the high edge; lo stays pinned
    let dragMode = null, dragPinned = null;
    function idxFromEvent(e) {
      const rect = svg.getBoundingClientRect();
      const frac = (e.clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(N - 1, Math.round(frac * (N - 1))));
    }
    function isRangeActive() { return !(lo === 0 && hi === N - 1); }
    svg.addEventListener('pointerdown', (e) => {
      svg.setPointerCapture(e.pointerId);
      const i = idxFromEvent(e);
      if (isRangeActive() && i > lo && i < hi) {
        // Inside range: grab nearer edge.
        if (i - lo < hi - i) { dragMode = 'edge-lo'; dragPinned = hi; }
        else { dragMode = 'edge-hi'; dragPinned = lo; }
      } else if (isRangeActive() && Math.abs(i - lo) <= 2) {
        // Near lo edge
        dragMode = 'edge-lo'; dragPinned = hi;
      } else if (isRangeActive() && Math.abs(i - hi) <= 2) {
        // Near hi edge
        dragMode = 'edge-hi'; dragPinned = lo;
      } else {
        // New range starting at i.
        dragMode = 'new'; dragPinned = i;
        lo = hi = i;
        applyFilter();
      }
    });
    svg.addEventListener('pointermove', (e) => {
      if (!dragMode) return;
      const i = idxFromEvent(e);
      if (dragMode === 'edge-lo') {
        lo = Math.min(i, dragPinned);
        hi = Math.max(i, dragPinned);
      } else if (dragMode === 'edge-hi') {
        lo = Math.min(i, dragPinned);
        hi = Math.max(i, dragPinned);
      } else {
        lo = Math.min(dragPinned, i);
        hi = Math.max(dragPinned, i);
      }
      applyFilter();
    });
    svg.addEventListener('pointerup', () => { dragMode = null; });
    svg.addEventListener('pointercancel', () => { dragMode = null; });
    const tlTooltip = document.getElementById('tl-tooltip');
    svg.addEventListener('pointermove', (e) => {
      // Exact month + count under cursor — makes the histogram readable
      // beyond just proportional height.
      if (tlTooltip) {
        const i = idxFromEvent(e);
        const tlRect = tl.getBoundingClientRect();
        const svgRect = svg.getBoundingClientRect();
        tlTooltip.innerHTML = `<b>${escapeHtml(labels[i])}</b> · ${(total[i] || 0).toLocaleString()} posts`;
        tlTooltip.classList.remove('hidden');
        tlTooltip.style.left = `${e.clientX - tlRect.left}px`;
        tlTooltip.style.top = `${svgRect.top - tlRect.top - 24}px`;
      }
      if (dragMode) return;
      if (!isRangeActive()) { svg.style.cursor = 'crosshair'; return; }
      const i = idxFromEvent(e);
      if (Math.abs(i - lo) <= 2 || Math.abs(i - hi) <= 2) svg.style.cursor = 'col-resize';
      else if (i > lo && i < hi) svg.style.cursor = 'grab';
      else svg.style.cursor = 'crosshair';
    });
    svg.addEventListener('pointerleave', () => {
      if (tlTooltip) tlTooltip.classList.add('hidden');
    });
    clearBtn.onclick = (e) => {
      e.stopPropagation();
      lo = 0; hi = N - 1;
      applyFilter();
    };
    // Expose for the global Reset button so it can unwind the time filter
    // alongside everything else.
    App._timelineClear = () => { lo = 0; hi = N - 1; applyFilter(); };
    toggle.onclick = () => {
      const wasHidden = tl.classList.contains('hidden');
      tl.classList.toggle('hidden');
      toggle.classList.toggle('active', !tl.classList.contains('hidden'));
      // On first reveal (or any re-reveal), rebuild with accurate width.
      // Use setTimeout rather than rAF — more robust across paint cycles
      // when the element is transitioning from display:none.
      if (wasHidden) {
        setTimeout(() => { buildBg(); paintRange(); }, 30);
      }
      // Persist open/closed state so returning users pick up where they
      // left off — parallel to the other toolbar prefs.
      try {
        const p = JSON.parse(localStorage.getItem('vizPref') || '{}');
        p.timeline = tl.classList.contains('hidden') ? 'off' : 'on';
        localStorage.setItem('vizPref', JSON.stringify(p));
      } catch {}
    };
    // Restore on first load if previously open.
    try {
      const p = JSON.parse(localStorage.getItem('vizPref') || '{}');
      if (p.timeline === 'on' && tl.classList.contains('hidden')) {
        queueMicrotask(() => toggle.click());
      }
    } catch {}
    updateLabel();
  })();

  // ─── Surprise Me: drop the user at a random, well-supported position.
  //   Weights by sqrt(count) so larger stances dominate but small surprising
  //   ones still appear. Reuses focusPosition, which pulses + captions.
  const btnSurprise = document.getElementById('btn-surprise');
  let _inSurpriseMode = false;
  if (btnSurprise) {
    const _surpriseRecent = [];
    // Pre-compute relative trend per series (normalized by corpus growth)
    // so Surprise Me picks stances that are genuinely hot, not just riding
    // the corpus's own growth curve.
    function trendRatio(series) {
      return getTrendInfo(series).rel;
    }
    // Bounded queue of recently-visited clusters so Surprise doesn't
    // drown the user in one topic. Separate from _surpriseRecent (which
    // is stance-level) — if three picks in a row hit the same cluster,
    // that cluster gets softly down-weighted for the next draw.
    const _surpriseRecentClusters = [];
    function pickSurprise() {
      const anchors = App.state.positionAnchors || {};
      const candidates = [];
      const mr = globe._filter?.monthRange;
      const hasTimeFilter = !!mr;
      // Honor active subreddit filter too — if the user filtered to r/X,
      // Surprise should land on stances where r/X actually has a voice.
      const srId = _activeSubredditFilter?.id ?? null;
      const posSubTable = App._posSubTable;
      // How many of the last N picks came from each cluster? A 0.5× per
      // prior hit gives genuine anti-clustering without eliminating
      // coherent follow-on picks entirely.
      const clusterPenalty = new Map();
      for (const cl of _surpriseRecentClusters) {
        clusterPenalty.set(cl, (clusterPenalty.get(cl) || 1) * 0.55);
      }
      for (const [gidStr, doc] of Object.entries(anchors)) {
        const gid = +gidStr;
        const subSeries = App.state?.timeHist?.by_sub_gid?.[String(gid)];
        const subRatio = trendRatio(subSeries);
        (doc.positions || []).forEach((p, idx) => {
          if (p.lat == null || !p.count || p.count < 40) return;
          const key = `${gid}:${idx}`;
          if (_surpriseRecent.includes(key)) return;
          const posSeries = App.state?.positionTimeHist?.by_position?.[`${gid}:${idx}`];
          const ratio = posSeries ? trendRatio(posSeries) : subRatio;
          const boost = Math.max(0.5, Math.min(2.5, ratio));
          let weight = p.count;
          if (hasTimeFilter && posSeries) {
            let inRange = 0;
            for (let m = mr.lo; m <= mr.hi && m < posSeries.length; m++) inRange += posSeries[m] || 0;
            if (inRange < 5) return;
            weight = inRange;
          }
          // Sub filter gate: skip stances where that subreddit has < 5
          // attributed points. Also weight by the sub-specific count so
          // strongly-voiced stances float higher.
          if (srId != null && posSubTable) {
            const m = posSubTable.get((gid << 8) | idx);
            const nSr = m ? (m.get(srId) || 0) : 0;
            if (nSr < 5) return;
            weight = nSr;
          }
          const clDamp = clusterPenalty.get(doc.cl) || 1;
          candidates.push({ cl: doc.cl, gid, posIdx: idx, w: Math.sqrt(weight) * boost * clDamp });
        });
      }
      if (candidates.length === 0) return;
      const total = candidates.reduce((s, c) => s + c.w, 0);
      let r = Math.random() * total;
      let pick = candidates[0];
      for (const c of candidates) { r -= c.w; if (r <= 0) { pick = c; break; } }
      _surpriseRecent.push(`${pick.gid}:${pick.posIdx}`);
      if (_surpriseRecent.length > 10) _surpriseRecent.shift();
      _surpriseRecentClusters.push(pick.cl);
      if (_surpriseRecentClusters.length > 4) _surpriseRecentClusters.shift();
      _inSurpriseMode = true;
      nav.focus({ cl: pick.cl, gid: pick.gid });
      setTimeout(() => {
        focusPosition(pick.cl, pick.gid, pick.posIdx);
        // Append next-surprise hint on a delay so showPositionCard's
        // innerHTML replace has finished. Otherwise the hint gets wiped.
        setTimeout(() => {
          const pc = document.getElementById('position-card');
          if (!pc || pc.classList.contains('hidden')) return;
          if (pc.querySelector('.pc2-next-hint')) return;
          const hint = document.createElement('button');
          hint.className = 'pc2-next-hint';
          hint.innerHTML = '✦ next surprise';
          hint.type = 'button';
          hint.onclick = () => pickSurprise();
          pc.appendChild(hint);
        }, 60);
      }, 250);
      btnSurprise.classList.add('flashing');
      setTimeout(() => btnSurprise.classList.remove('flashing'), 600);
    }
    btnSurprise.onclick = pickSurprise;

    // Any drill-down exit leaves surprise mode.
    nav.addEventListener('focus', (ev) => {
      // If the user navigated manually (not via pickSurprise), the currentFocusedPosition
      // gets cleared upstream. We detect manual nav by checking: if Surprise is advancing,
      // the new gid matches the most recent recent-entry's gid.
      const recent = _surpriseRecent[_surpriseRecent.length - 1];
      if (recent) {
        const [gRecent] = recent.split(':').map(Number);
        if (ev.detail.gid !== gRecent) _inSurpriseMode = false;
      } else { _inSurpriseMode = false; }
    });
  }

  // Wire the clickable surprise hint (top-right of globe) to
  // synthesize the same keydown the nav controller listens for. Works in
  // both the minimal layout (nav.js fallback picks a random cluster) and
  // the original (calls btn-surprise).
  (() => {
    const hint = document.getElementById('surprise-hint');
    if (!hint) return;
    const trigger = (e) => {
      e?.preventDefault?.();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    };
    hint.addEventListener('click', trigger);
    hint.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') trigger(e);
    });
  })();

  // ─── Lateral keyboard navigation ───────────────────────────
  //   [ / ] → prev/next position within the current sub
  //   { / } → prev/next sub within the current cluster
  // Registered unconditionally (not gated on btn-surprise existing) so
  // these shortcuts work in the minimal layout too.
  window.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === '[' || k === ']') {
      const gid = nav.focusGid;
      if (gid == null) return;
      const doc = App.state.positionAnchors?.[String(gid)];
      const positions = (doc?.positions || []).filter(p => p.count > 0);
      if (positions.length === 0) return;
      const realIdxs = (doc.positions || []).map((p, i) => ({ p, i })).filter(o => o.p.count > 0).map(o => o.i);
      const currIdx = realIdxs.indexOf(currentFocusedPosition?.posIdx ?? nav.focusPosIdx ?? -1);
      let nextIdx;
      if (currIdx < 0) nextIdx = 0;
      else nextIdx = (currIdx + (k === ']' ? 1 : -1) + realIdxs.length) % realIdxs.length;
      focusPosition(doc.cl, gid, realIdxs[nextIdx]);
      e.preventDefault();
      return;
    }
    if (k === '{' || k === '}') {
      const cl = nav.focusCl;
      if (cl == null) return;
      const subs = App.state.subMeta?.[String(cl)] || [];
      if (subs.length === 0) return;
      const gidList = subs.map(s => App.subGidMap.byLocal[cl]?.[s.sub]).filter(g => g != null);
      if (gidList.length === 0) return;
      const curr = gidList.indexOf(nav.focusGid);
      const idx = curr < 0 ? 0 : (curr + (k === '}' ? 1 : -1) + gidList.length) % gidList.length;
      nav.focus({ cl, gid: gidList[idx] });
      e.preventDefault();
      return;
    }
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
      globe.rotateTo(pos.lat, pos.lon, 1.35);
      pulseAt(pos.lat, pos.lon, sphereColor(cl));
    }
    showPositionCard(cl, gid, posIdx);
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

  // Position-card lives in the same corner as the interview/detail card.
  // Shows the LLM statement + three real attributed sample posts so the
  // reader can judge whether the abstraction actually matches the data.
  async function showPositionCard(cl, gid, posIdx) {
    // Position card disabled — clicking a position still highlights points
    // in the globe but no longer pops a detail panel.
    document.getElementById('position-card')?.classList.add('hidden');
    return;
    const doc = App.state.positionAnchors?.[String(gid)];
    if (!doc) return;
    const pos = doc.positions?.[posIdx];
    if (!pos) return;
    dc.classList.add('hidden');
    if (ic) ic.classList.add('hidden');
    if (voicesInline) voicesInline.classList.add('hidden');
    // Position card stacks in the same top-right region as focus-card in
    // the minimal layout, so hide focus-card when a position opens.
    focusCard.classList.add('hidden');
    const btnV = document.getElementById('btn-voices'); if (btnV) btnV.classList.remove('on');
    hideInspectorEmpty();
    const color = sphereColor(cl);
    const el = document.getElementById('position-card');
    if (!el) return;

    // Sample up to 3 attributed points for this position (approximates
    // "show me the evidence").
    const sampleIdxs = [];
    if (App.state.positionAssignments) {
      const assign = App.state.positionAssignments;
      const st = App.state;
      const sub = App.subGidMap.byGid[gid];
      if (sub) {
        let tries = 0;
        // Collect up to 60 candidates then pick 3 at random for variety.
        // Respect the active timeline filter — evidence should come from
        // the period the user is looking at.
        const monthAssign = st.monthAssignments;
        const mr = globe._filter?.monthRange;
        const hasMonthFilter = !!(mr && monthAssign);
        const pool = [];
        for (let i = 0; i < st.N && pool.length < 60 && tries < 300000; i++, tries++) {
          if (assign[i] === posIdx && st.cluster[i] === sub.cl && st.subLocal[i] === sub.sub) {
            if (hasMonthFilter) {
              const m = monthAssign[i];
              if (m < mr.lo || m > mr.hi) continue;
            }
            pool.push(i);
          }
        }
        // Fallback: if the filter zeroed the pool, show unfiltered samples
        // so the card isn't empty.
        if (hasMonthFilter && pool.length === 0) {
          for (let i = 0; i < st.N && pool.length < 60; i++) {
            if (assign[i] === posIdx && st.cluster[i] === sub.cl && st.subLocal[i] === sub.sub) {
              pool.push(i);
            }
          }
        }
        // Randomly pick up to 3
        while (sampleIdxs.length < 3 && pool.length > 0) {
          const r = Math.floor(Math.random() * pool.length);
          sampleIdxs.push(pool[r]);
          pool.splice(r, 1);
        }
      }
    }

    el.innerHTML = `
      <button class="pc2-close" id="pc2-close" aria-label="Close">×</button>
      <button class="pc2-copy-md" id="pc2-copy-md" aria-label="Copy as markdown" title="Copy point-of-view summary as markdown (for notes / writeups)">📋</button>
      <nav class="pc2-breadcrumbs">
        <button class="pc2-up" data-level="all" aria-label="All topics">All</button>
        <span class="pc2-sep">›</span>
        <button class="pc2-up" data-level="cluster" style="color:${color}">${escapeHtml(doc.cluster_name)}</button>
        <span class="pc2-sep">›</span>
        <button class="pc2-up" data-level="sub">${escapeHtml(doc.sub_name)}</button>
      </nav>
      <h3 class="pc2-title">${escapeHtml(pos.name)} ${renderTrendBadge(getPositionSeries(gid, posIdx))}</h3>
      <p class="pc2-description">${escapeHtml(pos.description || '')}</p>
      ${pos.keywords && pos.keywords.length ? `
        <div class="pc2-kw-label">signal phrases</div>
        <div class="pc2-kws">${pos.keywords.slice(0, 6).map(k => `<span class="pc2-kw">${escapeHtml(k)}</span>`).join('')}</div>
      ` : ''}
      <div class="pc2-samples" id="pc2-samples">
        <div class="pc2-kw-label">evidence · attributed posts</div>
        <div class="pc2-sample-list" id="pc2-sample-list"></div>
      </div>
      <div class="pc2-stats">
        <span><b>${pos.count.toLocaleString()}</b> posts match</span>
        <span class="pc2-sep">·</span>
        <span>${Math.round(100 * pos.count / (doc.total_in_sub || 1))}% of <i>${doc.sub_name}</i></span>
      </div>
      ${renderPositionSparkline(gid, posIdx, color) || ''}
      ${(() => {
        // Sibling positions in the same sub — enables lateral exploration
        // of alternative stances without going back out to the bar. Shown as
        // small chips, colored like the sub. Each chip also surfaces its
        // dominant subreddit — if that differs from the current stance's
        // top community, a ⇋ marker flags it as a cross-community foil.
        const siblings = (doc.positions || []).map((p, i) => ({ p, i })).filter(o => o.i !== posIdx && o.p.count > 0);
        if (siblings.length === 0) return '';
        siblings.sort((a, b) => (b.p.count || 0) - (a.p.count || 0));
        const myDom = getPositionDominantSub(gid, posIdx);
        const chips = siblings.slice(0, 6).map(o => {
          const s = getPositionSeries(gid, o.i);
          const dir = getTrendInfo(s).dir;
          const arrow = dir === 'up' ? '<span class="pc2-sib-up" title="trending up">▲</span>'
                      : dir === 'down' ? '<span class="pc2-sib-down" title="fading">▼</span>' : '';
          const dom = getPositionDominantSub(gid, o.i);
          const different = dom && myDom && dom.id !== myDom.id;
          const voiceBadge = dom ? `
            <span class="pc2-sib-voice${different ? ' pc2-sib-voice-diff' : ''}"
                  title="${escapeHtml(different ? `voiced mostly in r/${dom.name} — a different community from this stance's r/${myDom.name}` : `voiced mostly in r/${dom.name}`)}">
              ${different ? '<span class="pc2-sib-voice-cross">⇋</span>' : ''}r/${escapeHtml(dom.name)}
            </span>` : '';
          // Include the full stance name in the tooltip so users see the
          // tail of ellipsized names (pc2-sib-name clamps to 180px).
          const titleTxt = o.p.description ? `${o.p.name} — ${o.p.description}` : o.p.name;
          return `
            <button class="pc2-sibling${different ? ' pc2-sibling-diff' : ''}" data-idx="${o.i}"
                    title="${escapeHtml(titleTxt)}">
              <span class="pc2-sib-name">${escapeHtml(o.p.name)}</span>
              ${arrow}
              ${voiceBadge}
              <span class="pc2-sib-count">${(o.p.count || 0).toLocaleString()}</span>
            </button>
          `;
        }).join('');
        return `
          <div class="pc2-sibling-label">other points of view in this subtopic</div>
          <div class="pc2-siblings">${chips}</div>
        `;
      })()}
      ${renderPositionSubreddits(gid, posIdx, color) || ''}
      ${(() => {
        // Cross-sub resonance: positions in OTHER subs that share
        // keyword/description tokens with this one. This surfaces lateral
        // connections (e.g. "Desperate City Brain Drain" ↔ "Middle-Class
        // Squeeze" in a different sub) for true serendipity. Each chip
        // includes the other stance's dominant community so the reader can
        // see whether a shared idea travels between communities or stays put.
        const resonant = findResonantPositions(gid, posIdx, pos, 3);
        if (!resonant.length) return '';
        const myDom = getPositionDominantSub(gid, posIdx);
        const chips = resonant.map(r => {
          const col = sphereColor(r.cl);
          const dir = getTrendInfo(getPositionSeries(r.gid, r.posIdx)).dir;
          const arrow = dir === 'up' ? '<span class="pc2-sib-up" title="trending up">▲</span>'
                      : dir === 'down' ? '<span class="pc2-sib-down" title="fading">▼</span>' : '';
          const dom = getPositionDominantSub(r.gid, r.posIdx);
          const different = dom && myDom && dom.id !== myDom.id;
          const voice = dom ? `<span class="pc2-res-voice${different ? ' pc2-res-voice-diff' : ''}"
            title="${escapeHtml(different ? `voiced in r/${dom.name} — different from this stance's r/${myDom.name}` : `voiced in r/${dom.name}`)}">${different ? '⇋ ' : ''}r/${escapeHtml(dom.name)}</span>` : '';
          // Full name in tooltip since pc2-res-name clamps to 160px.
          const titleTxt = r.description ? `${r.name} — ${r.description}` : r.name;
          return `
            <button class="pc2-resonant${different ? ' pc2-resonant-diff' : ''}" data-gid="${r.gid}" data-pos-idx="${r.posIdx}" data-cl="${r.cl}"
                    style="--rc-color:${col}"
                    title="${escapeHtml(titleTxt)}">
              <span class="pc2-res-dot" style="background:${col}"></span>
              <span class="pc2-res-name">${escapeHtml(r.name)}</span>
              ${arrow}
              ${voice}
              <span class="pc2-res-sub">${escapeHtml(r.sub_name)}</span>
            </button>
          `;
        }).join('');
        return `
          <div class="pc2-sibling-label">resonates in other subtopics</div>
          <div class="pc2-siblings">${chips}</div>
        `;
      })()}
    `;
    el.classList.remove('hidden');
    scrollCardIntoView(el);

    // Wire sibling chips — each jumps to that position via focusPosition.
    el.querySelectorAll('.pc2-sibling').forEach(btn => {
      btn.onclick = () => {
        const idx = +btn.dataset.idx;
        focusPosition(cl, gid, idx);
      };
    });
    // Subreddit chips: intersect the current position highlight with a
    // subreddit filter so the user sees only posts from that community
    // attributed to this stance.
    el.querySelectorAll('.pc2-sr-lbl').forEach(btn => {
      btn.onclick = () => {
        const id = +btn.dataset.srId;
        const name = btn.dataset.srName;
        if (id >= 0 && name) toggleSubredditFilter(id, name, cl, gid);
      };
    });
    // Resonant chips (cross-sub) — drill to the other sub first, then the
    // position, so the breadcrumbs + globe rotate together.
    el.querySelectorAll('.pc2-resonant').forEach(btn => {
      btn.onclick = () => {
        const targetGid = +btn.dataset.gid;
        const targetCl = +btn.dataset.cl;
        const targetPos = +btn.dataset.posIdx;
        nav.focus({ cl: targetCl, gid: targetGid });
        setTimeout(() => focusPosition(targetCl, targetGid, targetPos), 220);
      };
    });

    const closeBtn = document.getElementById('pc2-close');
    closeBtn.onclick = () => {
      el.classList.add('hidden');
      currentFocusedPosition = null;
      posLabelEls.forEach(p => p.el.classList.remove('selected'));
      if (nav.focusCl != null && nav.focusGid != null) {
        globe.setHighlight({ cl: nav.focusCl, gid: nav.focusGid });
      } else {
        globe.setHighlight({});
      }
    };

    // "Copy as markdown" — gives researchers a pasteable stance summary
    // (cluster ▸ sub ▸ stance, description, subreddit mix, 3 evidence
    // quotes, shareable link) so they can lift a finding straight into
    // notes or a writeup without retyping.
    const copyBtn = document.getElementById('pc2-copy-md');
    if (copyBtn) {
      copyBtn.onclick = async () => {
        const subArr = getPositionSubredditCounts(gid, posIdx) || [];
        const subTotal = subArr.reduce((s, e) => s + e.n, 0);
        // Match the visible card's threshold — when attributed points < 5
        // the subreddit signal is too thin to report honestly.
        const mixLine = subTotal >= 5 ? subArr.slice(0, 3)
          .map(s => `r/${s.name} ${Math.round(100 * s.n / subTotal)}%`)
          .join(' · ') : '';
        const t = getTrendInfo(getPositionSeries(gid, posIdx));
        const trendStr = t.dir === 'up' ? ' ▲ trending' : t.dir === 'down' ? ' ▼ fading' : '';
        const kwStr = (pos.keywords || []).slice(0, 6).join(', ');
        // Sample items have class .pc2-sample; we want just their text,
        // stripping any footer bylines we rendered inside.
        const sampleEls = Array.from(document.querySelectorAll('#pc2-sample-list .pc2-sample'))
          .slice(0, 3)
          .map(e => {
            const clone = e.cloneNode(true);
            clone.querySelectorAll('.pc2-sample-meta, .pc2-sample-sub, [class*="byline"]').forEach(n => n.remove());
            return (clone.textContent || '').replace(/\s+/g, ' ').trim();
          })
          .filter(Boolean);
        const sampleLines = sampleEls.map(s => `- ${s.length > 280 ? s.slice(0, 277) + '…' : s}`);
        // Carry active filter state into the link so the recipient lands
        // on the same view (matches focus-card copy-md behavior in v=146).
        const linkParts = [`cl=${cl}`, `gid=${gid}`, `pos=${posIdx}`];
        const mr = globe._filter?.monthRange;
        if (mr) { linkParts.push(`from=${mr.lo}`); linkParts.push(`to=${mr.hi}`); }
        if (_activeSubredditFilter) linkParts.push(`sr=${_activeSubredditFilter.id}`);
        const qNow = document.getElementById('search-input')?.value?.trim();
        if (qNow) linkParts.push(`q=${encodeURIComponent(qNow)}`);
        const link = `${location.origin}${location.pathname}#${linkParts.join('&')}`;
        const md = [
          `## ${pos.name}${trendStr}`,
          `*${doc.cluster_name} ▸ ${doc.sub_name}*`,
          '',
          (pos.description || '').trim(),
          '',
          mixLine ? `**Voiced by:** ${mixLine}` : '',
          kwStr ? `**Signal phrases:** ${kwStr}` : '',
          `**Volume:** ${pos.count.toLocaleString()} posts (${Math.round(100 * pos.count / (doc.total_in_sub || 1))}% of *${doc.sub_name}*)`,
          sampleLines.length ? '\n**Evidence:**\n' + sampleLines.join('\n') : '',
          `\n[View on globe](${link})`,
        ].filter(Boolean).join('\n').trim();
        let ok = false;
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(md);
            ok = true;
          }
        } catch (e) { /* fallback below */ }
        if (!ok) {
          const ta = document.createElement('textarea');
          ta.value = md; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          try { ok = document.execCommand('copy'); } catch {}
          ta.remove();
        }
        copyBtn.classList.toggle('copied', ok);
        copyBtn.classList.toggle('copy-err', !ok);
        copyBtn.setAttribute('data-msg', ok ? 'Copied!' : 'Copy failed');
        setTimeout(() => {
          copyBtn.classList.remove('copied', 'copy-err');
          copyBtn.removeAttribute('data-msg');
        }, 1600);
      };
    }
    // Inline breadcrumb buttons — direct jump up the hierarchy without
    // having to reach for the small crumbs in the header.
    el.querySelectorAll('.pc2-up').forEach(b => {
      b.onclick = () => {
        const lvl = b.dataset.level;
        if (lvl === 'all') nav.focus({});
        else if (lvl === 'cluster') nav.focus({ cl });
        else if (lvl === 'sub') nav.focus({ cl, gid });
        el.classList.add('hidden');
        currentFocusedPosition = null;
      };
    });

    // Populate evidence async
    const sampleList = document.getElementById('pc2-sample-list');
    if (sampleList) {
      if (sampleIdxs.length === 0) {
        sampleList.innerHTML = `<div class="pc2-sample-empty">No attributed posts — this point of view is largely inferred from the subtopic's top samples.</div>`;
      } else {
        for (const idx of sampleIdxs) {
          const placeholder = document.createElement('div');
          placeholder.className = 'pc2-sample';
          placeholder.textContent = '…';
          sampleList.appendChild(placeholder);
          (async () => {
            try {
              const d = await getPointDetails(App.state, idx);
              const title = (d.title || '').trim();
              const bodyRaw = (d.body || '').trim().replace(/\n+/g, ' ');
              // Reddit bodies come in markdown with some HTML-entity-encoded
              // quote markers — strip both so the preview reads like prose,
              // then escape before injecting. Prevents both visible
              // backslash-escaped chars and embedded HTML from affecting
              // the card.
              const body = bodyRaw
                .replace(/&gt;/g, '>').replace(/&lt;/g, '<')
                .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
                .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // [text](url) → text
                .replace(/!\[[^\]]*\]\([^)]+\)/g, '')      // drop image refs
                .replace(/`([^`]+)`/g, '$1')               // inline code
                .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')   // bold/italic
                .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')     // bold/italic (underscore)
                .replace(/(^|\s)>\s?/g, '$1')              // quote markers
                .replace(/\\([_*`\[\]()#.+!-])/g, '$1')    // escaped chars
                .replace(/\s+/g, ' ')
                .trim();
              const bodyClip = body.slice(0, 220) + (body.length > 220 ? '…' : '');
              placeholder.innerHTML = `
                ${title ? `<div class="pc2-sample-title">${escapeHtml(title)}</div>` : ''}
                <div class="pc2-sample-body">${escapeHtml(bodyClip)}</div>
                <div class="pc2-sample-meta">r/${escapeHtml(d.subreddit)} · ${escapeHtml(formatRedditKindLabel(d.type))} · ${escapeHtml(d.month)}${d.score != null ? ' · ' + redditScoreInlineHtml(d.score) : ''}</div>
              `;
              placeholder.onclick = () => openRedditThreadOrDetail(d);
              placeholder.style.cursor = 'pointer';
            } catch (e) {}
          })();
        }
      }
    }
  }
  window.App.focusPosition = focusPosition;
  window.App.showSnippetCard = (hit) => {
    const label = hit.context || hit.clusterName || '';
    showDetailCard({ _metaOverride: label, title: '', body: hit.label || '', permalink: null });
  };

  // ─── Per-post text search across the chunk corpus ────────────────────
  // Loads all 22 chunks once (cached forever in chunkCache), then scans
  // title + hover_body for substring matches. Heavy first call (~5–15 s
  // locally, longer over the network); subsequent calls are instant.
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
    pinnedPointIdx = idx;
    globe.setPinnedPoint(idx);
    const lat = App.state.coords[2 * idx];
    const lon = App.state.coords[2 * idx + 1];
    if (lat != null && lon != null) globe.rotateTo(lat, lon, 1.8);
    try {
      const details = await getPointDetails(App.state, idx);
      if (details) showDetailCard(details);
    } catch (e) {}
  }

  window.App.findPointsContaining = findPointsContaining;
  window.App.findPointForSnippet = findPointForSnippet;
  window.App.pinPointByIndex = pinPointByIndex;

  // ─── URL hash (read-only) ─────────────────────────────────────────
  // Hash persistence / history.pushState on drill were disabled so
  // exploration never mutates the address bar. `applyHash` still runs on
  // load / hashchange so an explicitly pasted #cl=… link can hydrate once.
  let _suppressHashWrite = false;
  let _pendingHashWrite = false;
  function writeHash() {
    if (_suppressHashWrite) { _pendingHashWrite = true; return; }
    // no-op: do not push/replace history or set location.hash from UI state
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
    // Validate ids against the loaded dataset so stale/garbage hashes don't
    // produce empty "Cluster 999" cards with a fully-dim globe. Invalid cl
    // or gid → treat as if that level wasn't specified; pos is cleared if
    // its anchor has no positions at the given index.
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
        // Replay the timeline scrubber state. `window._tlApplyHashRange` is
        // exposed by the scrubber IIFE so hash restore can drive it without
        // duplicating the bar-rendering logic.
        if (window._tlApplyHashRange) window._tlApplyHashRange(from, to);
        else globe.setMonthRange({ lo: from, hi: to });
      } else {
        globe.setMonthRange(null);
      }
      if (sr != null) {
        const name = App.state.subredditNames?.find(n => n.id === sr)?.name;
        if (name) toggleSubredditFilter(sr, name, cl, gid);
      }
      // Restore a shared search query — populate input AND re-run the
      // suggestion render so the first focus shows matches (otherwise
      // the user sees the query text but an empty dropdown, a silent
      // dead-end for anyone landing on a shared link).
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
  // In the minimal layout, clicking an L3 position bar emits a nav 'focus'
  // with posIdx set but nothing else wires that to showPositionCard. Route
  // it here so the card actually appears. Guarded on posIdx change to
  // avoid re-calling for the same position on every filter tweak.
  let _lastFocusPosKey = null;
  nav.addEventListener('focus', (ev) => {
    const { cl, gid, posIdx } = ev.detail || {};
    if (cl == null || gid == null || posIdx == null) { _lastFocusPosKey = null; return; }
    const key = `${cl}:${gid}:${posIdx}`;
    if (key === _lastFocusPosKey) return;
    _lastFocusPosKey = key;
    focusPosition(cl, gid, posIdx);
  });
  // Exposed for nav search blur etc.; persistence is a no-op (URL not updated).
  App.writeHash = writeHash;
  window.addEventListener('hashchange', applyHash);
  // Initial restore if someone landed on a deep-link
  if (location.hash) setTimeout(applyHash, 300);

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
      const wp = globe.worldPositionOf(info.lat, info.lon, 1.012);
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
      if (p?.lat != null) return { lat: p.lat, lon: p.lon, distance: 1.35, color: sphereColor(cl) };
    }
    if (nav.focusGid != null) {
      const g = App.subGidMap.byGid[nav.focusGid];
      if (g) {
        const a = subAnchor(App.state, g.cl, g.sub);
        if (a) return { lat: a.lat, lon: a.lon, distance: 1.55, color: sphereColor(g.cl) };
      }
    }
    if (nav.focusCl != null) {
      const a = clusterAnchor(App.state, nav.focusCl);
      if (a) return { lat: a.lat, lon: a.lon, distance: 1.9, color: sphereColor(nav.focusCl) };
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
    const rvHint = document.getElementById('reset-view-hint');
    if (rvHint) rvHint.classList.toggle('rv-away', !!globe.isZoomedAwayFromCanonical?.());
    // Drive pins + captions + position flags every frame.
    globe._updatePinScreenPositions?.();
    updateZoomCaptions?.();
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
      const wp = globe.worldPositionOf(info.lat, info.lon, 1.0);
      const facing = wp.x*(camPos.x-wp.x) + wp.y*(camPos.y-wp.y) + wp.z*(camPos.z-wp.z);
      if (facing <= 0) return null;
      proj.copy(wp).project(globe.camera);
      if (proj.z > 1) return null;
      const sx = (proj.x * 0.5 + 0.5) * w;
      const sy = (-proj.y * 0.5 + 0.5) * h;
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
          op = 0.95;
        } else if (key === focusKey) {
          op = 1;
        } else {
          // Fade sub labels by angular distance to the focused sub.
          // ~0 rad → 0.72, 0.3 rad → 0.38, 0.7+ rad → 0.18.
          const ang = angDistTo(info, focusSubXYZ);
          op = Math.max(0.18, 0.72 - ang * 0.75);
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
          if (!tryPlace(info, size, t * 0.85)) info.el.style.opacity = '0';
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
    // Only clear prior position focus when the NEW focus has no posIdx.
    // Otherwise, drilling into L3 (cl+gid+posIdx) ends up re-hiding the
    // card that the L3 click flow just opened.
    if (ev.detail.posIdx == null) {
      currentFocusedPosition = null;
      const pc2 = document.getElementById('position-card');
      if (pc2) pc2.classList.add('hidden');
    }
  });

  function interviewQuotes(iv) {
    if (!iv) return [];
    const arr = iv.quotes;
    if (Array.isArray(arr) && arr.length) return arr.map(x => String(x).trim()).filter(Boolean);
    if (iv.quote) return [String(iv.quote).trim()].filter(Boolean);
    return [];
  }
  function subtopicLineForPin(pin) {
    if (pin == null || pin.sub == null) return '';
    const subs = App.state.subMeta?.[String(pin.cluster)] || [];
    const hit = subs.find(s => s.sub === pin.sub);
    return hit?.name || '';
  }

  // ─── Interview pins ───────────────────────────────────────────
  globe.setInterviewPins(App.state.interviewPins?.placements || [], App.state.interviews);

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
          globe.rotateTo(p.lat, p.lon, 1.8);
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
      focusCard.classList.add('hidden');
      document.getElementById('detail-card').classList.add('hidden');
      document.getElementById('interview-card').classList.add('hidden');
      document.getElementById('position-card').classList.add('hidden');
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

  // Interview + position cards. In the current minimal layout, #insp-body
  // is CSS-hidden via display:none !important, which nukes the whole
  // subtree — so clicking an interview pin or an L3 position bar
  // populated the card but rendered nothing. Moving them out on boot
  // lets those interactions actually show the card at top-right.
  const ic = document.getElementById('interview-card');
  if (ic && ic.parentElement?.id === 'insp-body') {
    document.body.appendChild(ic);
  }
  const pc2 = document.getElementById('position-card');
  if (pc2 && pc2.parentElement?.id === 'insp-body') {
    document.body.appendChild(pc2);
  }
  const dcEl = document.getElementById('detail-card');
  if (dcEl && dcEl.parentElement?.id === 'insp-body') {
    document.body.appendChild(dcEl);
  }
  const fcEl = document.getElementById('focus-card');
  if (fcEl && fcEl.parentElement?.id === 'insp-body') {
    document.body.appendChild(fcEl);
  }
  const bmCardEl = document.getElementById('bookmarks-card');
  if (bmCardEl && bmCardEl.parentElement?.id === 'insp-body') {
    document.body.appendChild(bmCardEl);
  }
  // Keep <body class="has-floating-card"> in sync so CSS can fade the
  // keyboard hints when a card covers that top-right region. Uses a
  // single MutationObserver watching each card's class attribute.
  (() => {
    const cards = [ic, pc2, dcEl, fcEl].filter(Boolean);
    if (cards.length === 0) return;
    const refresh = () => {
      const anyVisible = cards.some(c => !c.classList.contains('hidden'));
      document.body.classList.toggle('has-floating-card', anyVisible);
    };
    const obs = new MutationObserver(refresh);
    for (const c of cards) obs.observe(c, { attributes: true, attributeFilter: ['class'] });
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
    dc.classList.add('hidden');
    clearSelectedPoint();
    focusCard.classList.add('hidden');
    document.getElementById('position-card').classList.add('hidden');
    if (voicesInline) voicesInline.classList.add('hidden');
    const btnV = document.getElementById('btn-voices'); if (btnV) btnV.classList.remove('on');
    hideInspectorEmpty();
    const iv = (App.state.interviews?.interviews || []).find(x => x.id === pin.id);
    if (!iv) return;
    const color = sphereColor(pin.cluster);
    const topic = pin.cluster_name || App.state.clusterMeta?.[String(pin.cluster)]?.name || `Topic ${pin.cluster}`;
    const subn = subtopicLineForPin(pin);
    const topicLine = subn ? `${topic} · ${subn}` : topic;
    const quotes = interviewQuotes(iv);
    const quotesHtml = quotes.length
      ? `<div class="ic-quotes">${quotes.map(q => `<blockquote class="ic-quote" style="border-left-color:${color}">“${escapeHtml(q)}”</blockquote>`).join('')}</div>`
      : '';
    const bridge =
      `This pin sits among threads in “${topic}”${subn ? ` → “${subn}”` : ''} because the interview text matched language in this region of the map. It is one street voice, not a summary of every post here.`;
    ic.innerHTML = `
      <button class="ic-close" id="ic-close-btn" aria-label="Close">×</button>
      <div class="ic-head">
        <div class="ic-avatar" style="background:${color}">${escapeHtml(pin.id)}</div>
        <div class="ic-head-text">
          <div class="ic-eyebrow">Street voice</div>
          <div class="ic-role">${escapeHtml(topicLine)}</div>
        </div>
      </div>
      ${quotesHtml}
      <p class="ic-bridge">${escapeHtml(bridge)}</p>
      <div class="ic-reddit-row">
        <div class="ic-reddit-label">Nearest Reddit voice</div>
        <button class="ic-reddit-btn" id="ic-reddit-btn">open the pinned thread →</button>
      </div>
      ${(() => {
        // Surface 3 top Reddit stances from the same sub this interview
        // is pinned to — turns the card into a launchpad into the data.
        const gid = App.subGidMap.byLocal[pin.cluster]?.[pin.sub];
        if (gid == null) return '';
        const doc = App.state.positionAnchors?.[String(gid)];
        if (!doc || !doc.positions) return '';
        const picks = doc.positions
          .map((p, i) => ({ p, i }))
          .filter(o => o.p.count && o.p.count > 0)
          .sort((a, b) => (b.p.count || 0) - (a.p.count || 0))
          .slice(0, 3);
        if (picks.length === 0) return '';
        const chips = picks.map(o => `
          <button class="ic-nearby-stance" data-gid="${gid}" data-pos="${o.i}" data-cl="${pin.cluster}"
                  style="--rc-color:${color}" title="${escapeHtml(o.p.description || '')}">
            <span class="ic-ns-dot" style="background:${color}"></span>
            <span class="ic-ns-name">${escapeHtml(o.p.name)}</span>
            <span class="ic-ns-count">${(o.p.count || 0).toLocaleString()}</span>
          </button>
        `).join('');
        return `
          <div class="ic-nearby-label">Stances in "${escapeHtml(doc.sub_name || '')}"</div>
          <div class="ic-nearby-list">${chips}</div>
        `;
      })()}
    `;
    ic.classList.remove('hidden');
    scrollCardIntoView(ic);
    document.getElementById('ic-close-btn').onclick = hideInterviewCard;
    document.getElementById('ic-reddit-btn').onclick = async () => {
      const d = await getPointDetails(App.state, pin.idx);
      openRedditThreadOrDetail(d);
    };
    // Nearby-stance chips → drill to that position.
    ic.querySelectorAll('.ic-nearby-stance').forEach(btn => {
      btn.onclick = () => {
        const gid = +btn.dataset.gid;
        const pos = +btn.dataset.pos;
        const clb = +btn.dataset.cl;
        nav.focus({ cl: clb, gid });
        setTimeout(() => focusPosition(clb, gid, pos), 220);
      };
    });
    // Rotate the globe so the pin faces the camera, then drop the pulse +
    // auto-load serendipitous nearby voices (zoom <1.65 triggers captions).
    globe.rotateTo(pin.lat, pin.lon, 1.5);
    pulseAt(pin.lat, pin.lon, sphereColor(pin.cluster));
    setTimeout(() => { try { refreshCaptions(); } catch(e){} }, 560);
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

  // ─── Serendipitous zoom-in captions ────────────────────────────
  let captionEpoch = 0;
  const captionLayer = (() => {
    let el = document.getElementById('zoom-captions');
    if (!el) {
      el = document.createElement('div');
      el.id = 'zoom-captions';
      el.className = 'zoom-captions';
      document.getElementById('globe-overlay').appendChild(el);
    }
    return el;
  })();
  // SVG overlay for leader lines connecting each caption box to its point.
  let captionLines = document.getElementById('caption-lines');
  if (!captionLines) {
    captionLines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    captionLines.setAttribute('id', 'caption-lines');
    captionLines.setAttribute('class', 'caption-lines');
    captionLines.style.cssText = 'position:absolute; inset:0; pointer-events:none; z-index:5;';
    document.getElementById('globe-overlay').appendChild(captionLines);
  }

  let activeCaptions = [];   // { idx, el, line, lat, lon, cluster, subLocal, offX, offY }
  let captionTimer = null;
  // How many captions should be visible at a given zoom distance?
  //   dist 1.8+  → 0 (far-away zoom: clean view)
  //   dist 1.6   → 5
  //   dist 1.35  → 10
  //   dist 1.18  → 20
  // Auto-popping post captions were removed per user request. The cursor
  // tooltip is the only surface for post content now.
  function captionBudget() { return 0; }
  async function refreshCaptions() {
    const budget = captionBudget();
    if (budget === 0) {
      for (const c of activeCaptions) { c.el.classList.remove('show'); c.line?.setAttribute('stroke-opacity', '0'); }
      setTimeout(() => {
        for (const c of activeCaptions) { c.el.remove(); c.line?.remove(); }
        activeCaptions = [];
      }, 320);
      return;
    }
    const myEpoch = ++captionEpoch;
    const targetV = globe.lookTargetWorld();
    const st = App.state;
    const camPos = globe.camera.position;
    // If the user has drilled, respect the focus — only sample points that
    // belong to that cluster (or sub). Makes the captions show "what's
    // actually in this region" rather than random noise.
    // Filter by CLUSTER only — a sub-level filter left too few candidates
    // to fill the budget at close zoom. Cluster gives the useful framing:
    // "what's around me in this topic".
    const focusCl = nav.focusCl;
    // Respect the active timeline filter + subreddit filter so captions
    // don't surface 2015 posts when the user is looking at a 2024 window,
    // or r/boston posts when they've filtered to r/mbta.
    const monthAssign = st.monthAssignments;
    const mr = globe._filter?.monthRange;
    const hasMonthFilter = !!(mr && monthAssign);
    const srFilter = globe._filter?.subredditIds;
    const srAssign = st.subredditAssignments;
    const hasSRFilter = !!(srFilter && srFilter.size > 0 && srAssign);

    const acceptDist = Math.min(0.9, 0.35 + (globe.distanceTarget - 1.18) * 0.6);
    const tries = 30000;
    const cands = [];
    for (let i = 0; i < tries && cands.length < 600; i++) {
      const ri = Math.floor(Math.random() * st.N);
      if (focusCl != null && st.cluster[ri] !== focusCl) continue;
      if (hasMonthFilter) {
        const m = monthAssign[ri];
        if (m < mr.lo || m > mr.hi) continue;
      }
      if (hasSRFilter && !srFilter.has(srAssign[ri])) continue;
      const lat = st.coords[2*ri], lon = st.coords[2*ri+1];
      const wp = globe.worldPositionOf(lat, lon, 1.012);
      const facing = wp.x*(camPos.x-wp.x) + wp.y*(camPos.y-wp.y) + wp.z*(camPos.z-wp.z);
      if (facing <= 0.15) continue;
      const d = wp.distanceTo(targetV);
      if (d > acceptDist) continue;
      cands.push({ idx: ri, dist: d, lat, lon, cluster: st.cluster[ri] });
    }
    cands.sort((a, b) => a.dist - b.dist);

    // Greedy pack with min screen-space separation so boxes don't overlap.
    const W = globe.canvas.clientWidth, H = globe.canvas.clientHeight;
    const MIN_SEP = 150;   // uniform box spacing; boxes are ~180px wide
    const chosen = [];
    for (const c of cands) {
      if (chosen.length >= budget) break;
      const wp = globe.worldPositionOf(c.lat, c.lon, 1.012);
      const p = wp.clone().project(globe.camera);
      const sx = (p.x * 0.5 + 0.5) * W;
      const sy = (-p.y * 0.5 + 0.5) * H;
      // Reject points near other pinned ones on screen.
      if (chosen.some(ch => Math.hypot(ch.sx - sx, ch.sy - sy) < MIN_SEP)) continue;
      // Push the box away from the point in the direction away from screen
      // center, so leader lines don't cross through the sphere's silhouette.
      const dx = sx - W * 0.5, dy = sy - H * 0.5;
      const mag = Math.hypot(dx, dy) || 1;
      const offX = (dx / mag) * 70;
      const offY = (dy / mag) * 50 - 20;
      chosen.push({ ...c, sx, sy, offX, offY });
    }

    // Diff existing vs. chosen; keep stable ones, transition the rest.
    const existingIdx = new Set(activeCaptions.map(a => a.idx));
    const nextIdx = new Set(chosen.map(c => c.idx));
    for (const a of activeCaptions) {
      if (!nextIdx.has(a.idx)) {
        a.el.classList.remove('show');
        a.line?.setAttribute('stroke-opacity', '0');
        setTimeout(() => { a.el.remove(); a.line?.remove(); }, 320);
      }
    }
    activeCaptions = activeCaptions.filter(a => nextIdx.has(a.idx));
    for (const c of chosen) {
      if (existingIdx.has(c.idx)) {
        // Update offX/offY in case zoom changed.
        const existing = activeCaptions.find(a => a.idx === c.idx);
        if (existing) { existing.offX = c.offX; existing.offY = c.offY; }
        continue;
      }
      const el = document.createElement('div');
      el.className = 'zcap';
      el.innerHTML = '<div class="zcap-meta"></div><div class="zcap-text">…</div>';
      captionLayer.appendChild(el);
      // SVG leader line.
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('stroke-width', '1');
      line.setAttribute('stroke-opacity', '0');
      captionLines.appendChild(line);
      const entry = { idx: c.idx, lat: c.lat, lon: c.lon, cluster: c.cluster,
                      subLocal: st.subLocal[c.idx], el, line,
                      offX: c.offX, offY: c.offY };
      activeCaptions.push(entry);
      (async () => {
        try {
          const d = await getPointDetails(App.state, c.idx);
          if (myEpoch !== captionEpoch && !activeCaptions.find(a => a.idx === c.idx)) return;
          const title = (d.title || '').trim();
          const body = (d.body || '').trim().replace(/\s+/g, ' ');
          const text = title && body
            ? `${title} — ${body}`.slice(0, 220)
            : (title || body).slice(0, 220);
          const meta = `r/${d.subreddit} · ${d.month}`;
          el.querySelector('.zcap-meta').textContent = meta;
          el.querySelector('.zcap-text').textContent = text || '…';
          el.dataset.cluster = d.cluster;
          const col = sphereColor(d.cluster);
          el.style.setProperty('--cap-color', col);
          line.setAttribute('stroke', col);
          el.onclick = () => openRedditThreadOrDetail(d);
          setTimeout(() => {
            el.classList.add('show');
            line.setAttribute('stroke-opacity', '0.55');
          }, 20);
        } catch (e) {}
      })();
    }
  }
  function updateZoomCaptions() {
    // Every-frame projection so boxes and leader lines track globe rotation.
    const W = globe.canvas.clientWidth, H = globe.canvas.clientHeight;
    captionLines.setAttribute('viewBox', `0 0 ${W} ${H}`);
    captionLines.setAttribute('width', W);
    captionLines.setAttribute('height', H);
    for (const c of activeCaptions) {
      const wp = globe.worldPositionOf(c.lat, c.lon, 1.012);
      const camPos = globe.camera.position;
      const facing = wp.x*(camPos.x-wp.x) + wp.y*(camPos.y-wp.y) + wp.z*(camPos.z-wp.z);
      const p = wp.clone().project(globe.camera);
      const sx = (p.x * 0.5 + 0.5) * W;
      const sy = (-p.y * 0.5 + 0.5) * H;
      if (facing <= 0 || p.z > 1) {
        c.el.style.opacity = '0';
        c.line?.setAttribute('stroke-opacity', '0');
        continue;
      }
      const bx = sx + c.offX, by = sy + c.offY;
      c.el.style.left = `${bx}px`;
      c.el.style.top = `${by}px`;
      c.el.style.opacity = '';
      if (c.line) {
        c.line.setAttribute('x1', sx);
        c.line.setAttribute('y1', sy);
        c.line.setAttribute('x2', bx);
        c.line.setAttribute('y2', by);
        c.line.setAttribute('stroke-opacity', '0.55');
      }
    }
  }
  function maybeScheduleCaptions() {
    if (captionTimer) clearTimeout(captionTimer);
    captionTimer = setTimeout(refreshCaptions, 320);
  }
  // Refresh the set only after ZOOM has SETTLED (distance == distanceTarget
  // and hasn't changed for 500ms). Firing during a smooth zoom causes
  // flicker — captions fade in/out mid-animation every time the distance
  // crosses a caption-budget threshold.
  let lastDistTarget = globe.distanceTarget;
  let lastDistActual = globe.distance;
  let stableSince = performance.now();
  let lastRefreshDist = globe.distanceTarget;
  setInterval(() => {
    const now = performance.now();
    const targetChanged = Math.abs(globe.distanceTarget - lastDistTarget) > 0.01;
    const stillAnimating = Math.abs(globe.distance - globe.distanceTarget) > 0.01;
    if (targetChanged || stillAnimating) {
      lastDistTarget = globe.distanceTarget;
      lastDistActual = globe.distance;
      stableSince = now;
      return;
    }
    // Target unchanged AND actual close to target — we've been steady for
    // at least (now - stableSince)ms.
    if (now - stableSince >= 500 && Math.abs(globe.distanceTarget - lastRefreshDist) > 0.05) {
      lastRefreshDist = globe.distanceTarget;
      refreshCaptions();
    }
  }, 160);
  nav.addEventListener('focus', () => { setTimeout(refreshCaptions, 650); });
  refreshCaptions();
  // Expose for debugging from the console.
  window.App.refreshCaptions = refreshCaptions;

  // ─── Hover arcs (per-point thread connections) ────────────────
  let hoverEpoch = 0;
  // ─── Shift-to-show-relations ──────────────────────────────────
  // Lazy build: on first shift-down, iterate every chunk and bucket points
  // by postId (extracted from permalink). Cached forever.
  let _threadMap = null;
  async function ensureThreadMap() {
    if (_threadMap) return _threadMap;
    const st = App.state;
    const byPost = new Map();
    for (let ci = 0; ci < st.manifest.files.length; ci++) {
      let p = st.chunkCache.get(ci);
      if (!p) {
        p = fetch('tsne_chunks/' + st.manifest.files[ci]).then(r => r.json());
        st.chunkCache.set(ci, p);
      }
      const c = await p;
      const off = c.offset;
      const perms = c.permalink || [];
      for (let j = 0; j < c.n; j++) {
        const pm = perms[j] || '';
        const m = pm.match(/\/comments\/([a-z0-9]+)\//);
        if (!m) continue;
        const id = m[1];
        let arr = byPost.get(id);
        if (!arr) { arr = []; byPost.set(id, arr); }
        arr.push(off + j);
      }
    }
    _threadMap = byPost;
    return byPost;
  }

  async function relationPairsForPoint(idx) {
    if (idx == null || idx < 0) return [];
    const details = await getPointDetails(App.state, idx);
    const m = (details?.permalink || '').match(/\/comments\/([a-z0-9]+)\//);
    const postId = m ? m[1] : null;
    if (!postId) return [];
    const postIdx = await buildPostIndex();
    const anchorIdx = postIdx.get(postId);
    const siblings = await siblingsForThread(postId);
    const anchor = anchorIdx != null && siblings.includes(anchorIdx) ? anchorIdx : idx;
    const pairs = [];
    for (const s of siblings) {
      if (s !== anchor) pairs.push([anchor, s]);
    }
    if (anchor !== idx) pairs.push([anchor, idx]);
    return pairs;
  }
  async function shiftShowRelations() {
    if (_shiftActive) return;
    _shiftActive = true;
    const epoch = ++_shiftEpoch;
    _priorThreadsEnabled = globe.threadArcsEnabled;
    const selectedIdx = pinnedPointIdx >= 0 ? pinnedPointIdx : hoverPointIdx;
    const selectedPairs = await relationPairsForPoint(selectedIdx);
    if (epoch !== _shiftEpoch || !_shiftActive) return;
    if (selectedPairs.length > 0) {
      await globe.loadThreadArcs(selectedPairs, { thin: true, opacity: 0.65 });
      if (epoch !== _shiftEpoch || !_shiftActive) return;
      globe.threadArcsEnabled = true;
      if (globe.threadArcs) globe.threadArcs.visible = true;
      return;
    }
    const map = await ensureThreadMap();
    if (epoch !== _shiftEpoch || !_shiftActive) return;
    // Build pairs: pick up to 60 threads whose anchor point is currently
    // "colored" (dim > 0.5), prefer threads with more members.
    const dimArr = globe.pointGeom?.attributes?.dim?.array;
    const candidates = [];
    for (const [id, idxs] of map) {
      if (idxs.length < 2) continue;
      // Does at least one point pass the filter?
      let visible = false;
      for (const pi of idxs) {
        if (!dimArr || dimArr[pi] > 0.5) { visible = true; break; }
      }
      if (!visible) continue;
      candidates.push({ id, idxs, n: idxs.length });
    }
    if (candidates.length === 0) { _shiftActive = false; return; }
    candidates.sort(() => Math.random() - 0.5);
    const picks = candidates.slice(0, 60);
    // Build a post-index so we can pick the POST itself as each thread's
    // anchor — makes the arcs radiate from the submission outward.
    const postIndex = await buildPostIndex();
    const pairs = [];
    for (const c of picks) {
      const anchorIdx = postIndex.get(c.id);
      const anchor = anchorIdx != null && c.idxs.includes(anchorIdx) ? anchorIdx : c.idxs[0];
      for (const m of c.idxs) {
        if (m === anchor) continue;
        pairs.push([anchor, m]);
        if (pairs.length >= 1500) break;
      }
      if (pairs.length >= 1500) break;
    }
    if (epoch !== _shiftEpoch || !_shiftActive) return;
    await globe.loadThreadArcs(pairs, { thin: true, opacity: 0.55 });
    if (epoch !== _shiftEpoch || !_shiftActive) return;
    globe.threadArcsEnabled = true;
    if (globe.threadArcs) globe.threadArcs.visible = true;
  }
  function shiftHideRelations() {
    if (!_shiftActive) return;
    _shiftActive = false;
    _shiftEpoch++;
    globe.threadArcsEnabled = _priorThreadsEnabled;
    if (globe.threadArcs) globe.threadArcs.visible = _priorThreadsEnabled;
    if (!_priorThreadsEnabled) globe.loadThreadArcs([]);
  }
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Shift' || e.repeat) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    if (_shiftActive) shiftHideRelations();
    else shiftShowRelations();
  });

  // Escape is the universal "back out of transient modes" key. Run in capture
  // so selected-node state clears before NavController hides the detail card.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    let handled = false;
    if (_spaceDown || activeSprouts.length) {
      _spaceDown = false;
      cancelSproutClearTimer();
      sproutClear();
      handled = true;
    }
    if (pinnedPointIdx >= 0) {
      clearSelectedPoint();
      handled = true;
    }
    if (_shiftActive) {
      shiftHideRelations();
      handled = true;
    }
    if (handled) {
      e.preventDefault();
      const layerOpen = [
        'presentation-title-overlay', 'tour-overlay', 'help-overlay',
        'detail-card', 'position-card', 'interview-card',
      ].some(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
      });
      if (!layerOpen) e.stopImmediatePropagation();
    }
  }, true);

  async function buildHoverArcs(idx, details) {
    const myEpoch = ++hoverEpoch;
    const st = App.state;
    const m = (details.permalink || '').match(/\/comments\/([a-z0-9]+)\//);
    const postId = m ? m[1] : null;
    if (!postId) { restoreFocusThreads(); return; }
    const postIdx = await buildPostIndex();
    if (myEpoch !== hoverEpoch) return;
    const pIdx = postIdx.get(postId);
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
    globe.loadThreadArcs(pairs, { thin: true, opacity: 0.65 });
    globe._hoverArcsActive = true;
  }

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
    hoverEpoch++;
    globe._hoverArcsActive = false;
    globe.loadThreadArcs([]);
  }

  // ─── Detail card (Reddit post/comment) ─────────────────────
  const dc = document.getElementById('detail-card');
  const dcMeta = document.getElementById('dc-meta');
  const dcTitle = document.getElementById('dc-title');
  const dcBody = document.getElementById('dc-body');
  const dcLink = document.getElementById('dc-link');
  // Hoisted so showDetailCard / bookmark wiring can reference it before the
  // bookmarks block declares the rest of the persistent UI further down.
  let _currentDetailPin = null;
  document.getElementById('dc-close').onclick = () => {
    dc.classList.add('hidden');
    clearSelectedPoint();
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
  function showDetailCard(d) {
    if (ic) ic.classList.add('hidden');
    focusCard.classList.add('hidden');
    document.getElementById('position-card').classList.add('hidden');
    if (voicesInline) voicesInline.classList.add('hidden');
    const btnV = document.getElementById('btn-voices'); if (btnV) btnV.classList.remove('on');
    hideInspectorEmpty();
    if (d._metaOverride != null) {
      dcMeta.innerHTML = `<span class="dc-meta-text">${escapeHtml(d._metaOverride)}</span>`;
    } else {
      const left = `r/${escapeHtml(d.subreddit)} · ${escapeHtml(formatRedditKindLabel(d.type))} · ${escapeHtml(d.month)}`;
      dcMeta.innerHTML = `<span class="dc-meta-text">${left}</span>${d.score != null ? ' · ' + redditScoreInlineHtml(d.score) : ''}`;
    }
    dcTitle.textContent = (d.title || '').trim();
    dcBody.textContent = (d.body || '').slice(0, 1600);
    if (d.permalink) { dcLink.href = d.permalink; dcLink.style.display = ''; }
    else dcLink.style.display = 'none';
    _currentDetailPin = d;
    if (typeof updateDetailBookmarkBtn === 'function') updateDetailBookmarkBtn();
    dc.classList.remove('hidden');
    renderDetailContext(d).catch(() => {});
    scrollCardIntoView(dc);
  }

  // Fisheye: pinned post in the center, thread siblings arrayed around it.
  // Built lazily from the existing siblingsForThread helper, so the same
  // post-id grouping that drives Shift-relations powers the per-card view.
  let _detailContextToken = 0;
  async function renderDetailContext(d) {
    const ctxEl = document.getElementById('dc-context');
    if (!ctxEl) return;
    const token = ++_detailContextToken;
    ctxEl.classList.add('hidden');
    ctxEl.innerHTML = '';
    const m = (d?.permalink || '').match(/\/comments\/([a-z0-9]+)\//);
    const postId = m ? m[1] : null;
    if (!postId || d?.idx == null) return;
    ctxEl.classList.remove('hidden');
    ctxEl.innerHTML = `<div class="dc-ctx-head">Thread context</div><div class="dc-ctx-loading">Loading thread…</div>`;
    let siblings;
    try { siblings = await siblingsForThread(postId); }
    catch { siblings = []; }
    if (token !== _detailContextToken) return;
    const others = siblings.filter(s => s !== d.idx);
    if (others.length === 0) {
      ctxEl.innerHTML = `<div class="dc-ctx-head">Thread context</div><div class="dc-ctx-empty">No other points share this thread.</div>`;
      return;
    }
    const MAX = 10;
    const shown = others.slice(0, MAX);
    const detailsList = await Promise.all(
      shown.map(i => getPointDetails(App.state, i).catch(() => null))
    );
    if (token !== _detailContextToken) return;

    const W = 320, H = 220;
    const cx = W / 2, cy = H / 2;
    const innerR = 22;
    const ringR = Math.min(W, H) * 0.42;
    const centerColor = sphereColor(d.cluster);

    const positions = shown.map((idx, i) => {
      const angle = (i / shown.length) * Math.PI * 2 - Math.PI / 2;
      return {
        idx,
        det: detailsList[i],
        x: cx + Math.cos(angle) * ringR,
        y: cy + Math.sin(angle) * ringR,
      };
    });

    const lines = positions.map(p => {
      const col = p.det != null ? sphereColor(p.det.cluster) : '#666';
      return `<line class="dc-fish-line" x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="${col}" stroke-opacity="0.5" stroke-width="1.5"/>`;
    }).join('');

    const sats = positions.map(p => {
      const col = p.det != null ? sphereColor(p.det.cluster) : '#666';
      return `<circle class="dc-fish-sat" data-idx="${p.idx}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="9" fill="${col}" stroke="rgba(0,0,0,0.55)" stroke-width="1"/>`;
    }).join('');

    const center =
      `<circle class="dc-fish-center" cx="${cx}" cy="${cy}" r="${innerR}" fill="${centerColor}" stroke="#fff" stroke-width="2.5"/>` +
      `<text class="dc-fish-center-label" x="${cx}" y="${cy + 4}" text-anchor="middle">PINNED</text>`;

    const moreNote = others.length > shown.length
      ? `<div class="dc-ctx-more">+${others.length - shown.length} more in this thread</div>`
      : '';

    const list = positions.map(p => {
      const det = p.det;
      const col = det != null ? sphereColor(det.cluster) : '#666';
      const titleText = ((det?.title || det?.body || '').replace(/\s+/g, ' ').trim()) || '(no text)';
      const meta = det
        ? `r/${escapeHtml(det.subreddit || '—')} · ${escapeHtml(formatRedditKindLabel(det.type))}`
        : 'unknown';
      return `
        <button class="dc-ctx-row" data-idx="${p.idx}" type="button">
          <span class="dc-ctx-dot" style="background:${col}"></span>
          <span class="dc-ctx-meta">${meta}</span>
          <span class="dc-ctx-title">${escapeHtml(titleText.slice(0, 120))}</span>
        </button>
      `;
    }).join('');

    ctxEl.innerHTML = `
      <div class="dc-ctx-head">Thread context · ${others.length} ${others.length === 1 ? 'point' : 'points'}</div>
      <svg class="dc-fisheye" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        ${lines}${center}${sats}
      </svg>
      <div class="dc-ctx-list">${list}</div>
      ${moreNote}
    `;

    const refocus = (idx) => {
      if (idx == null || isNaN(idx)) return;
      pinPointByIndex(idx);
    };
    ctxEl.querySelectorAll('.dc-ctx-row').forEach(el => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        refocus(+el.dataset.idx);
      });
      el.addEventListener('mouseenter', () => {
        const idx = +el.dataset.idx;
        ctxEl.querySelectorAll('.dc-fish-sat').forEach(s => {
          s.classList.toggle('active', +s.dataset.idx === idx);
        });
      });
      el.addEventListener('mouseleave', () => {
        ctxEl.querySelectorAll('.dc-fish-sat.active').forEach(s => s.classList.remove('active'));
      });
    });
    ctxEl.querySelectorAll('.dc-fish-sat').forEach(el => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        refocus(+el.dataset.idx);
      });
      el.addEventListener('mouseenter', () => {
        const idx = +el.dataset.idx;
        ctxEl.querySelectorAll('.dc-ctx-row').forEach(row => {
          row.classList.toggle('active', +row.dataset.idx === idx);
        });
      });
      el.addEventListener('mouseleave', () => {
        ctxEl.querySelectorAll('.dc-ctx-row.active').forEach(row => row.classList.remove('active'));
      });
    });
  }

  // ─── Bookmarks: save pinned points for later browsing ─────────
  // Persisted in localStorage as a flat list (most-recent first). We snapshot
  // enough metadata to render the list without re-fetching the chunk before
  // the user clicks the row; clicking re-pins via pinPointByIndex which
  // refreshes the live detail card.
  const BOOKMARKS_KEY = 'bhd-bookmarks-v1';
  const BOOKMARKS_MAX = 200;
  const dcBookmarkBtn = document.getElementById('dc-bookmark');
  const bmCard = document.getElementById('bookmarks-card');
  const bmList = document.getElementById('bm-list');
  const bmEmpty = document.getElementById('bm-empty');
  const bmClearBtn = document.getElementById('bm-clear');
  const bmCloseBtn = document.getElementById('bm-close');
  const bmToggle = document.getElementById('bookmarks-toggle');
  const bmToggleCount = document.getElementById('bookmarks-toggle-count');

  function loadBookmarks() {
    try {
      const raw = localStorage.getItem(BOOKMARKS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  function saveBookmarks(list) {
    try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list.slice(0, BOOKMARKS_MAX))); }
    catch {}
  }
  let _bookmarks = loadBookmarks();
  function isBookmarked(idx) {
    if (idx == null) return false;
    return _bookmarks.some(b => b.idx === idx);
  }
  function bookmarkSnapshot(d) {
    return {
      idx: d.idx,
      title: (d.title || '').slice(0, 240),
      bodySnippet: (d.body || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      subreddit: d.subreddit || '',
      type: d.type,
      month: d.month || '',
      cluster: d.cluster,
      permalink: d.permalink || '',
      savedAt: Date.now(),
    };
  }
  function addBookmark(d) {
    if (d?.idx == null) return;
    if (isBookmarked(d.idx)) return;
    _bookmarks.unshift(bookmarkSnapshot(d));
    if (_bookmarks.length > BOOKMARKS_MAX) _bookmarks.length = BOOKMARKS_MAX;
    saveBookmarks(_bookmarks);
    syncBookmarksUI();
  }
  function removeBookmark(idx) {
    const next = _bookmarks.filter(b => b.idx !== idx);
    if (next.length === _bookmarks.length) return;
    _bookmarks = next;
    saveBookmarks(_bookmarks);
    syncBookmarksUI();
  }
  function clearAllBookmarks() {
    if (_bookmarks.length === 0) return;
    if (!confirm(`Remove all ${_bookmarks.length} saved point${_bookmarks.length === 1 ? '' : 's'}?`)) return;
    _bookmarks = [];
    saveBookmarks(_bookmarks);
    syncBookmarksUI();
  }

  function formatBookmarkAge(ts) {
    if (!ts) return '';
    const sec = Math.max(1, Math.round((Date.now() - ts) / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 30) return `${day}d ago`;
    try { return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
    catch { return ''; }
  }

  function syncBookmarksUI() {
    const n = _bookmarks.length;
    if (bmToggle && bmToggleCount) {
      bmToggleCount.textContent = String(n);
      bmToggle.classList.toggle('hidden', n === 0);
    }
    updateDetailBookmarkBtn();
    if (bmCard && !bmCard.classList.contains('hidden')) renderBookmarksCard();
  }
  function updateDetailBookmarkBtn() {
    if (!dcBookmarkBtn) return;
    const idx = _currentDetailPin?.idx;
    const on = idx != null && isBookmarked(idx);
    dcBookmarkBtn.classList.toggle('on', on);
    dcBookmarkBtn.textContent = on ? '★' : '☆';
    dcBookmarkBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    dcBookmarkBtn.title = on ? 'Remove from saved points' : 'Bookmark this point (saved locally)';
  }
  function renderBookmarksCard() {
    if (!bmCard || !bmList) return;
    bmList.innerHTML = '';
    if (!_bookmarks.length) {
      if (bmEmpty) bmEmpty.style.display = '';
      return;
    }
    if (bmEmpty) bmEmpty.style.display = 'none';
    for (const b of _bookmarks) {
      const col = sphereColor(b.cluster);
      const titleText = (b.title || b.bodySnippet || '(no text)').trim();
      const meta = `r/${escapeHtml(b.subreddit || '—')} · ${escapeHtml(formatRedditKindLabel(b.type))}${b.month ? ' · ' + escapeHtml(b.month) : ''}`;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bm-row';
      row.dataset.idx = String(b.idx);
      row.innerHTML = `
        <span class="bm-dot" style="background:${col}"></span>
        <span class="bm-row-body">
          <span class="bm-row-meta">${meta}</span>
          <span class="bm-row-title">${escapeHtml(titleText)}</span>
          <span class="bm-row-saved">saved ${escapeHtml(formatBookmarkAge(b.savedAt))}</span>
        </span>
        <button class="bm-row-remove" type="button" aria-label="Remove from saved" title="Remove">×</button>
      `;
      row.addEventListener('click', (ev) => {
        if (ev.target.closest('.bm-row-remove')) return;
        pinPointByIndex(b.idx);
      });
      row.querySelector('.bm-row-remove').addEventListener('click', (ev) => {
        ev.stopPropagation();
        removeBookmark(b.idx);
      });
      bmList.appendChild(row);
    }
  }
  function showBookmarksCard() {
    if (!bmCard) return;
    bmCard.classList.remove('hidden');
    bmToggle?.classList.add('on');
    bmToggle?.setAttribute('aria-pressed', 'true');
    renderBookmarksCard();
  }
  function hideBookmarksCard() {
    if (!bmCard) return;
    bmCard.classList.add('hidden');
    bmToggle?.classList.remove('on');
    bmToggle?.setAttribute('aria-pressed', 'false');
  }
  function toggleBookmarksCard() {
    if (!bmCard) return;
    if (bmCard.classList.contains('hidden')) showBookmarksCard();
    else hideBookmarksCard();
  }

  if (dcBookmarkBtn) {
    dcBookmarkBtn.onclick = (ev) => {
      ev.stopPropagation();
      const d = _currentDetailPin;
      if (!d || d.idx == null) return;
      if (isBookmarked(d.idx)) removeBookmark(d.idx);
      else addBookmark(d);
    };
  }
  if (bmToggle) bmToggle.onclick = (ev) => { ev.stopPropagation(); toggleBookmarksCard(); };
  if (bmCloseBtn) bmCloseBtn.onclick = (ev) => { ev.stopPropagation(); hideBookmarksCard(); };
  if (bmClearBtn) bmClearBtn.onclick = (ev) => { ev.stopPropagation(); clearAllBookmarks(); };

  window.App = window.App || {};
  window.App.closeBookmarksCard = () => {
    if (!bmCard) return false;
    if (bmCard.classList.contains('hidden')) return false;
    hideBookmarksCard();
    return true;
  };

  syncBookmarksUI();

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

  // ─── Thread arcs for focused cluster/sub ────────────────────
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
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ─── Cross-position keyword resonance ──────────────────────────
//
// For a given position, find the top-K positions in OTHER subs whose
// keywords + name + description tokens overlap the most. Caches the
// tokenization per (gid, posIdx) so repeated lookups are cheap.
const STOPWORDS = new Set('the and a an in of to for with on at is are as by from this that it its be have has can do not but or if more than about over under into'.split(' '));
const _resonanceCache = new Map();
function _tokenizePosition(p) {
  const text = [
    (p.name || ''),
    (p.description || ''),
    ((p.keywords || []).join(' ')),
  ].join(' ').toLowerCase();
  const toks = text.match(/[a-z][a-z'-]{2,}/g) || [];
  const set = new Set();
  for (const t of toks) if (!STOPWORDS.has(t) && t.length > 2) set.add(t);
  return set;
}
function _positionTokens(gid, idx, pos) {
  const key = `${gid}:${idx}`;
  let s = _resonanceCache.get(key);
  if (!s) { s = _tokenizePosition(pos); _resonanceCache.set(key, s); }
  return s;
}
function findResonantPositions(gid, posIdx, pos, limit = 3) {
  const anchors = window.App?.state?.positionAnchors;
  if (!anchors) return [];
  const base = _positionTokens(gid, posIdx, pos);
  if (base.size < 2) return [];
  const results = [];
  for (const [otherGidStr, otherDoc] of Object.entries(anchors)) {
    const otherGid = +otherGidStr;
    if (otherGid === gid) continue;   // skip same sub — siblings cover that
    const positions = otherDoc.positions || [];
    for (let i = 0; i < positions.length; i++) {
      const op = positions[i];
      if (!op.count || op.count < 20) continue;
      const otherSet = _positionTokens(otherGid, i, op);
      // Jaccard-like overlap with a boost for absolute shared count.
      let shared = 0;
      for (const t of otherSet) if (base.has(t)) shared++;
      if (shared < 2) continue;
      const score = shared * shared / (base.size + otherSet.size);
      results.push({
        gid: otherGid, posIdx: i, cl: otherDoc.cl,
        name: op.name, description: op.description,
        sub_name: otherDoc.sub_name, cluster_name: otherDoc.cluster_name,
        score, shared,
      });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// Compact SVG sparkline from a pre-baked monthly series. Used in both the
// position card and the cluster/sub focus card.
// Paint a translucent band on every mini-sparkline indicating the
// globally-active month range filter. Called whenever the timeline
// scrubber changes, and also on each sparkline mount (via a small
// post-render hook below).
function updateSparklineBands(lo, hi, maxIdx) {
  const active = !(lo === 0 && hi === maxIdx);
  for (const spark of document.querySelectorAll('.pc2-spark')) {
    const band = spark.querySelector('.pc2-spark-filter-band');
    if (!band) continue;
    if (!active) { band.setAttribute('opacity', '0'); continue; }
    const i0 = +spark.dataset.i0;
    const i1 = +spark.dataset.i1;
    const W = +spark.dataset.w;
    const pad = +spark.dataset.pad;
    // Clip the filter to this sparkline's visible range [i0, i1].
    const fLo = Math.max(lo, i0);
    const fHi = Math.min(hi, i1);
    if (fLo > fHi) { band.setAttribute('opacity', '0'); continue; }
    const span = Math.max(1, i1 - i0);
    const stepX = (W - pad * 2) / span;
    const x = pad + (fLo - i0) * stepX;
    const w = (fHi - fLo + 1) * stepX;
    band.setAttribute('x', x.toFixed(1));
    band.setAttribute('width', Math.max(1, w).toFixed(1));
    band.setAttribute('opacity', '0.18');
  }
}
function renderSparklineBySeries(series, labels, color, totalLabel = 'total') {
  if (!series || series.length === 0) return '';
  const T = series.length;
  const max = series.reduce((m, v) => v > m ? v : m, 1);
  const sum = series.reduce((s, v) => s + v, 0);
  let i0 = 0, i1 = T - 1;
  while (i0 < i1 && series[i0] === 0) i0++;
  while (i1 > i0 && series[i1] === 0) i1--;
  const from = labels[i0] || '', to = labels[i1] || '';
  let peakIdx = i0;
  for (let i = i0; i <= i1; i++) if (series[i] > series[peakIdx]) peakIdx = i;
  const peakLabel = labels[peakIdx] || '';
  const W = 260, H = 36, pad = 2;
  const span = Math.max(1, i1 - i0);
  const stepX = (W - pad * 2) / span;
  const innerH = H - pad * 2;
  const pts = [];
  for (let i = i0; i <= i1; i++) {
    const x = pad + (i - i0) * stepX;
    const y = pad + innerH - (series[i] / max) * innerH;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const areaPts = `${pad},${H - pad} ${pts.join(' ')} ${(pad + span * stepX).toFixed(1)},${H - pad}`;
  const peakX = pad + (peakIdx - i0) * stepX;
  const peakY = pad + innerH - (series[peakIdx] / max) * innerH;
  // Encode series+labels via data-attrs so one delegated mousemove handler
  // can decode and show a per-month readout. Keeps DOM flat (one SVG, no
  // per-point circles or rects).
  const seriesStr = series.slice(i0, i1 + 1).join(',');
  const labelsStr = labels.slice(i0, i1 + 1).join('|');
  return `
    <div class="pc2-spark" data-i0="${i0}" data-i1="${i1}" data-w="${W}" data-h="${H}" data-pad="${pad}" data-max="${max}" data-series="${seriesStr}" data-labels="${escapeHtml(labelsStr)}" data-color="${color}">
      <div class="pc2-spark-head">
        <span class="pc2-spark-eyebrow">monthly volume</span>
        <span class="pc2-spark-range pc2-spark-range-default">${escapeHtml(from)} → ${escapeHtml(to)}</span>
      </div>
      <svg class="pc2-spark-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <rect class="pc2-spark-filter-band" x="0" y="${pad}" width="0" height="${innerH}" fill="${color}" opacity="0" pointer-events="none"/>
        <polygon points="${areaPts}" fill="${color}" opacity="0.18"/>
        <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.3"/>
        <circle cx="${peakX.toFixed(1)}" cy="${peakY.toFixed(1)}" r="2.4" fill="${color}"/>
        <line class="pc2-spark-cursor" x1="0" y1="${pad}" x2="0" y2="${H - pad}" stroke="${color}" stroke-width="1" stroke-opacity="0" stroke-dasharray="2 2"/>
        <circle class="pc2-spark-dot" cx="0" cy="0" r="3" fill="${color}" opacity="0"/>
      </svg>
      <div class="pc2-spark-foot">
        <span class="pc2-spark-default">Peak <button class="pc2-spark-peak-btn" data-peak="${peakIdx}" title="Zoom timeline to a window around this peak">${escapeHtml(peakLabel)}</button> · ${sum.toLocaleString()} ${escapeHtml(totalLabel)}</span>
        <span class="pc2-spark-live"></span>
      </div>
    </div>
  `;
}

// Delegated hover: move across any .pc2-spark-svg shows the exact
// month/count at the cursor position. Attached once at boot.
function _initSparklineHover() {
  document.body.addEventListener('mousemove', (e) => {
    const svg = e.target.closest('.pc2-spark-svg');
    if (!svg) return;
    const spark = svg.closest('.pc2-spark');
    if (!spark) return;
    const rect = svg.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / Math.max(1, rect.width);
    const series = (spark.dataset.series || '').split(',').map(Number);
    const labels = (spark.dataset.labels || '').split('|');
    const W = +spark.dataset.w, pad = +spark.dataset.pad, maxV = +spark.dataset.max;
    const H = +spark.dataset.h;
    const innerH = H - pad * 2;
    const n = series.length;
    const idx = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
    const span = Math.max(1, n - 1);
    const stepX = (W - pad * 2) / span;
    const xVB = pad + idx * stepX;
    const yVB = pad + innerH - (series[idx] / maxV) * innerH;
    const cursor = svg.querySelector('.pc2-spark-cursor');
    const dot = svg.querySelector('.pc2-spark-dot');
    if (cursor) { cursor.setAttribute('x1', xVB); cursor.setAttribute('x2', xVB); cursor.setAttribute('stroke-opacity', '0.55'); }
    if (dot) { dot.setAttribute('cx', xVB); dot.setAttribute('cy', yVB); dot.setAttribute('opacity', '0.95'); }
    const live = spark.querySelector('.pc2-spark-live');
    const def = spark.querySelector('.pc2-spark-default');
    const rng = spark.querySelector('.pc2-spark-range-default');
    if (live) live.innerHTML = `<b>${escapeHtml(labels[idx])}</b> · ${series[idx].toLocaleString()} posts`;
    if (def) def.style.display = 'none';
    if (rng) rng.style.opacity = '0.35';
  });
  document.body.addEventListener('mouseout', (e) => {
    const svg = e.target.closest ? e.target.closest('.pc2-spark-svg') : null;
    if (!svg) return;
    const spark = svg.closest('.pc2-spark');
    if (!spark) return;
    const cursor = svg.querySelector('.pc2-spark-cursor');
    const dot = svg.querySelector('.pc2-spark-dot');
    if (cursor) cursor.setAttribute('stroke-opacity', '0');
    if (dot) dot.setAttribute('opacity', '0');
    const live = spark.querySelector('.pc2-spark-live');
    const def = spark.querySelector('.pc2-spark-default');
    const rng = spark.querySelector('.pc2-spark-range-default');
    if (live) live.innerHTML = '';
    if (def) def.style.display = '';
    if (rng) rng.style.opacity = '';
  });
}
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initSparklineHover);
  } else {
    _initSparklineHover();
  }

  // Delegated click on sparkline elements: the "Peak MMMM" button + any
  // point on the sparkline itself both snap the timeline to a 12-month
  // window centered on the clicked month. Serendipity → era-zoom.
  const _applyPeakZoom = (fullIdx) => {
    const totalMonths = window.App?.state?.monthLabels?.length;
    if (!totalMonths || !Number.isFinite(fullIdx)) return;
    const lo = Math.max(0, fullIdx - 6);
    const hi = Math.min(totalMonths - 1, fullIdx + 5);
    const scrubber = document.getElementById('timeline-scrubber');
    if (scrubber && scrubber.classList.contains('hidden')) {
      document.getElementById('tl-toggle')?.click();
    }
    if (window._tlApplyHashRange) window._tlApplyHashRange(lo, hi);
    else if (window.App?.globe?.setMonthRange) window.App.globe.setMonthRange({ lo, hi });
  };
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.pc2-spark-peak-btn');
    if (btn) {
      _applyPeakZoom(+btn.dataset.peak);
      e.stopPropagation();
      return;
    }
    // Click anywhere on the sparkline SVG → zoom to that month. Reuses
    // the same x→idx math as the hover readout for consistency.
    const svg = e.target.closest?.('.pc2-spark-svg');
    if (svg) {
      const spark = svg.closest('.pc2-spark');
      if (!spark) return;
      const rect = svg.getBoundingClientRect();
      const frac = (e.clientX - rect.left) / Math.max(1, rect.width);
      const seriesArr = (spark.dataset.series || '').split(',');
      const n = seriesArr.length;
      const idxInSlice = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
      const i0 = +spark.dataset.i0 || 0;
      _applyPeakZoom(i0 + idxInSlice);
      e.stopPropagation();
    }
  });
}
function renderSubSparkline(gid, color) {
  const hist = window.App?.state?.timeHist;
  const html = renderSparklineBySeries(hist?.by_sub_gid?.[String(gid)], hist?.labels || [], color, 'in sub');
  // Re-apply any active timeline range after this re-renders.
  _scheduleBandUpdate();
  return html;
}
// Position-level sparkline — shows the stance's own temporal curve
// rather than its parent sub's. Falls back to sub sparkline if the
// per-position bake hasn't been run.
function renderPositionSparkline(gid, posIdx, color) {
  const ph = window.App?.state?.positionTimeHist;
  const key = `${gid}:${posIdx}`;
  const series = ph?.by_position?.[key];
  if (!series || !series.length) return renderSubSparkline(gid, color);
  const html = renderSparklineBySeries(series, ph.labels || [], color, 'in point of view');
  _scheduleBandUpdate();
  return html;
}
function renderClusterSparkline(cl, color) {
  const hist = window.App?.state?.timeHist;
  const html = renderSparklineBySeries(hist?.by_cluster?.[String(cl)], hist?.labels || [], color, 'in topic');
  _scheduleBandUpdate();
  return html;
}
function _scheduleBandUpdate() {
  // Ask the timeline scrubber for its current lo/hi (or full range) —
  // stored globally on window so decoupled modules can reach it.
  if (typeof window._tlApplyBands === 'function') {
    requestAnimationFrame(() => window._tlApplyBands());
  }
}

// Trend score: ratio of recent-window mean to all-time mean, normalized
// by corpus growth so "trending" means "growing faster than the overall
// conversation," not "happens to have more recent data." Small baseline
// floor prevents tiny historical counts from blowing up the ratio.
function computeTrend(series, windowMonths = 6) {
  if (!series || series.length < windowMonths * 2) return null;
  const n = series.length;
  const recentSum = series.slice(n - windowMonths).reduce((s, v) => s + v, 0);
  const historicalSum = series.slice(0, n - windowMonths).reduce((s, v) => s + v, 0);
  const recent = recentSum / windowMonths;
  const baseline = historicalSum / (n - windowMonths);
  const ratio = recent / Math.max(0.8, baseline);
  const rel = ratio / (window.App?._corpusRatio || 1);
  return { ratio, rel, recent, baseline };
}
function renderTrendBadge(series) {
  const t = computeTrend(series);
  if (!t) return '';
  const corpus = (window.App?._corpusRatio || 1).toFixed(2);
  const fmt = (n) => n.toFixed(n < 10 ? 1 : 0);
  if (t.rel >= 1.80) return `<span class="trend-badge surging" title="${fmt(t.ratio)}× historical avg — ${t.rel.toFixed(1)}× the corpus's own ${corpus}× growth">▲ surging</span>`;
  if (t.rel >= 1.35) return `<span class="trend-badge trending" title="${fmt(t.ratio)}× historical avg — ${t.rel.toFixed(1)}× the corpus's own ${corpus}× growth">▲ trending</span>`;
  if (t.rel <= 0.65) return `<span class="trend-badge fading" title="${fmt(t.ratio)}× historical avg — ${t.rel.toFixed(1)}× the corpus's own ${corpus}× growth">▼ fading</span>`;
  return '';
}
function getSubSeries(gid) {
  return window.App?.state?.timeHist?.by_sub_gid?.[String(gid)];
}
function getClusterSeries(cl) {
  return window.App?.state?.timeHist?.by_cluster?.[String(cl)];
}
function getPositionSeries(gid, posIdx) {
  return window.App?.state?.positionTimeHist?.by_position?.[`${gid}:${posIdx}`];
}

// Relative trend — ratio of recent/base normalized by corpus growth.
// Returns { ratio, rel, dir } where dir is 'up' | 'down' | ''.
// Every callsite should use this; raw ratios drift with corpus growth.
function getTrendInfo(series) {
  if (!series || series.length < 12) return { ratio: 1, rel: 1, dir: '' };
  const n = series.length;
  const rc = series.slice(n - 6).reduce((a, v) => a + v, 0) / 6;
  const bs = series.slice(0, n - 6).reduce((a, v) => a + v, 0) / (n - 6);
  const ratio = rc / Math.max(0.8, bs);
  const rel = ratio / (window.App?._corpusRatio || 1);
  const dir = rel >= 1.35 ? 'up' : rel <= 0.65 ? 'down' : '';
  return { ratio, rel, dir };
}

// Per-position subreddit breakdown. Answers "who voiced THIS specific stance?"
// which the focus-card's sub-level bar can't — a single sub often mixes voices
// from several subreddits with different ideological leans. Backed by the
// pre-baked App._posSubTable so sibling/resonant chips can all hit it cheaply.
const _posSubCache = new Map();
function getPositionSubredditCounts(gid, posIdx) {
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
function getPositionDominantSub(gid, posIdx) {
  const arr = getPositionSubredditCounts(gid, posIdx);
  if (!arr || arr.length === 0) return null;
  const total = arr.reduce((s, e) => s + e.n, 0);
  if (total < 5) return null;
  return { ...arr[0], pct: arr[0].n / total, total };
}

// Inverse lookup: for a given subreddit, which positions represent THAT
// community's loudest voices? Answers "what do they actually talk about?"
//
// Ranks by specialization, not just raw share: a position is a 90% r/X
// voice *in a sub that's only 50% r/X overall* is more of an "agenda"
// signal than a position that's 90% r/X in a sub that's already 90% r/X
// (the latter says nothing about the stance — the whole topic is just
// r/X-only). We skip monolithic subs entirely (sub_top_share > 0.95)
// and bonus-score positions whose share *exceeds* their parent sub's
// baseline share of this subreddit.
// Range-aware variant of getTopStancesForSubreddit. Scans the 422k-point
// space once with a month filter, bucketing (gid, posIdx) → {sr count,
// total}. Heavier than the cached all-time version (~10ms) but only runs
// on filter/range changes.
function getTopStancesForSubredditInRange(srId, range, limit = 8) {
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

function getTopStancesForSubreddit(srId, limit = 8) {
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
    // Sub-level baseline for this subreddit, to detect monolithic subs
    // and to compute specialization (how much this position over/under
    // indexes vs. the sub average).
    const subBreakdown = subData?.[String(gid)] || [];
    const subTotal = subBreakdown.reduce((s, e) => s + e.n, 0) || 0;
    const subTop = subTotal ? (subBreakdown[0]?.n || 0) / subTotal : 0;
    if (subTop > 0.95) continue;   // sub is effectively r/X-only, no signal
    const subEntry = subBreakdown.find(e => e.r === targetName);
    const subBaseShare = subEntry && subTotal ? subEntry.n / subTotal : 0;
    const specialization = subBaseShare > 0.01 ? share / subBaseShare : share / 0.05;
    // Require either dominant voice OR meaningful specialization.
    if (share < 0.5 && specialization < 1.25) continue;
    // Composite: share × log(count) × specialization bonus. The specialization
    // term gently prefers positions that stand out from their sub baseline.
    const score = share * Math.log(1 + nHere) * (0.6 + 0.4 * Math.min(2, specialization));
    out.push({ gid, posIdx, cl: doc.cl, sub_name: doc.sub_name,
               pos_name: pos.name, description: pos.description || '',
               count: nHere, total, share, specialization, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

function renderPositionSubreddits(gid, posIdx, color) {
  const arr = getPositionSubredditCounts(gid, posIdx);
  if (!arr || arr.length === 0) return '';
  const total = arr.reduce((s, e) => s + e.n, 0);
  if (total < 5) return '';
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Stacked segmented bar — same color, stepped opacity by rank. Keeps the
  // visual tied to the position's identity while still showing dominance.
  const top5 = arr.slice(0, 5);
  const otherN = arr.slice(5).reduce((s, e) => s + e.n, 0);
  const segs = top5.map((e, i) => {
    const op = 1 - i * 0.13;
    const pct = (100 * e.n / total).toFixed(1);
    return `<span class="pc2-sr-seg" title="r/${esc(e.name)} — ${e.n.toLocaleString()} (${pct}%)"
             style="flex:${e.n}; background:${color}; opacity:${op}"></span>`;
  }).join('');
  const otherSeg = otherN > 0
    ? `<span class="pc2-sr-seg pc2-sr-other"
         title="${arr.length - 5} other subreddits — ${otherN.toLocaleString()} (${(100*otherN/total).toFixed(1)}%)"
         style="flex:${otherN}"></span>`
    : '';
  // Labels for top 3 only — the bar carries the rest visually.
  const labels = top5.slice(0, 3).map(e => `
    <button class="pc2-sr-lbl" data-sr-id="${e.id}" data-sr-name="${esc(e.name)}"
            title="${e.n.toLocaleString()} posts · click to filter globe to r/${esc(e.name)}">
      <span class="pc2-sr-name">r/${esc(e.name)}</span>
      <span class="pc2-sr-pct">${Math.round(100 * e.n / total)}%</span>
    </button>
  `).join('');
  const subCount = arr.length > 5 ? ` <span class="pc2-sr-more">+${arr.length - 5} more</span>` : '';
  return `
    <div class="pc2-sr-section">
      <div class="pc2-kw-label">who voiced this point of view${subCount}</div>
      <div class="pc2-sr-bar">${segs}${otherSeg}</div>
      <div class="pc2-sr-labels">${labels}</div>
    </div>
  `;
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

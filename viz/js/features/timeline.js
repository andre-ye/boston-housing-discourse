// timeline — month-range scrubber + 12-month rolling-window play.

import { escapeHtml } from './html-utils.js';
import { updateSparklineBands } from './sparklines.js';

export function init(ctx) {
  const { App, globe, storage, store, refreshOnRange, writeHash } = ctx;
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
    // Prefer the globe's per-month bucket of points that pass every active
    // non-month filter (drill, spotlight, regex paint, subreddit). Falls
    // back to the pre-baked total[] histogram when no such filter is on,
    // so the whole-corpus path is unchanged.
    const filtered = globe?.getFilteredMonthCount?.(lo, hi);
    if (filtered != null) return filtered;
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
      const [y, m] = iso.split('-');
      const mName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1] || m;
      return `${mName} ${y}`;
    };
    let n = globe?.getFilteredMonthCount?.(lo, hi);
    if (n == null) {
      n = 0;
      for (let i = lo; i <= hi; i++) n += total[i] || 0;
    }
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
    updateSparklineBands(lo, hi, N - 1);
    refreshOnRange?.();
    if (typeof writeHash === 'function') writeHash();
  }
  window._tlApplyBands = () => updateSparklineBands(lo, hi, N - 1);

  // When the globe's non-month filters change (drill, spotlight, regex
  // paint, subreddit), the per-month bucket the label sums over also
  // changes — refresh the title without waiting for a scrub.
  if (globe && typeof globe.addEventListener === 'function') {
    globe.addEventListener('filterschanged', () => {
      updateLabel();
      _updateTimelineChip();
    });
  }

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
  const EDGE_PX = 7;
  let dragMode = null, dragPinned = null;
  let dragBodyAnchor = null, dragBodyWidth = 0, dragPreLo = 0, dragPreHi = 0;
  function idxFromEvent(e) {
    const rect = svg.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(N - 1, Math.round(frac * (N - 1))));
  }
  function pxPerIdx() {
    const rect = svg.getBoundingClientRect();
    return rect.width / Math.max(1, N - 1);
  }
  function isRangeActive() { return !(lo === 0 && hi === N - 1); }
  function nearEdge(i, edge) {
    return Math.abs(i - edge) * pxPerIdx() <= EDGE_PX;
  }
  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    const i = idxFromEvent(e);
    dragPreLo = lo; dragPreHi = hi;
    const onLo = isRangeActive() && nearEdge(i, lo);
    const onHi = isRangeActive() && nearEdge(i, hi);
    if (onLo && onHi) {
      // Tie-break by closer edge when the interval is narrow enough that both pad-zones overlap.
      if (Math.abs(i - lo) <= Math.abs(i - hi)) { dragMode = 'edge-lo'; dragPinned = hi; }
      else { dragMode = 'edge-hi'; dragPinned = lo; }
    } else if (onLo) {
      dragMode = 'edge-lo'; dragPinned = hi;
    } else if (onHi) {
      dragMode = 'edge-hi'; dragPinned = lo;
    } else if (isRangeActive() && i > lo && i < hi) {
      dragMode = 'body';
      dragBodyAnchor = i;
      dragBodyWidth = hi - lo;
      svg.style.cursor = 'grabbing';
    } else {
      dragMode = 'new'; dragPinned = i;
      lo = hi = i;
      applyFilter();
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragMode) return;
    const i = idxFromEvent(e);
    if (dragMode === 'edge-lo' || dragMode === 'edge-hi') {
      lo = Math.min(i, dragPinned);
      hi = Math.max(i, dragPinned);
    } else if (dragMode === 'body') {
      // Translate the window by (i - anchor), clamping to endpoints without compressing width.
      const delta = i - dragBodyAnchor;
      let newLo = dragPreLo + delta;
      let newHi = dragPreHi + delta;
      if (newLo < 0) { newHi -= newLo; newLo = 0; }
      if (newHi > N - 1) { newLo -= (newHi - (N - 1)); newHi = N - 1; }
      newLo = Math.max(0, newLo);
      newHi = Math.min(N - 1, newLo + dragBodyWidth);
      lo = newLo; hi = newHi;
    } else {
      lo = Math.min(dragPinned, i);
      hi = Math.max(dragPinned, i);
    }
    applyFilter();
  });
  svg.addEventListener('pointerup', (e) => {
    const wasBody = dragMode === 'body';
    dragMode = null;
    if (wasBody) {
      const i = idxFromEvent(e);
      svg.style.cursor = (isRangeActive() && (nearEdge(i, lo) || nearEdge(i, hi))) ? 'ew-resize' : 'grab';
    }
  });
  svg.addEventListener('pointercancel', () => {
    if (dragMode) {
      lo = dragPreLo; hi = dragPreHi;
      applyFilter();
    }
    dragMode = null;
    svg.style.cursor = '';
  });
  const tlTooltip = document.getElementById('tl-tooltip');
  svg.addEventListener('pointermove', (e) => {
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
    if (nearEdge(i, lo) || nearEdge(i, hi)) svg.style.cursor = 'ew-resize';
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
    tl.classList.add('hidden');
    toggle.classList.remove('active');
    syncTimelineBodyClass();
    {
      const p = storage.getJSON('pref', {}) || {};
      p.timeline = 'off';
      storage.setJSON('pref', p);
    }
  };
  App._timelineClear = () => { lo = 0; hi = N - 1; applyFilter(); };
  App._timelineResetAndClose = () => {
    lo = 0; hi = N - 1;
    applyFilter();
    tl.classList.add('hidden');
    toggle.classList.remove('active');
    syncTimelineBodyClass();
    {
      const p = storage.getJSON('pref', {}) || {};
      p.timeline = 'off';
      storage.setJSON('pref', p);
    }
  };
  // Publish the scrubber's live rendered height to a CSS variable so any
  // surface that needs to sit above it (today: the tour modal) can use a
  // calc() against the actual height rather than a hand-tuned constant
  // that drifts whenever the scrubber's bar count or padding changes.
  // Variable is 0px while hidden so non-tour states get no lift.
  const updateTimelineHVar = () => {
    const open = !tl.classList.contains('hidden');
    const h = open ? Math.ceil(tl.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty('--timeline-h', `${h}px`);
  };
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => updateTimelineHVar());
    ro.observe(tl);
  }
  const syncTimelineBodyClass = () => {
    document.body.classList.toggle('has-timeline-open', !tl.classList.contains('hidden'));
    updateTimelineHVar();
  };
  toggle.onclick = () => {
    const wasHidden = tl.classList.contains('hidden');
    tl.classList.toggle('hidden');
    toggle.classList.toggle('active', !tl.classList.contains('hidden'));
    syncTimelineBodyClass();
    if (wasHidden) {
      setTimeout(() => { buildBg(); paintRange(); }, 30);
    }
    {
      const p = storage.getJSON('pref', {}) || {};
      p.timeline = tl.classList.contains('hidden') ? 'off' : 'on';
      storage.setJSON('pref', p);
    }
  };
  const tryRestore = () => {
    const p = storage.getJSON('pref', {}) || {};
    if (p.timeline !== 'on') return;
    if (!tl.classList.contains('hidden')) return;
    if (document.body.classList.contains('tour-active')) return;
    toggle.click();
  };
  queueMicrotask(tryRestore);
  App._timelineRestore = tryRestore;
  syncTimelineBodyClass();
  updateLabel();
}

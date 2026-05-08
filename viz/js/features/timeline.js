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
    updateSparklineBands(lo, hi, N - 1);
    refreshOnRange?.();
    if (typeof writeHash === 'function') writeHash();
  }
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
      if (i - lo < hi - i) { dragMode = 'edge-lo'; dragPinned = hi; }
      else { dragMode = 'edge-hi'; dragPinned = lo; }
    } else if (isRangeActive() && Math.abs(i - lo) <= 2) {
      dragMode = 'edge-lo'; dragPinned = hi;
    } else if (isRangeActive() && Math.abs(i - hi) <= 2) {
      dragMode = 'edge-hi'; dragPinned = lo;
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
  const syncTimelineBodyClass = () => {
    document.body.classList.toggle('has-timeline-open', !tl.classList.contains('hidden'));
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

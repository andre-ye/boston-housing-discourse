// Sparklines: compact SVG monthly-volume charts shown on focus + position cards.
// Extracted from main.js Stage 6. All functions read App state via window.App
// (set during boot) and emit globe-relative actions via window._tlApplyHashRange
// + window.App.globe.

import { escapeHtml } from './html-utils.js';

// Paint a translucent band on every mini-sparkline indicating the
// globally-active month range filter. Called whenever the timeline
// scrubber changes, and also on each sparkline mount.
export function updateSparklineBands(lo, hi, maxIdx) {
  const active = !(lo === 0 && hi === maxIdx);
  for (const spark of document.querySelectorAll('.pc2-spark')) {
    const band = spark.querySelector('.pc2-spark-filter-band');
    if (!band) continue;
    if (!active) { band.setAttribute('opacity', '0'); continue; }
    const i0 = +spark.dataset.i0;
    const i1 = +spark.dataset.i1;
    const W = +spark.dataset.w;
    const pad = +spark.dataset.pad;
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

export function renderSparklineBySeries(series, labels, color, totalLabel = 'total') {
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

export function renderSubSparkline(gid, color) {
  const hist = window.App?.state?.timeHist;
  const html = renderSparklineBySeries(hist?.by_sub_gid?.[String(gid)], hist?.labels || [], color, 'in sub');
  _scheduleBandUpdate();
  return html;
}

export function renderClusterSparkline(cl, color) {
  const hist = window.App?.state?.timeHist;
  const html = renderSparklineBySeries(hist?.by_cluster?.[String(cl)], hist?.labels || [], color, 'in topic');
  _scheduleBandUpdate();
  return html;
}

function _scheduleBandUpdate() {
  if (typeof window._tlApplyBands === 'function') {
    requestAnimationFrame(() => window._tlApplyBands());
  }
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

// One-shot init that wires the body-delegated hover + click handlers.
// Idempotent — calling more than once just adds duplicate listeners,
// which the boot path avoids by gating on a flag.
let _sparklineHoverInited = false;
export function initSparklineHover() {
  if (_sparklineHoverInited) return;
  _sparklineHoverInited = true;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initSparklineHover);
  } else {
    _initSparklineHover();
  }
  // Delegated click on sparkline elements: peak button + any point on the
  // sparkline SVG snap the timeline to a 12-month window centered there.
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

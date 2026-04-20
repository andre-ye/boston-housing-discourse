// Stacked-bar navigation (L1 clusters → L2 subtopics → L3 positions)
// with Sankey-style ribbons connecting parent segments to their children.

import { clusterColor, shadeColor, summarizeClusters, summarizeSubs, buildSubGidMap } from './data.js';

const MIN_SEG_PX = 3;   // minimum visible pixel height per segment
const MIN_LABEL_PX = 16;
const GAP_PX = 1;       // gap between segments

export class NavController extends EventTarget {
  constructor(state) {
    super();
    this.state = state;
    this.subGidMap = buildSubGidMap(state.subMeta);
    this.level = 0;  // 0 = L1 only, 1 = L1+L2, 2 = L1+L2+L3
    this.focusCl = null;
    this.focusGid = null;
    this.focusPosIdx = null;
    this.positionsDoc = null;

    this.stackL1 = document.getElementById('stack-l1');
    this.stackL2 = document.getElementById('stack-l2');
    this.stackL3 = document.getElementById('stack-l3');
    this.colL2 = document.getElementById('col-l2');
    this.colL3 = document.getElementById('col-l3');
    this.ribbonOverlay = document.getElementById('ribbons-overlay');
    this.navBars = document.getElementById('nav-bars');
    this.breadcrumbs = document.getElementById('breadcrumbs');

    this.l1Data = summarizeClusters(state);
    this.renderL1();
    this.renderBreadcrumbs();

    window.addEventListener('resize', () => {
      this.renderL1();
      if (this.focusCl != null) this.renderL2(this.focusCl);
      if (this.focusGid != null) this.renderL3(this.focusGid);
      this.drawRibbons();
    });

    // Try to load LLM positions (optional)
    fetch('tsne_chunks/positions.json').then(r => r.ok ? r.json() : null).then(d => {
      if (d) this.positionsDoc = d.by_gid || d;
    }).catch(() => {});
  }

  renderBreadcrumbs() {
    const el = this.breadcrumbs;
    el.innerHTML = '';
    const all = document.createElement('div');
    all.className = 'crumb' + (this.focusCl == null ? ' active' : '');
    all.textContent = 'All clusters';
    all.onclick = () => this.focus({});
    el.appendChild(all);

    if (this.focusCl != null) {
      const sep1 = document.createElement('span'); sep1.className = 'sep'; sep1.textContent = '›';
      el.appendChild(sep1);
      const meta = this.state.clusterMeta[String(this.focusCl)];
      const c = document.createElement('div');
      c.className = 'crumb' + (this.focusGid == null ? ' active' : '');
      c.style.color = clusterColor(this.focusCl);
      c.textContent = meta ? meta.name : `Cluster ${this.focusCl}`;
      c.onclick = () => this.focus({ cl: this.focusCl });
      el.appendChild(c);
    }
    if (this.focusGid != null) {
      const sep2 = document.createElement('span'); sep2.className = 'sep'; sep2.textContent = '›';
      el.appendChild(sep2);
      const sub = this.subGidMap.byGid[this.focusGid];
      const s = document.createElement('div');
      s.className = 'crumb' + (this.focusPosIdx == null ? ' active' : '');
      s.textContent = sub ? sub.name : `Sub ${this.focusGid}`;
      s.onclick = () => this.focus({ cl: this.focusCl, gid: this.focusGid });
      el.appendChild(s);
    }
  }

  renderL1() {
    this._renderStack(this.stackL1, this.l1Data.list, (d) => ({
      key: d.cl,
      color: d.color,
      label: d.name,
      pct: d.pct,
      count: d.count,
      active: this.focusCl === d.cl,
      onClick: () => this.focus({ cl: d.cl }),
    }));
  }

  renderL2(cl) {
    const summ = summarizeSubs(this.state, cl, this.subGidMap);
    this._l2Summary = summ;
    this.colL2.classList.remove('collapsed');
    const base = clusterColor(cl);
    this._renderStack(this.stackL2, summ.list, (d, i, arr) => {
      // Shades of the cluster color by rank
      const factor = 1.3 - 0.6 * (i / Math.max(1, arr.length - 1));
      return {
        key: `${d.cl}_${d.sub}`,
        color: shadeColor(base, factor),
        label: d.name,
        pct: d.pct,
        count: d.count,
        active: this.focusGid === d.gid,
        onClick: () => this.focus({ cl: d.cl, gid: d.gid }),
      };
    }, { keepRibbon: true });
  }

  renderL3(gid) {
    const sub = this.subGidMap.byGid[gid];
    if (!sub) { this.colL3.classList.add('collapsed'); return; }
    const doc = this.positionsDoc && this.positionsDoc[String(gid)];
    if (!doc || !doc.positions || doc.positions.length === 0) {
      this.colL3.classList.add('collapsed');
      return;
    }
    this.colL3.classList.remove('collapsed');
    const items = doc.positions.map((p, i) => ({
      name: p.name, idx: i,
      count: (p.example_sample_indices || []).length,
    }));
    const total = items.reduce((s, d) => s + Math.max(1, d.count), 0);
    for (const d of items) d.pct = Math.max(1, d.count) / total;
    items.sort((a,b) => b.count - a.count);
    const base = clusterColor(sub.cl);
    this._l3Items = items;
    this._renderStack(this.stackL3, items, (d, i, arr) => {
      const factor = 1.5 - 0.7 * (i / Math.max(1, arr.length - 1));
      return {
        key: `${gid}_${d.idx}`,
        color: shadeColor(base, factor),
        label: d.name,
        pct: d.pct,
        count: d.count,
        active: this.focusPosIdx === d.idx,
        onClick: () => this.focus({ cl: sub.cl, gid, posIdx: d.idx }),
      };
    }, { keepRibbon: true });
  }

  _renderStack(stackEl, data, mapper, opts = {}) {
    stackEl.innerHTML = '';
    if (!data || data.length === 0) return;
    const rect = stackEl.getBoundingClientRect();
    const h = rect.height;
    if (h === 0) return;
    const n = data.length;
    const minTotal = n * MIN_SEG_PX + (n - 1) * GAP_PX;
    const sumPct = data.reduce((s, d) => s + d.pct, 0) || 1;
    const scale = h - minTotal;
    let y = 0;
    data._layout = [];
    for (let i = 0; i < n; i++) {
      const d = data[i];
      const span = MIN_SEG_PX + (d.pct / sumPct) * scale;
      const info = mapper(d, i, data);
      const seg = document.createElement('div');
      seg.className = 'bar-seg' + (info.active ? ' active' : '');
      seg.style.top = `${y}px`;
      seg.style.height = `${span}px`;
      seg.onclick = info.onClick;
      seg.dataset.key = info.key;

      const bg = document.createElement('div');
      bg.className = 'bg';
      bg.style.background = info.color;
      seg.appendChild(bg);

      if (span >= MIN_LABEL_PX) {
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = info.label;
        seg.appendChild(label);
        const pct = document.createElement('div');
        pct.className = 'pct';
        pct.textContent = info.pct >= 0.01 ? `${Math.round(info.pct*100)}%` : `${Math.round(info.pct*1000)/10}%`;
        seg.appendChild(pct);
      }
      stackEl.appendChild(seg);

      data._layout.push({ y, span, key: info.key, color: info.color, data: d });
      y += span + GAP_PX;
    }
  }

  focus({ cl = null, gid = null, posIdx = null } = {}) {
    this.focusCl = cl;
    this.focusGid = gid;
    this.focusPosIdx = posIdx;
    this.renderL1();
    if (cl != null) {
      this.renderL2(cl);
      if (gid != null) {
        this.renderL3(gid);
      } else {
        this.colL3.classList.add('collapsed');
      }
    } else {
      this.colL2.classList.add('collapsed');
      this.colL3.classList.add('collapsed');
    }
    this._applyFade();
    this.renderBreadcrumbs();
    requestAnimationFrame(() => this.drawRibbons());
    this.dispatchEvent(new CustomEvent('focus', { detail: { cl, gid, posIdx } }));
  }

  _applyFade() {
    for (const seg of this.stackL1.querySelectorAll('.bar-seg')) {
      const key = +seg.dataset.key;
      seg.classList.toggle('faded', this.focusCl != null && key !== this.focusCl);
    }
    for (const seg of this.stackL2.querySelectorAll('.bar-seg')) {
      seg.classList.toggle('faded',
        this.focusGid != null && this.subGidMap.byGid[this.focusGid] &&
        seg.dataset.key !== `${this.subGidMap.byGid[this.focusGid].cl}_${this.subGidMap.byGid[this.focusGid].sub}`);
    }
  }

  drawRibbons() {
    const svg = this.ribbonOverlay;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const navRect = this.navBars.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${navRect.width} ${navRect.height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.appendChild(defs);

    const drawPair = (srcStack, dstStack, srcKey) => {
      const srcSeg = Array.from(srcStack.children).find(c => c.dataset && c.dataset.key === String(srcKey));
      if (!srcSeg) return;
      const srcRect = srcSeg.getBoundingClientRect();
      const dstRect = dstStack.getBoundingClientRect();
      const dstSegs = Array.from(dstStack.children);

      const x0 = srcRect.right - navRect.left;
      const x1 = dstRect.left - navRect.left;
      const midX = (x0 + x1) / 2;
      const y0a = srcRect.top - navRect.top;
      const y0b = srcRect.bottom - navRect.top;
      const srcColor = srcSeg.querySelector('.bg')?.style.background || '#888';

      // Apportion src vertical extent across dst segments by their pct.
      const dstSpans = dstSegs.map(d => parseFloat(d.style.height) || 0);
      const totalDst = dstSpans.reduce((s, v) => s + v, 0) || 1;
      let srcCursor = y0a;
      const srcSpan = (y0b - y0a);

      dstSegs.forEach((dstSeg, i) => {
        const sliceH = (dstSpans[i] / totalDst) * srcSpan;
        const a = srcCursor;
        const b = srcCursor + sliceH;
        srcCursor = b;
        const dstTop = (parseFloat(dstSeg.style.top) || 0) + (dstRect.top - navRect.top - (parseFloat(dstStack.parentElement.querySelector('.bar-stack').getBoundingClientRect().top))); /* ignore */
        // simpler: read dst seg rect directly
        const drect = dstSeg.getBoundingClientRect();
        const y1a = drect.top - navRect.top;
        const y1b = drect.bottom - navRect.top;
        const dstColor = dstSeg.querySelector('.bg')?.style.background || '#888';

        const gradId = `grad-${Math.random().toString(36).slice(2,9)}`;
        const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
        grad.setAttribute('id', gradId);
        grad.setAttribute('x1', '0'); grad.setAttribute('x2', '1');
        grad.setAttribute('y1', '0'); grad.setAttribute('y2', '0');
        const s0 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        s0.setAttribute('offset', '0'); s0.setAttribute('stop-color', srcColor);
        const s1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        s1.setAttribute('offset', '1'); s1.setAttribute('stop-color', dstColor);
        grad.appendChild(s0); grad.appendChild(s1);
        defs.appendChild(grad);

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', [
          `M ${x0} ${a}`,
          `C ${midX} ${a}, ${midX} ${y1a}, ${x1} ${y1a}`,
          `L ${x1} ${y1b}`,
          `C ${midX} ${y1b}, ${midX} ${b}, ${x0} ${b}`,
          'Z',
        ].join(' '));
        path.setAttribute('fill', `url(#${gradId})`);
        path.setAttribute('opacity', '0.8');
        svg.appendChild(path);
      });
    };

    if (this.focusCl != null) {
      drawPair(this.stackL1, this.stackL2, this.focusCl);
    }
    if (this.focusGid != null) {
      const sub = this.subGidMap.byGid[this.focusGid];
      if (sub) drawPair(this.stackL2, this.stackL3, `${sub.cl}_${sub.sub}`);
    }
  }
}

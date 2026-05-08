// Stacked-bar navigation (L1 clusters → L2 subtopics → L3 points of view)
// with Sankey-style ribbons connecting parent segments to their children.

import { clusterColor, shadeColor, summarizeClusters, summarizeSubs, buildSubGidMap } from './data.js?v=234';
import { storage } from './core/storage.js';
import { keys } from './core/keys.js?v=1';
import { overlayManager } from './core/overlays.js';
import { store } from './core/store.js';

// Each segment must be tall enough for a 2-line label. We use a readable
// floor (30px) rather than the old 3px — the bar grows vertically and
// scrolls when it exceeds the container. This trades a bit of "glanceable
// proportion" for actually-readable cluster names.
const MIN_SEG_PX = 30;
const MIN_LABEL_PX = 14;
const GAP_PX = 1;       // gap between segments
const PROPORTIONAL_BONUS_PX = 34;   // extra height large clusters get

// Largest-remainder rounding so the percentages we paint on a stack add
// up to exactly 100%. Without this the display can round to 99% or 101%
// (e.g. four 12.5% siblings rounding to 13/13/12/12 → display 13/13/12/12).
//
// Returns an array of display strings ("13%" or "0.5%") aligned with `pcts`.
// Inputs < 0.01 (under 1%) keep the existing one-decimal format and don't
// participate in the largest-remainder distribution — they read as
// "essentially nothing" anyway, so quantizing them to whole percents would
// flatten visible structure for no gain.
function formatPctsLargestRemainder(pcts) {
  const out = new Array(pcts.length);
  if (!pcts.length) return out;
  // Two pools: small (sub-1%) and main (>= 1%). Small ones get formatted
  // independently; main ones share the integer-percent budget.
  const mainIdx = [];
  let smallSum = 0;
  for (let i = 0; i < pcts.length; i++) {
    const p = pcts[i] == null ? 0 : pcts[i];
    if (p >= 0.01) mainIdx.push(i);
    else { smallSum += p; out[i] = `${Math.round(p * 1000) / 10}%`; }
  }
  if (mainIdx.length === 0) return out;
  // Target budget: 100% minus what the small pool already consumed
  // (rounded the same way it was displayed). Floor everyone, then hand
  // out the remainder to the largest-remainder candidates first.
  const reserved = Math.round(smallSum * 100);
  const budget = Math.max(0, 100 - reserved);
  const scaled = mainIdx.map(i => pcts[i] * 100);
  const floors = scaled.map(v => Math.floor(v));
  let used = floors.reduce((a, b) => a + b, 0);
  let remainderToHandOut = Math.max(0, budget - used);
  // Pair (mainIdx position, fractional remainder) sorted desc by remainder.
  const order = scaled
    .map((v, k) => ({ k, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const finals = floors.slice();
  for (let n = 0; n < order.length && remainderToHandOut > 0; n++) {
    finals[order[n].k] += 1;
    remainderToHandOut -= 1;
  }
  for (let n = 0; n < mainIdx.length; n++) {
    out[mainIdx[n]] = `${finals[n]}%`;
  }
  return out;
}

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
    this.colL1 = document.getElementById('col-l1');
    this.colL2 = document.getElementById('col-l2');
    this.colL3 = document.getElementById('col-l3');

    // Any click inside a narrow (collapsed) column pops focus back up to
    // that column's level. Runs in the CAPTURE phase so it beats any
    // per-segment click handler that would otherwise drill down.
    const attachPopUp = (col, popFn) => {
      if (!col) return;
      col.addEventListener('click', (e) => {
        if (!col.classList.contains('narrow')) return;
        e.stopPropagation();
        e.preventDefault();
        popFn();
      }, true);
    };
    attachPopUp(this.colL1, () => this.focus({}));
    attachPopUp(this.colL2, () => this.focus({ cl: this.focusCl }));
    attachPopUp(this.colL3, () => this.focus({ cl: this.focusCl, gid: this.focusGid }));
    this.ribbonOverlay = document.getElementById('ribbons-overlay');
    this.navBars = document.getElementById('nav-bars');
    this.breadcrumbs = document.getElementById('breadcrumbs');

    this._ribbonRedrawUntil = 0;
    this._ribbonRedrawPending = false;
    const scheduleRibbonRedraw = (ms = 420) => {
      this._ribbonRedrawUntil = performance.now() + ms;
      if (this._ribbonRedrawPending) return;
      this._ribbonRedrawPending = true;
      const tick = () => {
        this.drawRibbons();
        if (performance.now() < this._ribbonRedrawUntil) {
          requestAnimationFrame(tick);
        } else {
          this._ribbonRedrawPending = false;
        }
      };
      requestAnimationFrame(tick);
    };
    // Explicit hover-open with hysteresis. Mouse-drifts on the edge of a
    // 22px narrow strip used to bounce the layout (via :has() + :hover
    // both snapping). Now:
    //   • mouseenter on .narrow → open immediately
    //   • mouseleave on #nav-bars → queue close for 180ms; quick re-enter
    //     cancels. Only one column open at a time.
    const navEl = document.getElementById('nav');
    this._hoverCloseTimer = null;
    const openCol = (col) => {
      if (!col || !col.classList.contains('narrow')) return;
      if (this._hoverCloseTimer) { clearTimeout(this._hoverCloseTimer); this._hoverCloseTimer = null; }
      for (const c of document.querySelectorAll('.bar-column.narrow.open')) {
        if (c !== col) c.classList.remove('open');
      }
      if (!col.classList.contains('open')) {
        col.classList.add('open');
        navEl.classList.add('nav-narrow-open');
        scheduleRibbonRedraw();
      }
    };
    const queueClose = () => {
      if (this._hoverCloseTimer) return;
      this._hoverCloseTimer = setTimeout(() => {
        for (const c of document.querySelectorAll('.bar-column.narrow.open')) c.classList.remove('open');
        navEl.classList.remove('nav-narrow-open');
        scheduleRibbonRedraw();
        this._hoverCloseTimer = null;
      }, 180);
    };
    this.navBars.addEventListener('mouseover', (e) => {
      const col = e.target.closest?.('.bar-column.narrow');
      if (col) openCol(col);
    });
    this.navBars.addEventListener('mouseleave', () => queueClose());

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

    this._initSearch();
    this._initGlobalShortcuts();
    this._maybeShowIntroToast();
  }

  _populateHelpClusters() {
    const grid = document.getElementById('help-cluster-grid');
    if (!grid || grid.dataset.built === '1') return;
    // Sort clusters by count desc, matching the L1 bar order.
    const items = (this.l1Data?.list || []).slice();
    items.sort((a, b) => (b.count || 0) - (a.count || 0));
    // Attach per-cluster trend ratio (last-6-months vs. historical mean)
    // so chips can flag ▲ surging / trending / ▼ fading at a glance.
    const hist = this.state?.timeHist;
    const trendOf = (cl) => {
      const s = hist?.by_cluster?.[String(cl)];
      if (!s || s.length < 12) return null;
      const n = s.length;
      const recent = s.slice(n - 6).reduce((a, v) => a + v, 0) / 6;
      const base = s.slice(0, n - 6).reduce((a, v) => a + v, 0) / (n - 6);
      return recent / Math.max(0.8, base);
    };
    const frag = document.createDocumentFragment();
    for (const d of items) {
      const chip = document.createElement('button');
      chip.className = 'help-cluster-chip';
      const r = trendOf(d.cl);
      let trendHtml = '', trendClass = 'neutral';
      if (r != null) {
        if (r >= 2.4) { trendHtml = `<span class="help-chip-trend surging" title="Last 6 mo ${r.toFixed(1)}× historical">▲</span>`; trendClass = 'surging'; }
        else if (r >= 1.6) { trendHtml = `<span class="help-chip-trend trending" title="Last 6 mo ${r.toFixed(1)}× historical">▲</span>`; trendClass = 'trending'; }
        else if (r <= 0.40) { trendHtml = `<span class="help-chip-trend fading" title="Last 6 mo ${r.toFixed(2)}× historical">▼</span>`; trendClass = 'fading'; }
      }
      chip.dataset.trend = trendClass;
      chip.dataset.ratio = r != null ? r.toFixed(3) : '';
      chip.dataset.count = d.count || 0;
      chip.innerHTML = `
        <span class="help-cluster-swatch" style="background:${d.color}; color:${d.color}"></span>
        <span class="help-cluster-name">${this._escHtml(d.name)}</span>
        ${trendHtml}
        <span class="help-cluster-count">${(d.count || 0).toLocaleString()}</span>
      `;
      chip.onclick = () => {
        this.focus({ cl: d.cl });
        overlayManager.close('help');
      };
      frag.appendChild(chip);
    }
    grid.appendChild(frag);
    grid.dataset.built = '1';

    // Filter buttons: "all" (count-desc) vs. "trending" (surging+trending, ratio-desc).
    const btnAll = document.getElementById('help-filter-all');
    const btnHot = document.getElementById('help-filter-hot');
    if (btnAll && btnHot) {
      const applyFilter = (mode) => {
        btnAll.classList.toggle('active', mode === 'all');
        btnHot.classList.toggle('active', mode === 'hot');
        const chips = Array.from(grid.querySelectorAll('.help-cluster-chip'));
        if (mode === 'hot') {
          const hot = chips.filter(c => c.dataset.trend === 'trending' || c.dataset.trend === 'surging');
          hot.sort((a, b) => +b.dataset.ratio - +a.dataset.ratio);
          for (const c of chips) c.classList.add('hidden');
          for (const c of hot) { c.classList.remove('hidden'); grid.appendChild(c); }
        } else {
          const sorted = chips.slice().sort((a, b) => +b.dataset.count - +a.dataset.count);
          for (const c of chips) c.classList.remove('hidden');
          for (const c of sorted) grid.appendChild(c);
        }
      };
      btnAll.onclick = () => applyFilter('all');
      btnHot.onclick = () => applyFilter('hot');
    }
  }

  _maybeShowIntroToast() {
    // Only show on the very first visit; suppressed if the help panel has
    // ever been opened in this browser (strong signal they know it exists).
    if (storage.get('intro-seen') === '1') return;
    const el = document.createElement('div');
    el.className = 'intro-toast';
    el.innerHTML = `
      <span class="it-dot">✦</span>
      <span class="it-text">Press <kbd>?</kbd> for shortcuts  ·  <kbd>/</kbd> to search  ·  <kbd>✦</kbd> to be surprised</span>
      <button class="it-x" aria-label="Dismiss">×</button>
    `;
    document.body.appendChild(el);
    const dismiss = () => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 400);
      storage.set('intro-seen', '1');
    };
    el.querySelector('.it-x').onclick = dismiss;
    setTimeout(() => el.classList.add('show'), 60);
    setTimeout(dismiss, 9000);
    // Also dismiss on any click, keypress, or pointer move — user is engaged.
    let unbindKeys = null;
    const onMouseDown = () => {
      dismiss();
      if (unbindKeys) { unbindKeys(); unbindKeys = null; }
      window.removeEventListener('mousedown', onMouseDown, true);
    };
    setTimeout(() => {
      // Wildcard low-priority key listener: any non-modifier key dismisses
      // the toast. allowInInput so the toast disappears even if focus is
      // already in the search box.
      unbindKeys = keys.bind({
        keys: [
          'Escape', ' ', 'Enter', 'Tab',
          'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
          '/', '?', 's', 't', 'x', 'r', 'c',
          '[', ']', '{', '}',
        ],
        priority: 5,
        label: 'intro-toast-dismiss',
        allowInInput: true,
        allowModifiers: true,
        allowRepeat: true,
        handler: () => {
          dismiss();
          if (unbindKeys) { unbindKeys(); unbindKeys = null; }
          window.removeEventListener('mousedown', onMouseDown, true);
          return false;   // never consume; just observe
        },
      });
      window.addEventListener('mousedown', onMouseDown, true);
    }, 1500);   // grace period before interaction dismisses it
  }

  _initGlobalShortcuts() {
    // Register the help overlay with the manager so body-class state lives in
    // one place. `closeOnEsc: true` means the priority-100 Esc bind below
    // (the overlay-closer cascade) will hand off to overlayManager.closeTop().
    const helpOverlayEl = document.getElementById('help-overlay');
    if (helpOverlayEl) {
      overlayManager.register({
        name: 'help',
        rootEl: helpOverlayEl,
        bodyClasses: ['help-open'],
        closeOnEsc: true,
        priority: 100,
        onOpen: () => this._populateHelpClusters(),
      });
    }
    const toggleHelp = (show) => {
      if (!helpOverlayEl) return;
      const isOpen = overlayManager.isOpen('help');
      const next = show === undefined ? !isOpen : !!show;
      if (next) overlayManager.open('help');
      else overlayManager.close('help');
    };
    const btnHelp = document.getElementById('btn-help');
    if (btnHelp) btnHelp.onclick = () => toggleHelp();
    const helpClose = document.getElementById('help-close');
    if (helpClose) helpClose.onclick = () => toggleHelp(false);
    if (helpOverlayEl) helpOverlayEl.addEventListener('click', (e) => {
      if (e.target === helpOverlayEl) toggleHelp(false);
    });

    // ─── Escape cascade ─────────────────────────────────────────────
    //
    // The original implementation was one giant if-else cascade (tour →
    // help → detail → interview → bookmarks → search → camera reset).
    // Under the unified registry the cascade is split into ordered binds
    // at three priorities so the same precedence falls out of the
    // dispatcher's stable sort:
    //
    //   200 — tour swallows Esc (no-op while active).
    //   100 — overlay closers: help.
    //    50 — card closers: detail, interview, bookmarks,
    //         search-state, camera-zoom-reset.
    //
    // Each bind is allowInInput: true so Esc still escapes the search box
    // (the original used a single window listener that ran before the
    // typing-bypass check — we preserve that behavior explicitly).

    // Tour (priority 200). Esc is intentionally a no-op while the tour
    // overlay is up — Skip is the only way out.
    keys.bind({
      keys: ['Escape'], priority: 200, label: 'esc-tour-noop',
      allowInInput: true,
      handler: (e) => {
        const tourApi = window.App?.tour;
        const tourOv = document.getElementById('tour-overlay');
        const tourUp = tourOv && !tourOv.classList.contains('hidden');
        if (!tourApi?.isActive?.() && !tourUp) return false;
        e.preventDefault();
        return true;
      },
    });
    // Help overlay close (priority 100). Delegates to overlayManager.closeTop()
    // which closes the most recently opened closeOnEsc overlay; today only
    // help registers with closeOnEsc: true, so behavior is identical.
    keys.bind({
      keys: ['Escape'], priority: 100, label: 'esc-overlay-closeTop',
      allowInInput: true,
      handler: (e) => {
        if (!overlayManager.closeTop()) return false;
        e.preventDefault();
        return true;
      },
    });
    // Pinned view close (priority 50).
    keys.bind({
      keys: ['Escape'], priority: 50, label: 'esc-pinned-view',
      allowInInput: true,
      handler: (e) => {
        const pv = document.getElementById('pinned-view');
        if (!pv || pv.classList.contains('hidden')) return false;
        const closeBtn = document.getElementById('pv-close');
        if (closeBtn) closeBtn.click();
        else pv.classList.add('hidden');
        e.preventDefault();
        return true;
      },
    });
    // Interview card close (priority 50).
    keys.bind({
      keys: ['Escape'], priority: 50, label: 'esc-interview-card',
      allowInInput: true,
      handler: (e) => {
        const ivCard = document.getElementById('interview-card');
        if (!ivCard || ivCard.classList.contains('hidden')) return false;
        const close = ivCard.querySelector('.ic-close');
        if (close) {
          close.click();
          e.preventDefault();
          return true;
        }
        ivCard.classList.add('hidden');
        e.preventDefault();
        return true;
      },
    });
    // Bookmarks card close (priority 50).
    keys.bind({
      keys: ['Escape'], priority: 50, label: 'esc-bookmarks-card',
      allowInInput: true,
      handler: (e) => {
        if (!window.App?.closeBookmarksCard?.()) return false;
        e.preventDefault();
        return true;
      },
    });
    // Search state clear (priority 50).
    keys.bind({
      keys: ['Escape'], priority: 50, label: 'esc-search-state',
      allowInInput: true,
      handler: (e) => {
        if (!this._clearSearchState?.()) return false;
        e.preventDefault();
        return true;
      },
    });
    // Camera zoom reset (priority 50, runs last in the cascade).
    keys.bind({
      keys: ['Escape'], priority: 50, label: 'esc-camera-reset',
      allowInInput: true,
      handler: (e) => {
        const gl = window.App?.globe;
        if (!gl || typeof gl.isZoomedAwayFromCanonical !== 'function') return false;
        if (!gl.isZoomedAwayFromCanonical()) return false;
        gl.resetCanonicalZoom();
        e.preventDefault();
        return true;
      },
    });

    // ─── Top-level shortcuts (priority 20) ──────────────────────────
    keys.bind({
      keys: ['/'], priority: 20, label: 'focus-search',
      handler: (e) => {
        const input = document.getElementById('search-input');
        if (!input) return false;
        input.focus();
        input.select();
        e.preventDefault();
        return true;
      },
    });
    keys.bind({
      keys: ['?'], priority: 20, label: 'toggle-help',
      // Suppress while the tour is active — the tour owns its own help
      // affordances and ? would compete with the step-mode UI.
      when: () => !overlayManager.isOpen('tour'),
      handler: (e) => {
        toggleHelp();
        e.preventDefault();
        return true;
      },
    });
    keys.bind({
      keys: ['t'], priority: 20, label: 'toggle-timeline',
      handler: (e) => {
        const tlToggle = document.getElementById('tl-toggle');
        if (!tlToggle) return false;
        tlToggle.click();
        e.preventDefault();
        return true;
      },
    });
    keys.bind({
      keys: ['s'], priority: 20, label: 'surprise-me',
      handler: (e) => {
        const btn = document.getElementById('btn-surprise');
        if (btn) { btn.click(); e.preventDefault(); return true; }
        // Minimal-layout fallback: no surprise button surfaced, so
        // reach directly into the app for a random well-supported
        // subtopic drill (cl+gid). Going two levels deep is more
        // meaningful than just picking a cluster — the user lands on
        // a concrete topic, not an abstract bucket.
        // Soft anti-repeat: avoid the last few clusters so consecutive
        // presses don't pile up in one area.
        if (!this._recentSurpriseCls) this._recentSurpriseCls = [];
        const recent = this._recentSurpriseCls;
        const byGid = window.App?.subGidMap?.byGid || {};
        const hist = window.App?.state?.timeHist?.by_sub_gid || {};
        const weighted = [];
        for (const gidStr of Object.keys(byGid)) {
          const gid = +gidStr;
          const g = byGid[gid];
          if (!g) continue;
          const series = hist[gidStr];
          const n = series ? series.reduce((s, v) => s + v, 0) : (g.count || 0);
          if (n < 80) continue; // well-supported only
          const dampen = recent.includes(g.cl) ? 0.4 : 1;
          weighted.push({ cl: g.cl, gid, w: Math.sqrt(n) * dampen });
        }
        if (!weighted.length) return false;
        const total = weighted.reduce((s, c) => s + c.w, 0);
        let r = Math.random() * total;
        let pick = weighted[0];
        for (const c of weighted) { r -= c.w; if (r <= 0) { pick = c; break; } }
        recent.push(pick.cl);
        if (recent.length > 3) recent.shift();
        // Clear any active regex paint before drilling — otherwise the
        // surprise target intersects with the paint set and the globe
        // often renders as empty-bright (or stays dim on an unrelated
        // topic). Surprise should feel like a fresh start.
        if (typeof this._clearRegexPaint === 'function') this._clearRegexPaint();
        this.focus({ cl: pick.cl, gid: pick.gid });
        e.preventDefault();
        return true;
      },
    });
    keys.bind({
      keys: ['x'], priority: 20, label: 'global-reset',
      handler: (e) => {
        // Global reset shortcut — unwinds drill + all filters + search.
        const btn = document.getElementById('btn-reset');
        if (btn) { btn.click(); e.preventDefault(); return true; }
        // Minimal-layout fallback: just unwind drill focus.
        this.focus({});
        const input = document.getElementById('search-input');
        if (input) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
        if (typeof this._clearRegexPaint === 'function') this._clearRegexPaint();
        e.preventDefault();
        return true;
      },
    });
  }

  // ─── Search: match cluster / sub / position names + n-grams ────
  _initSearch() {
    const input = document.getElementById('search-input');
    const suggestions = document.getElementById('search-suggestions');
    if (!input || !suggestions) return;
    // Single-word hint only (no long syntax placeholder in the field).
    input.placeholder = 'Search';
    input.setAttribute('aria-label', 'Search');

    this._ngrams = null;
    fetch('tsne_chunks/ngrams.json').then(r => r.ok ? r.json() : null).then(d => {
      if (d) this._ngrams = d;
    }).catch(() => {});

    // Warm the text corpus after a short idle window so the first
    // `text:` query feels instant. Still cheap (~1.1 MB) and fetched via
    // requestIdleCallback so the globe's first-paint budget isn't touched.
    const idleKick = () => this._ensureTextCorpus();
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(idleKick, { timeout: 6000 });
    } else {
      setTimeout(idleKick, 3500);
    }

    // Post-body text corpus — loaded on demand when the user types text:pat.
    // 3,675 sampled snippets × their 2D grid cell's dominant (cl, sub_gid),
    // baked by scripts/compute_cell_clusters.py. Enables regex over real
    // post text with click-to-jump attribution.
    this._textCorpus = null;
    this._textCorpusPromise = null;
    this._textCorpusFailed = false;
    this._ensureTextCorpus = () => {
      if (this._textCorpus) return Promise.resolve(this._textCorpus);
      if (this._textCorpusFailed) return Promise.resolve(null);
      if (this._textCorpusPromise) return this._textCorpusPromise;
      this._textCorpusPromise = Promise.all([
        fetch('tsne_chunks/grid_cells_samples.json').then(r => r.ok ? r.json() : null),
        fetch('tsne_chunks/grid_cell_clusters.json').then(r => r.ok ? r.json() : null),
      ]).then(([samples, cellCl]) => {
        if (!samples || !cellCl) { this._textCorpusFailed = true; return null; }
        const flat = [];
        const clusterMeta = this.state.clusterMeta || {};
        const byGid = this.subGidMap.byGid;
        for (const cell of samples.cells) {
          const mapping = cellCl[cell.id];
          if (!mapping) continue;
          const cl = mapping.dominant_cl;
          const gid = mapping.top_sub_gid;
          const subInfo = gid != null ? byGid[gid] : null;
          const clName = clusterMeta[String(cl)]?.name || `Topic ${cl}`;
          for (const text of cell.samples || []) {
            if (typeof text !== 'string' || !text) continue;
            flat.push({ text, cl, gid, subName: subInfo?.name || '', clusterName: clName });
          }
        }
        this._textCorpus = flat;
        return flat;
      }).catch(() => { this._textCorpusFailed = true; return null; });
      return this._textCorpusPromise;
    };

    this._searchIndex = this._buildSearchIndex();

    // ── Search history (localStorage). Shown as a "recent" list when the
    // user focuses an empty input — click or keyboard-select re-runs the
    // query. Stored in newest-first order, de-duped, capped at 20.
    const HIST_KEY = 'search-hist';
    const HIST_MAX = 20;
    const loadHist = () => {
      const arr = storage.getJSON(HIST_KEY, []);
      return Array.isArray(arr) ? arr : [];
    };
    const pushHist = (q) => {
      if (!q || !q.trim()) return;
      const qq = q.trim();
      const prev = loadHist().filter(x => x !== qq);
      const next = [qq, ...prev].slice(0, HIST_MAX);
      storage.setJSON(HIST_KEY, next);
    };

    let activeIdx = -1;
    let currentMatches = [];
    let userNavigated = false;

    // Empty-query directory: render every clusters / subtopics / positions
    // entry from the search index, so focusing the empty box shows all the
    // options up front. Tap/click any row to drill into it.
    const renderAll = () => {
      const groups = { cluster: [], sub: [], position: [] };
      for (const e of (this._searchIndex || [])) {
        if (groups[e.kind]) groups[e.kind].push(e);
      }
      if (!groups.cluster.length && !groups.sub.length && !groups.position.length) {
        return renderHistory();
      }
      const order = ['cluster', 'sub', 'position'];
      const kindLabel = { cluster: 'topics', sub: 'subtopics', position: 'points of view' };
      // Previews — not a table-of-contents dump. Keep it glanceable.
      const PREVIEW_PER_KIND = 5;
      const parts = [];
      const flat = [];
      let i = 0;
      for (const k of order) {
        const arr = groups[k].slice(0, PREVIEW_PER_KIND);
        if (!arr.length) continue;
        const total = groups[k].length;
        const titleSuffix = total > arr.length ? ` (${arr.length} of ${total} — type to filter)` : ` (${total})`;
        parts.push(`<div class="sugg-group"><div class="sugg-group-title">${kindLabel[k]}${titleSuffix}</div>`);
        for (const h of arr) {
          const dotColor = h.color || '#7cf0c9';
          const ctx = h.context ? `<span class="sugg-kind">${this._escHtml(h.context)}</span>` : '';
          parts.push(`
            <div class="sugg-item" data-idx="${i}">
              <span class="sugg-dot" style="background:${dotColor}; color:${dotColor}"></span>
              <span class="sugg-text">${this._escHtml(h.label)}</span>
              ${ctx}
            </div>`);
          flat.push(h);
          i++;
        }
        parts.push('</div>');
      }
      suggestions.innerHTML = parts.join('');
      suggestions.classList.remove('hidden');
      currentMatches = flat;
      activeIdx = flat.length > 0 ? 0 : -1;
      suggestions.querySelectorAll('.sugg-item').forEach((el) => {
        const idx = +el.dataset.idx;
        el.onclick = () => this._applySearchHit(currentMatches[idx], input);
        el.onmouseenter = () => { activeIdx = idx; updateActive(); };
      });
      updateActive();
    };

    const renderHistory = () => {
      const hist = loadHist();
      if (!hist.length) return false;
      const items = hist.slice(0, 8);
      const parts = [`<div class="sugg-group"><div class="sugg-group-title sugg-group-title-row">recent searches<button class="sugg-hist-clear" type="button" aria-label="Clear search history">clear</button></div>`];
      items.forEach((q, i) => {
        parts.push(`
          <div class="sugg-item" data-idx="${i}" data-hist="1">
            <span class="sugg-dot" style="background:#8794ab; color:#8794ab"></span>
            <span class="sugg-text">${this._escHtml(q)}</span>
            <span class="sugg-kind">↵ to rerun</span>
          </div>`);
      });
      parts.push('</div>');
      suggestions.innerHTML = parts.join('');
      suggestions.classList.remove('hidden');
      currentMatches = items.map(q => ({ kind: '_hist', query: q }));
      activeIdx = 0;
      suggestions.querySelectorAll('.sugg-item').forEach((el) => {
        const idx = +el.dataset.idx;
        el.onclick = () => {
          input.value = items[idx];
          render(input.value);
          input.focus();
        };
        el.onmouseenter = () => { activeIdx = idx; updateActive(); };
      });
      const clearBtn = suggestions.querySelector('.sugg-hist-clear');
      if (clearBtn) {
        // Mousedown fires before blur so the dropdown doesn't close on us
        // before the handler runs.
        clearBtn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          storage.remove(HIST_KEY);
          suggestions.classList.add('hidden');
          currentMatches = [];
        });
      }
      updateActive();
      return true;
    };

    const updateActive = () => {
      suggestions.querySelectorAll('.sugg-item').forEach((el) => {
        el.classList.toggle('active', +el.dataset.idx === activeIdx);
      });
    };

    // Paint all matching clusters/subs on the globe whenever the query
    // produces 1+ match. Clears on empty query / no match. Runs in
    // parallel with rendering the dropdown.
    const paintCurrentMatches = (hits) => {
      const globe = window.App?.globe;
      if (!globe) return;
      const clusters = new Set();
      const subs = new Set();
      const positions = new Set();
      for (const h of hits) {
        if (h.kind === 'cluster' && h.cl != null) clusters.add(h.cl);
        else if (h.kind === 'sub' && h.gid != null) {
          const g = this.subGidMap.byGid[h.gid];
          if (g) subs.add(`${g.cl}_${g.sub}`);
        } else if (h.kind === 'position' && h.gid != null) {
          const g = this.subGidMap.byGid[h.gid];
          if (g) subs.add(`${g.cl}_${g.sub}`);
          if (h.posIdx != null) positions.add(`${h.gid}_${h.posIdx}`);
        } else if (h.kind === 'gridcell' && h.cl != null) {
          clusters.add(h.cl);
          if (h.gid != null) {
            const g = this.subGidMap.byGid[h.gid];
            if (g) subs.add(`${g.cl}_${g.sub}`);
          }
        } else if (h.kind === 'text' && h.cl != null) {
          if (h.gid != null) {
            const g = this.subGidMap.byGid[h.gid];
            if (g) subs.add(`${g.cl}_${g.sub}`);
          } else {
            clusters.add(h.cl);
          }
        }
      }
      if (clusters.size === 0 && subs.size === 0 && positions.size === 0) {
        globe.setMultiHighlight({});
      } else {
        globe.setMultiHighlight({ clusters, subs, positions });
      }
    };

    const render = (q) => {
      const qTrim = q.trim();
      userNavigated = false;
      if (!qTrim) {
        this._clearSearchState({ clearInput: false });
        suggestions.classList.add('hidden');
        currentMatches = [];
        input.classList.remove('regex-mode', 'regex-error');
        return;
      }
      // If the user is asking for a text search, eagerly fetch the corpus
      // and re-render when it's ready. Show a loading placeholder in the
      // meantime — or a distinct error if the fetch has already failed.
      const wantsText = /(^|\s)-?text:/i.test(qTrim);
      if (wantsText && !this._textCorpus) {
        if (this._textCorpusFailed) {
          suggestions.innerHTML = `<div class="sugg-item"><span class="sugg-text" style="color:#ff8a8a; font-style:italic;">post snippets unavailable — check that tsne_chunks/grid_cells_samples.json + grid_cell_clusters.json are served</span></div>`;
          suggestions.classList.remove('hidden');
          currentMatches = [];
          activeIdx = -1;
          return;
        }
        this._ensureTextCorpus().then(() => {
          if (input.value === q) render(q);
        });
        suggestions.innerHTML = `<div class="sugg-item"><span class="sugg-text" style="color:var(--fg-mute); font-style:italic;">loading post snippets…</span></div>`;
        suggestions.classList.remove('hidden');
        currentMatches = [];
        activeIdx = -1;
        return;
      }
      const hits = this._searchMatches(qTrim);
      this._currentSearchHits = hits;
      currentMatches = hits;
      activeIdx = hits.length > 0 ? 0 : -1;
      // No auto-paint while typing — globe only changes when the user
      // explicitly clicks a result (cluster, sub, position, snippet, phrase).
      const parsed = this._lastQuery;
      input.classList.toggle('regex-mode', parsed && parsed.kind === 'regex');
      input.classList.toggle('regex-error', parsed && parsed.kind === 'error');
      if (parsed && parsed.kind === 'error') {
        suggestions.innerHTML = `<div class="sugg-item"><span class="sugg-text" style="color:#ff8a8a; font-style:italic;">invalid regex: ${this._escHtml(parsed.error)}</span></div>`;
        suggestions.classList.remove('hidden');
        return;
      }
      if (hits.length === 0) {
        suggestions.innerHTML = `<div class="sugg-item"><span class="sugg-text" style="color:var(--fg-mute); font-style:italic;">no matches</span></div>`;
        suggestions.classList.remove('hidden');
        return;
      }
      const groups = { subreddit: [], cluster: [], sub: [], position: [], gridcell: [], ngram: [], text: [] };
      for (const h of hits) groups[h.kind]?.push(h);
      const kindLabel = {
        subreddit: 'subreddits', cluster: 'topics', sub: 'subtopics', position: 'points of view',
        gridcell: 'Sentiment', ngram: 'phrases', text: 'post snippets',
      };
      const parts = [];
      // Flattened display-order array — crucial because the suggestion
      // groups render in a fixed visual order (subreddit → cluster → ...)
      // but _searchMatches returns hits sorted by score. Clicking a visual
      // item needs to look up THAT item, not the score-sorted equivalent.
      const displayOrdered = [];
      const hasScoped = parsed.includes.some(t => t.field) || parsed.excludes.length > 0;
      if (parsed.kind === 'regex' || hasScoped) {
        const fmt = (t) => {
          const body = t.kind === 'regex' ? `/${this._escHtml(t.display)}/` : this._escHtml(t.display);
          return `${t.field ? t.field + ':' : ''}${body}`;
        };
        const bits = [
          ...parsed.includes.map(fmt),
          ...parsed.excludes.map(t => '−' + fmt(t)),
        ];
        const subCount = hits.filter(h =>
          h.kind === 'sub' || h.kind === 'cluster' || h.kind === 'position' || h.kind === 'gridcell').length;
        const paintHint = subCount >= 2
          ? ` <span class="sugg-paint-hint"><kbd>⇧↵</kbd> paint ${subCount} on globe</span>`
          : '';
        parts.push(`<div class="sugg-mode-hint">${bits.join(' · ')} · ${hits.length} match${hits.length===1?'':'es'}${paintHint}</div>`);
      }
      // When we're in text-mode, the aggregated sub/cluster "where it lives"
      // chips should lead, followed by the individual snippets. For a plain
      // phrase query the user typically wants TOPICS (navigable handles)
      // first — text snippets are discovery context that makes more sense
      // below, after the cluster/sub/position matches.
      const isTextMode = parsed.includes.some(t => t.field === 'text');
      const order = isTextMode
        ? ['sub', 'cluster', 'text', 'subreddit', 'position', 'gridcell', 'ngram']
        : ['subreddit', 'cluster', 'sub', 'position', 'gridcell', 'ngram', 'text'];
      for (const k of order) {
        if (groups[k].length === 0) continue;
        const titleClass = k === 'ngram' ? 'sugg-group-title sugg-group-title--paintable' : 'sugg-group-title';
        parts.push(`<div class="sugg-group"><div class="${titleClass}">${kindLabel[k]}</div>`);
        for (const h of groups[k]) {
          const dotColor = h.color || '#7cf0c9';
          const i = displayOrdered.length;
          displayOrdered.push(h);
          // Text snippets need more room (multi-line) + use a monospace-ish
          // display so quoted posts read like posts, not labels.
          if (k === 'text') {
            const snippet = this._highlightSnippet(h.label, parsed);
            const badge = `<span class="sugg-text-badge" style="background:${dotColor}20; color:${dotColor}; border:1px solid ${dotColor}60">${this._escHtml(h.context || h.clusterName || '')}</span>`;
            parts.push(`
              <div class="sugg-item sugg-item-text" data-idx="${i}">
                <div class="sugg-text-snippet">${snippet}</div>
                ${badge}
              </div>`);
            continue;
          }
          parts.push(`
            <div class="sugg-item" data-idx="${i}">
              <span class="sugg-dot" style="background:${dotColor}; color:${dotColor}"></span>
              <span class="sugg-text">${this._highlight(h.label, parsed)}</span>
              <span class="sugg-kind">${this._escHtml(h.context || '')}</span>
            </div>`);
        }
        parts.push('</div>');
      }
      suggestions.innerHTML = parts.join('');
      suggestions.classList.remove('hidden');
      // "phrases" section header — clicking paints the globe with all
      // cluster/sub matches for the current query (same as Shift+Enter).
      const phrasesHeader = suggestions.querySelector('.sugg-group-title--paintable');
      if (phrasesHeader) {
        phrasesHeader.addEventListener('click', (e) => {
          e.stopPropagation();
          suggestions.classList.add('hidden');
          input.blur();
          this._runSpotlightSearch(input.value.trim());
        });
      }
      // Overwrite currentMatches with visual order so keyboard nav + click
      // use the same indexing scheme.
      currentMatches = displayOrdered;
      // Highlight the HIGHEST-SCORED match by default, not the visually-first.
      // Sections render subreddit → cluster → …, but for queries like "mbta"
      // the cluster "MBTA Outrage" scores higher than the r/mbta subreddit
      // match, and Enter should go to the best match not the top section.
      // Users can arrow-key to other items or click directly.
      if (displayOrdered.length > 0) {
        let best = 0, bestScore = -Infinity;
        for (let i = 0; i < displayOrdered.length; i++) {
          const s = displayOrdered[i].score || 0;
          if (s > bestScore) { bestScore = s; best = i; }
        }
        activeIdx = best;
      }
      suggestions.querySelectorAll('.sugg-item').forEach(el => {
        const idx = +el.dataset.idx;
        el.onclick = () => this._applySearchHit(currentMatches[idx], input);
        el.onmouseenter = () => { activeIdx = idx; updateActive(); };
      });
      updateActive();
    };

    input.addEventListener('input', () => render(input.value));
    input.addEventListener('focus', () => {
      if (input.value) { render(input.value); return; }
      // Empty focus: show a browsable directory of all clusters/subtopics/
      // positions so the search box doubles as a table of contents.
      renderAll();
    });
    input.addEventListener('blur', () => {
      setTimeout(() => suggestions.classList.add('hidden'), 120);
      // writeHash is a no-op (URL not updated); kept so callers stay in sync.
      if (window.App?.writeHash) window.App.writeHash();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this._clearSearchState();
        return;
      }
      if (e.key === 'ArrowDown' && currentMatches.length) {
        activeIdx = Math.min(currentMatches.length - 1, activeIdx + 1);
        userNavigated = true;
        updateActive();
        e.preventDefault();
        return;
      }
      if (e.key === 'ArrowUp' && currentMatches.length) {
        activeIdx = Math.max(0, activeIdx - 1);
        userNavigated = true;
        updateActive();
        e.preventDefault();
        return;
      }
      if (e.key !== 'Enter') return;

      const qTrim = (input.value || '').trim();
      if (!qTrim) return;
      const sel = activeIdx >= 0 ? currentMatches[activeIdx] : null;

      // History entry: repopulate and re-run.
      if (sel && sel.kind === '_hist') {
        input.value = sel.query;
        render(input.value);
        e.preventDefault();
        return;
      }

      const parsed = this._lastQuery;
      const hasMultiKinds = currentMatches.some(m =>
        m.kind === 'sub' || m.kind === 'cluster' || m.kind === 'position' || m.kind === 'gridcell');

      // Shift+Enter paints the union of sub/cluster hits on the globe.
      if (e.shiftKey && hasMultiKinds) {
        this._paintRegexOnGlobe(currentMatches);
        pushHist(input.value);
        e.preventDefault();
        return;
      }

      // Plain text + user hasn't arrowed → spotlight the literal input. This
      // matches "press Enter to search for what I typed" instead of jumping
      // to whichever metadata suggestion happened to score highest.
      const isPlainPhrase = parsed && parsed.kind === 'substr'
        && parsed.includes.length > 0
        && parsed.includes.every(t => !t.field);
      if (isPlainPhrase && !userNavigated) {
        pushHist(input.value);
        suggestions.classList.add('hidden');
        input.blur();
        this._runSpotlightSearch(qTrim);
        e.preventDefault();
        return;
      }

      // Regex / field-scoped queries fall through to the prior behavior:
      // autoPaint when multi-kind, otherwise apply the active hit.
      const isTextMode = parsed && parsed.includes?.some(t => t.field === 'text');
      const autoPaint = parsed && parsed.kind === 'regex' && !isTextMode
        && hasMultiKinds && currentMatches.filter(m => m.kind !== 'ngram').length > 1;
      if (autoPaint) {
        this._paintRegexOnGlobe(currentMatches);
        pushHist(input.value);
        e.preventDefault();
        return;
      }
      if (sel) {
        pushHist(input.value);
        this._applySearchHit(sel, input);
        e.preventDefault();
      }
    });
  }

  // Paint all regex-matched clusters/subs on the globe: dim non-matching
  // points, ease globe out to a wide-view distance so the highlighted
  // constellation reads as a pattern.
  _paintRegexOnGlobe(hits) {
    if (!window.App?.globe) return;
    const clusters = new Set();
    const subs = new Set();
    const positions = new Set();
    for (const h of hits) {
      if (h.kind === 'cluster') clusters.add(h.cl);
      else if (h.kind === 'sub' && h.gid != null) {
        const g = this.subGidMap.byGid[h.gid];
        if (g) subs.add(`${g.cl}_${g.sub}`);
      } else if (h.kind === 'position' && h.gid != null) {
        const g = this.subGidMap.byGid[h.gid];
        if (g) subs.add(`${g.cl}_${g.sub}`);
        if (h.posIdx != null) positions.add(`${h.gid}_${h.posIdx}`);
      } else if (h.kind === 'gridcell' && h.cl != null) {
        clusters.add(h.cl);
        if (h.gid != null) {
          const g = this.subGidMap.byGid[h.gid];
          if (g) subs.add(`${g.cl}_${g.sub}`);
        }
      }
    }
    if (clusters.size === 0 && subs.size === 0 && positions.size === 0) return;
    window.App.globe.setMultiHighlight({ clusters, subs, positions });
    // Ease to a wider view so the pattern is visible.
    const d = Math.max(2.1, window.App.globe.distanceTarget);
    window.App.globe.rotateTo(0.2, 0, d);
    document.getElementById('search-suggestions').classList.add('hidden');
    document.getElementById('search-input').blur();
    // Show a chip summarizing matches; clicking it re-opens the dropdown
    // so the user can drill into a specific match.
    this._showRegexChip(clusters.size, subs.size);
  }

  _clearRegexPaint() {
    if (window.App?.globe?._multiHighlightActive) {
      window.App.globe.setMultiHighlight({});
    }
    const chip = document.getElementById('regex-chip');
    if (chip) chip.remove();
  }

  // Per-post text search: scan all chunks for the phrase, then spotlight only
  // the matching points on the globe. First call loads ~440 MB of chunk JSON;
  // subsequent calls are instant.
  _runSpotlightSearch(phrase) {
    const App = window.App;
    if (!App?.findPointsContaining || !App?.globe?.setSpotlight) return;
    const p = String(phrase || '').trim();
    if (!p) return;
    this._spotlightToken = (this._spotlightToken || 0) + 1;
    const myToken = this._spotlightToken;
    this._showSpotlightChip(`Indexing posts… 0/${this.state.manifest?.files?.length ?? 22}`, false);
    App.findPointsContaining(p, (done, total) => {
      if (myToken !== this._spotlightToken) return;
      this._showSpotlightChip(`Indexing posts… ${done}/${total}`, false);
    }).then(set => {
      if (myToken !== this._spotlightToken) return;
      App.globe.setSpotlight(set);
      const n = set.size;
      if (n === 0) this._showSpotlightChip(`No posts contain "${p}"`, true);
      else this._showSpotlightChip(`${n.toLocaleString()} post${n === 1 ? '' : 's'} mention "${p}"`, true);
    }).catch(() => {
      if (myToken !== this._spotlightToken) return;
      this._showSpotlightChip(`Search failed`, true);
    });
  }

  _showSpotlightChip(label, dismissable) {
    let chip = document.getElementById('spotlight-chip');
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'spotlight-chip';
      chip.className = 'regex-chip';
      document.getElementById('nav-header').appendChild(chip);
    }
    if (dismissable) {
      chip.innerHTML = `<button class="rc-body">${this._escHtml(label)}</button><button class="rc-x" aria-label="Clear">×</button>`;
      chip.querySelector('.rc-x').onclick = (ev) => {
        ev.stopPropagation();
        this._clearSpotlight();
      };
    } else {
      chip.innerHTML = `<span class="rc-body" style="opacity:0.75">${this._escHtml(label)}</span>`;
    }
  }

  _clearSpotlight() {
    this._spotlightToken = (this._spotlightToken || 0) + 1;   // invalidate any in-flight search
    if (window.App?.globe?.setSpotlight) window.App.globe.setSpotlight(null);
    const chip = document.getElementById('spotlight-chip');
    if (chip) chip.remove();
  }

  _clearSearchState({ clearInput = true } = {}) {
    const input = document.getElementById('search-input');
    const suggestions = document.getElementById('search-suggestions');
    const hadInput = !!(input && input.value.trim());
    const hadSuggestions = !!(suggestions && !suggestions.classList.contains('hidden'));
    const hadRegexPaint = !!window.App?.globe?._multiHighlightActive;
    const hadSpotlight = !!document.getElementById('spotlight-chip');
    const hadSubredditFilter = !!window.App?.hasSubredditFilter?.();
    const hadTopicFilter = this.focusCl != null || this.focusGid != null || this.focusPosIdx != null;
    if (!hadInput && !hadSuggestions && !hadRegexPaint && !hadSpotlight && !hadSubredditFilter && !hadTopicFilter) return false;

    if (input && clearInput) {
      input.value = '';
      input.blur();
    }
    input?.classList.remove('regex-mode', 'regex-error');
    suggestions?.classList.add('hidden');
    this._currentSearchHits = [];
    this._lastQuery = null;
    this._clearRegexPaint?.();
    this._clearSpotlight?.();
    window.App?.clearSubredditFilter?.();
    if (hadTopicFilter) this.focus({});
    return true;
  }

  _showRegexChip(clusterCount, subCount) {
    let chip = document.getElementById('regex-chip');
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'regex-chip';
      chip.className = 'regex-chip';
      document.getElementById('nav-header').appendChild(chip);
    }
    const parts = [];
    if (clusterCount) parts.push(`${clusterCount} topic${clusterCount === 1 ? '' : 's'}`);
    if (subCount) parts.push(`${subCount} sub${subCount === 1 ? '' : 's'}`);
    const label = parts.join(' + ') || '0 matches';
    chip.innerHTML = `<button class="rc-body" title="Show match list">${label} highlighted</button><button class="rc-x" aria-label="Clear">×</button>`;
    chip.querySelector('.rc-x').onclick = (ev) => {
      ev.stopPropagation();
      this._clearRegexPaint();
    };
    chip.querySelector('.rc-body').onclick = () => {
      // Re-open the search dropdown for the current query so the user can
      // click through matched clusters/subs one at a time.
      const input = document.getElementById('search-input');
      if (input) {
        input.focus();
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };
  }

  _buildSearchIndex() {
    const out = [];
    const clusters = this.state.clusterMeta || {};
    for (const [clStr, meta] of Object.entries(clusters)) {
      const cl = +clStr;
      out.push({ kind: 'cluster', cl, label: meta.name || `Topic ${cl}`,
        color: clusterColor(cl), context: '' });
    }
    const gridCells = this.state.gridCells;
    if (gridCells && gridCells.length) {
      for (const c of gridCells) {
        const cl = c.dominant_cl;
        if (cl == null || !clusters[String(cl)]) continue;
        const gid = c.top_sub_gid;
        const prop = c.prop || '';
        out.push({
          kind: 'gridcell',
          cellId: c.id,
          cl,
          gid: gid != null ? gid : undefined,
          label: prop.length > 120 ? `${prop.slice(0, 117)}…` : prop,
          color: clusterColor(cl),
          context: `Sentiment · ${(c.n ?? 0).toLocaleString()} posts`,
          extra: prop,
        });
      }
    }
    const subMeta = this.state.subMeta || {};
    for (const clStr of Object.keys(subMeta)) {
      const cl = +clStr;
      const clusterName = clusters[clStr]?.name || '';
      for (const s of subMeta[clStr]) {
        const gid = this.subGidMap.byLocal[cl]?.[s.sub];
        if (gid == null) continue;
        out.push({ kind: 'sub', cl, gid, label: s.name,
          color: clusterColor(cl), context: clusterName });
      }
    }
    const posAnchors = this.state.positionAnchors;
    if (posAnchors) {
      for (const [gidStr, doc] of Object.entries(posAnchors)) {
        const cl = doc.cl;
        const gid = +gidStr;
        const positions = doc.positions || [];
        positions.forEach((p, idx) => {
          if (!p.name) return;
          // Include keywords + description in the haystack so regex can
          // match on the rich signal phrases (e.g. "can't afford stay") —
          // these are the most distinctive strings per position. Label stays
          // clean for display.
          const kws = (p.keywords || []).join(' ');
          const extra = [p.description || '', kws].filter(Boolean).join(' ');
          out.push({ kind: 'position', cl, gid, posIdx: idx, label: p.name,
            color: clusterColor(cl), context: doc.sub_name, extra });
        });
      }
    }
    // Subreddits — searchable as a 5th kind so users can type "mbta" and
    // filter the globe directly without hunting through cluster names.
    const srNames = this.state.subredditNames || [];
    for (const s of srNames) {
      if (!s.name || s.count < 500) continue;   // skip rarely-present subs
      out.push({
        kind: 'subreddit',
        srId: s.id, label: `r/${s.name}`,
        color: '#7cf0c9',
        context: `${s.count.toLocaleString()} posts`,
      });
    }
    return out;
  }

  // Parse the query into a compound matcher. Recognizes, per whitespace
  // token (tokens AND together):
  //   /pattern/flags         → regex match on label+context
  //   re:pattern             → regex match (case-insensitive)
  //   terms with regex chars → regex match (case-insensitive), e.g. rent|mortgage
  //   sub:<pat>              → restrict include to sub + position kinds
  //   cl:<pat>               → restrict include to cluster + sub + position
  //   r:<pat>  or  r/<pat>   → restrict include to subreddit kind
  //   pos:<pat>              → restrict include to position kind
  //   -<term>                → exclude entries matching this term
  //   anything else          → case-insensitive substring
  // Field prefixes can carry /regex/ too, e.g.  sub:/afford|rent/
  // Returns { kind:'substr'|'regex'|'error'|'empty', includes[], excludes[], test(hay, entry),
  //   display (raw), primaryDisplay, re, low, hasRegex, error? }.
  _parseQuery(q) {
    const raw = q.trim();
    if (!raw) return { kind: 'empty', includes: [], excludes: [], display: '', test: () => false };

    const tokens = this._tokenizeQuery(raw);
    const includes = [], excludes = [];
    let firstError = null, hasRegex = false;

    for (let tok of tokens) {
      let exclude = false;
      if (tok.length > 1 && tok[0] === '-') { exclude = true; tok = tok.slice(1); }
      if (!tok) continue;
      let field = null, rest = tok;
      const fm = rest.match(/^(sub|cl|pos|r|ng|text):(.+)$/i);
      const rslash = !fm && rest.match(/^r\/(.+)$/i);
      if (fm) { field = fm[1].toLowerCase(); rest = fm[2]; }
      else if (rslash) { field = 'r'; rest = rslash[1]; }
      if (!rest) continue;
      const m = this._makeMatcher(rest);
      if (m.kind === 'error') { if (!firstError) firstError = m.error; continue; }
      if (m.kind === 'regex') hasRegex = true;
      const term = { field, test: m.test, display: m.display, kind: m.kind,
                     re: m.re, low: m.low, exclude };
      (exclude ? excludes : includes).push(term);
    }

    if (firstError && includes.length === 0) {
      return { kind: 'error', error: firstError, display: raw, includes: [], excludes: [],
               test: () => false };
    }

    const primary = includes[0] || null;
    const self = this;
    return {
      kind: hasRegex ? 'regex' : 'substr',
      display: raw,
      primaryDisplay: primary ? primary.display : '',
      re: primary ? primary.re : null,
      low: primary ? primary.low : null,
      includes, excludes, hasRegex,
      test(hay, entry) {
        for (const t of includes) if (!self._matchTerm(t, entry, hay)) return false;
        for (const t of excludes) if (self._matchTerm(t, entry, hay)) return false;
        return true;
      },
    };
  }

  _matchTerm(term, entry, hay) {
    if (term.field && entry) {
      const k = entry.kind;
      if (term.field === 'r'   && k !== 'subreddit') return false;
      if (term.field === 'sub' && k !== 'sub' && k !== 'position' && k !== 'gridcell') return false;
      if (term.field === 'cl'  && k !== 'cluster' && k !== 'sub' && k !== 'position' && k !== 'gridcell') return false;
      if (term.field === 'pos' && k !== 'position') return false;
      if (term.field === 'ng'  && k !== 'ngram') return false;
    }
    return term.test(hay);
  }

  _makeMatcher(s) {
    const m = s.match(/^\/(.+)\/([gimsuy]*)$/);
    if (m) {
      try {
        const rawFlags = m[2] || '';
        const flags = rawFlags.includes('i') ? rawFlags : rawFlags + 'i';
        const re = new RegExp(m[1], flags);
        return { kind: 'regex', test: (h) => this._testRegex(re, h), display: m[1], re };
      } catch (err) { return { kind: 'error', error: err.message }; }
    }
    if (s.startsWith('re:')) {
      const p = s.slice(3);
      try {
        const re = new RegExp(p, 'i');
        return { kind: 'regex', test: (h) => this._testRegex(re, h), display: p, re };
      } catch (err) { return { kind: 'error', error: err.message }; }
    }
    // Bare regex mode: if the search term contains regex syntax, compile it
    // directly so users can type patterns like `rent|mortgage` or `\bMBTA\b`.
    if (/[\\^$.*+?()[\]{}|]/.test(s)) {
      try {
        const re = new RegExp(s, 'i');
        return { kind: 'regex', test: (h) => this._testRegex(re, h), display: s, re };
      } catch (err) { return { kind: 'error', error: err.message }; }
    }
    const low = s.toLowerCase();
    return { kind: 'substr', test: (h) => h.toLowerCase().includes(low), display: low, low };
  }

  _testRegex(re, hay) {
    re.lastIndex = 0;
    return re.test(hay);
  }

  _tokenizeQuery(raw) {
    const tokens = [];
    let buf = '', inSlash = false, inQuote = false, prev = '';
    const bufEndsFieldOrDash = () => buf === '' || buf === '-' ||
      /^-?(sub|cl|pos|r|ng|text):$/i.test(buf) || /^-?r$/i.test(buf);
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inQuote) { if (c === '"') inQuote = false; else buf += c; prev = c; continue; }
      if (inSlash) {
        buf += c;
        if (c === '/' && prev !== '\\') {
          while (i + 1 < raw.length && 'gimsuy'.includes(raw[i+1])) { buf += raw[++i]; }
          inSlash = false;
        }
        prev = c; continue;
      }
      if (c === '"') { inQuote = true; prev = c; continue; }
      if (c === '/' && bufEndsFieldOrDash()) { buf += c; inSlash = true; prev = c; continue; }
      if (c === ' ' || c === '\t') { if (buf) tokens.push(buf); buf = ''; prev = c; continue; }
      buf += c; prev = c;
    }
    if (buf) tokens.push(buf);
    return tokens;
  }

  // Text-mode: search over 3,675 sample snippets instead of metadata.
  // Returns BOTH aggregated where-matches-live results (as sub/cluster
  // entries with a count context) AND individual snippet entries, so the
  // reader sees distribution before diving into quotes.
  _matchTextCorpus(parsed) {
    const terms = parsed.includes;
    const excludes = parsed.excludes;
    const matches = [];
    const bySub = new Map();     // gid → count
    const byCluster = new Map(); // cl → count (for hits without a known gid)
    for (const entry of this._textCorpus) {
      const hay = entry.text;
      let ok = true;
      for (const t of terms) { if (!t.test(hay)) { ok = false; break; } }
      if (ok) for (const t of excludes) { if (t.test(hay)) { ok = false; break; } }
      if (!ok) continue;
      matches.push(entry);
      if (entry.gid != null) bySub.set(entry.gid, (bySub.get(entry.gid) || 0) + 1);
      else byCluster.set(entry.cl, (byCluster.get(entry.cl) || 0) + 1);
    }
    const out = [];
    // Distribution header — where the matches cluster, as navigable chips.
    // Ranked by match count so the top-hit areas are visible first.
    const topSubs = [...bySub.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    for (const [gid, count] of topSubs) {
      const sub = this.subGidMap.byGid[gid];
      if (!sub) continue;
      out.push({
        kind: 'sub', cl: sub.cl, gid,
        label: sub.name,
        color: clusterColor(sub.cl),
        context: `${count} match${count === 1 ? '' : 'es'}`,
      });
    }
    const topCls = [...byCluster.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
    for (const [cl, count] of topCls) {
      const name = this.state.clusterMeta?.[String(cl)]?.name || `Topic ${cl}`;
      out.push({
        kind: 'cluster', cl, label: name,
        color: clusterColor(cl),
        context: `${count} match${count === 1 ? '' : 'es'}`,
      });
    }
    // Individual snippets — cap per (cl, gid) so one chatty area doesn't
    // crowd out the rest.
    const seenCount = new Map();
    for (const entry of matches) {
      const key = `${entry.cl}|${entry.gid ?? '?'}`;
      const cur = seenCount.get(key) || 0;
      if (cur >= 2) continue;
      seenCount.set(key, cur + 1);
      out.push({
        kind: 'text',
        label: entry.text,
        color: clusterColor(entry.cl),
        context: entry.subName || entry.clusterName,
        cl: entry.cl,
        gid: entry.gid,
        clusterName: entry.clusterName,
      });
      if (out.length >= 20) break;
    }
    return out;
  }

  _searchMatches(q) {
    const parsed = this._parseQuery(q);
    this._lastQuery = parsed;
    if (parsed.kind === 'error') return [];
    if (!parsed.includes.length) return [];
    // When any include term is field-scoped to text:, switch to snippet
    // search over post bodies. Skips the metadata index entirely.
    if (parsed.includes.some(t => t.field === 'text') && this._textCorpus) {
      return this._matchTextCorpus(parsed);
    }
    // Plain query (no field scope): search topic metadata AND post-body
    // snippets. Any token ≥2 chars (or any regex token) triggers snippet
    // search once the text corpus is loaded; shorter inputs stay metadata-only.
    const plainPhrase =
      parsed.includes.length > 0 &&
      !parsed.includes.some(t => t.field) &&
      parsed.kind !== 'error' &&
      parsed.includes.some(t =>
        t.kind === 'regex' ||
        (t.display && String(t.display).length >= 2)
      );
    if (plainPhrase && !this._textCorpus && !this._textCorpusFailed) {
      this._ensureTextCorpus?.()?.then?.(() => {
        // Retrigger the active render so the text hits show up when ready.
        const input = document.getElementById('search-input');
        if (input && input.value.trim()) this._onSearchCorpusReady?.();
      });
    }
    const out = [];
    for (const e of this._searchIndex) {
      const hay = (e.label + ' ' + (e.context || '') + ' ' + (e.extra || ''));
      if (!parsed.test(hay, e)) continue;
      let score = 0;
      for (const t of parsed.includes) {
        if (t.kind === 'substr') {
          const ql = t.low;
          if (e.label.toLowerCase().startsWith(ql)) score += 100;
          else if (e.label.toLowerCase().split(/\s+/).some(w => w.startsWith(ql))) score += 60;
          else score += 20;
        } else {
          score += t.test(e.label) ? 70 : 25;
        }
        if (t.field) score += 30;
      }
      score -= e.label.length * 0.01;
      out.push({ ...e, score });
    }
    out.sort((a, b) => b.score - a.score);
    const capped = [];
    const caps = { subreddit: 4, cluster: 5, sub: 6, position: 8, gridcell: 8, ngram: 5, text: 12 };
    const counts = { subreddit: 0, cluster: 0, sub: 0, position: 0, gridcell: 0, ngram: 0, text: 0 };
    for (const h of out) {
      if (counts[h.kind] >= caps[h.kind]) continue;
      capped.push(h); counts[h.kind]++;
    }
    // Fold in post-body matches for plain queries (see plainPhrase above).
    if (plainPhrase && this._textCorpus) {
      const textHits = this._matchTextCorpus(parsed);
      // _matchTextCorpus already returns sub/cluster chips at the top + text
      // snippets below. Keep just the `text` snippets — the metadata
      // matches above already cover the sub/cluster side.
      for (const h of textHits) {
        if (h.kind !== 'text') continue;
        if (counts.text >= caps.text) break;
        capped.push(h); counts.text++;
      }
    }
    // Ngram augmentation keyed off first include term, skipped when the user
    // field-scoped to a non-ngram kind (e.g. sub:rent shouldn't surface ngrams).
    const primary = parsed.includes[0];
    const onlyFieldScopedToNonNgram = parsed.includes.every(t => t.field && t.field !== 'ng');
    if (this._ngrams && primary && primary.display && primary.display.length >= 2 && !onlyFieldScopedToNonNgram) {
      for (const n of [2, 3, 1]) {
        const arr = this._ngrams[String(n)] || [];
        let added = 0;
        for (const w of arr) {
          if (w.length < 3) continue;
          let match = false;
          if (primary.kind === 'regex') match = primary.test(w);
          else match = w.startsWith(primary.low) || w.includes(' ' + primary.low);
          // Respect excludes on ngrams too
          if (match && parsed.excludes.length) {
            for (const t of parsed.excludes) {
              if (this._matchTerm(t, { kind: 'ngram' }, w)) { match = false; break; }
            }
          }
          if (match) {
            capped.push({ kind: 'ngram', label: w, color: '#8794ab', context: `${n}-gram`, score: 10 });
            added++;
            if (added >= 3) break;
          }
        }
      }
    }
    return capped.slice(0, 30);
  }

  _escHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // For text snippets: find the first match, clip to a window around it,
  // and highlight every matching term. Differs from _highlight in that it
  // windows around the match and truncates long posts.
  _highlightSnippet(text, parsed) {
    const sources = [];
    for (const t of (parsed?.includes || [])) {
      if (t.re) sources.push(t.re.source);
      else if (t.low) sources.push(t.low.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
    if (!sources.length) return this._escHtml(text.slice(0, 200));
    let re;
    try { re = new RegExp('(' + sources.join('|') + ')', 'gi'); }
    catch (e) { return this._escHtml(text.slice(0, 200)); }
    const firstMatch = text.search(re);
    const pad = 60, maxLen = 240;
    let start = 0, end = Math.min(text.length, maxLen);
    if (firstMatch > pad) {
      start = firstMatch - pad;
      end = Math.min(text.length, start + maxLen);
    }
    let window = text.slice(start, end);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < text.length ? '…' : '';
    // Re-run highlight within the window
    re.lastIndex = 0;
    let out = '', last = 0, m;
    while ((m = re.exec(window)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      out += this._escHtml(window.slice(last, m.index));
      out += `<b class="snip-hit">${this._escHtml(m[0])}</b>`;
      last = m.index + m[0].length;
    }
    out += this._escHtml(window.slice(last));
    return prefix + out + suffix;
  }

  _highlight(label, parsed) {
    if (!parsed || !parsed.includes || !parsed.includes.length) return this._escHtml(label);
    // Build one combined regex from all non-field include terms so every
    // matched token lights up — lets users see which parts of the label
    // hit which part of their query.
    const sources = [];
    for (const t of parsed.includes) {
      if (t.field) continue;
      if (t.re) sources.push(t.re.source);
      else if (t.low) sources.push(t.low.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
    if (sources.length) {
      try {
        const re = new RegExp('(' + sources.join('|') + ')', 'gi');
        let out = '', last = 0, m;
        while ((m = re.exec(label)) !== null) {
          if (m[0].length === 0) { re.lastIndex++; continue; }
          out += this._escHtml(label.slice(last, m.index));
          out += `<b class="search-hit">${this._escHtml(m[0])}</b>`;
          last = m.index + m[0].length;
        }
        out += this._escHtml(label.slice(last));
        return out || this._escHtml(label);
      } catch (e) { return this._escHtml(label); }
    }
    const ql = parsed.low || '';
    if (!ql) return this._escHtml(label);
    const i = label.toLowerCase().indexOf(ql);
    if (i < 0) return this._escHtml(label);
    return this._escHtml(label.slice(0, i)) +
      '<b class="search-hit">' +
      this._escHtml(label.slice(i, i + ql.length)) + '</b>' +
      this._escHtml(label.slice(i + ql.length));
  }

  _applySearchHit(hit, input) {
    if (!hit) return;
    if (hit.kind === 'text') {
      // Find the actual post in the chunk corpus and pin it (white glow + detail card).
      // Falls back to a synthetic snippet card if the post can't be resolved.
      document.getElementById('search-suggestions').classList.add('hidden');
      input.blur();
      const App = window.App;
      if (App?.findPointForSnippet && App?.pinPointByIndex) {
        App.findPointForSnippet(hit.label).then(idx => {
          if (idx >= 0) App.pinPointByIndex(idx);
          else App.showSnippetCard?.(hit);
        }).catch(() => App.showSnippetCard?.(hit));
      } else if (App?.showSnippetCard) {
        App.showSnippetCard(hit);
      }
      return;
    }
    if (hit.kind === 'cluster') {
      this.focus({ cl: hit.cl });
    } else if (hit.kind === 'sub') {
      this.focus({ cl: hit.cl, gid: hit.gid });
    } else if (hit.kind === 'position') {
      // Pass posIdx so the nav, globe highlight, and detail panel all update
      // to position level in one shot. Then rotate to the position's own
      // lat/lon (focus() would otherwise use the subtopic centroid).
      this.focus({ cl: hit.cl, gid: hit.gid, posIdx: hit.posIdx });
      const posDoc = this.state.positionAnchors?.[String(hit.gid)];
      const pos = posDoc?.positions?.[hit.posIdx];
      if (pos?.lat != null && window.App?.globe) {
        setTimeout(() => window.App.globe.rotateTo(pos.lat, pos.lon, 1.5), 80);
      }
    } else if (hit.kind === 'subreddit') {
      // Fire the same toggle path the focus-card "where it lives" labels use,
      // so the chip + intersection logic run. Fall back to direct globe call
      // if the hook isn't available.
      if (window.App?.toggleSubredditFilter) {
        window.App.toggleSubredditFilter(hit.srId, hit.label.replace(/^r\//, ''), this.focusCl, this.focusGid);
      } else if (window.App?.globe?.setSubredditHighlight) {
        window.App.globe.setSubredditHighlight(new Set([hit.srId]));
      }
    } else if (hit.kind === 'gridcell') {
      if (hit.gid != null) this.focus({ cl: hit.cl, gid: hit.gid });
      else this.focus({ cl: hit.cl });
    } else if (hit.kind === 'ngram') {
      // Per-post spotlight: scan all chunks and light up only points whose
      // post text actually contains this phrase.
      input.value = hit.label;
      document.getElementById('search-suggestions').classList.add('hidden');
      input.blur();
      this._runSpotlightSearch(hit.label);
      return;
    }
    // When the user came from a text: query, preserve their search input
    // — overwriting it with the clicked region's name destroys the query
    // they might want to re-run or tweak after landing.
    const isTextMode = this._lastQuery?.includes?.some(t => t.field === 'text');
    if (!isTextMode && hit.kind !== 'gridcell') input.value = hit.label;
    document.getElementById('search-suggestions').classList.add('hidden');
    input.blur();
  }

  renderBreadcrumbs() {
    const el = this.breadcrumbs;
    el.innerHTML = '';
    // Hide entirely when nothing is focused — at the wide-globe level
    // there's no "current topic" to label, and an empty breadcrumb just
    // wastes vertical space above the bars. Toggling .is-empty animates
    // the height collapse via CSS so the layout doesn't snap.
    const hasFocus = this.focusCl != null;
    el.classList.toggle('is-empty', !hasFocus);
    if (!hasFocus) return;

    // Mutual-hover: crumb ↔ bar segment by key. "Key" mirrors what _renderStack writes to dataset.key.
    const linkCrumb = (crumbEl, stackEl, key) => {
      if (!stackEl || key == null) return;
      crumbEl.addEventListener('mouseenter', () => {
        const seg = stackEl.querySelector(`.bar-seg[data-key="${key}"]`);
        if (seg) seg.classList.add('link-hover');
      });
      crumbEl.addEventListener('mouseleave', () => {
        const seg = stackEl.querySelector(`.bar-seg[data-key="${key}"]`);
        if (seg) seg.classList.remove('link-hover');
      });
    };

    // Leading "Exploring" label so it reads as a sentence in the header.
    const lab = document.createElement('span');
    lab.className = 'crumb-label';
    lab.textContent = 'Exploring';
    el.appendChild(lab);

    // Root crumb — clicking jumps back to the whole globe.
    const all = document.createElement('div');
    all.className = 'crumb crumb-root';
    all.textContent = 'All topics';
    all.onclick = () => this.focus({});
    el.appendChild(all);

    if (this.focusCl != null) {
      const sep1 = document.createElement('span'); sep1.className = 'sep'; sep1.textContent = '›';
      el.appendChild(sep1);
      const meta = this.state.clusterMeta[String(this.focusCl)];
      const c = document.createElement('div');
      c.className = 'crumb' + (this.focusGid == null ? ' active' : '');
      c.style.color = clusterColor(this.focusCl);
      c.style.borderLeftColor = clusterColor(this.focusCl);
      c.textContent = meta ? meta.name : `Topic ${this.focusCl}`;
      c.onclick = () => this.focus({ cl: this.focusCl });
      el.appendChild(c);
      linkCrumb(c, this.stackL1, String(this.focusCl));
    }
    if (this.focusGid != null) {
      const sep2 = document.createElement('span'); sep2.className = 'sep'; sep2.textContent = '›';
      el.appendChild(sep2);
      const sub = this.subGidMap.byGid[this.focusGid];
      const s = document.createElement('div');
      s.className = 'crumb' + (this.focusPosIdx == null ? ' active' : '');
      s.style.borderLeftColor = clusterColor(this.focusCl);
      s.textContent = sub ? sub.name : `Sub ${this.focusGid}`;
      s.onclick = () => this.focus({ cl: this.focusCl, gid: this.focusGid });
      el.appendChild(s);
      if (sub) linkCrumb(s, this.stackL2, `${sub.cl}_${sub.sub}`);
    }
    if (this.focusPosIdx != null) {
      const sep3 = document.createElement('span'); sep3.className = 'sep'; sep3.textContent = '›';
      el.appendChild(sep3);
      const posDoc = this.positionsDoc?.[String(this.focusGid)];
      const pos = posDoc?.positions?.[this.focusPosIdx];
      const p = document.createElement('div');
      p.className = 'crumb active';
      p.style.borderLeftColor = clusterColor(this.focusCl);
      p.textContent = pos?.name || `Position ${this.focusPosIdx}`;
      el.appendChild(p);
    }
  }

  // Trend label — relative to corpus growth. Without normalizing, this
  // corpus's own 2.2× growth over the window leaves nearly every cluster
  // flagged ▲ and the marker becomes noise. 1.35×/0.65× of the corpus
  // ratio matches the thresholds used in main.js getTrendInfo.
  _trendFromSeries(s) {
    if (!s || s.length < 12) return '';
    const n = s.length;
    const rc = s.slice(n - 6).reduce((a, v) => a + v, 0) / 6;
    const bs = s.slice(0, n - 6).reduce((a, v) => a + v, 0) / (n - 6);
    const rel = (rc / Math.max(0.8, bs)) / (window.App?._corpusRatio || 1);
    return rel >= 1.35 ? 'up' : rel <= 0.65 ? 'down' : '';
  }

  renderL1() {
    const byCl = this.state.timeHist?.by_cluster;
    this._renderStack(this.stackL1, this.l1Data.list, (d) => ({
      key: d.cl,
      color: d.color,
      label: d.name,
      pct: d.pct,
      count: d.count,
      trend: byCl ? this._trendFromSeries(byCl[String(d.cl)]) : '',
      active: this.focusCl === d.cl,
      // Clicking the already-focused cluster zooms back out to the full
      // globe level (L1 only, no drill).
      onClick: () => {
        if (this.focusCl === d.cl) this.focus({});
        else this.focus({ cl: d.cl });
      },
      hover: { cl: d.cl },
    }));
  }

  renderL2(cl) {
    const summ = summarizeSubs(this.state, cl, this.subGidMap);
    this._l2Summary = summ;
    this.colL2.classList.remove('collapsed');
    const base = clusterColor(cl);
    const byGid = this.state.timeHist?.by_sub_gid;
    this._renderStack(this.stackL2, summ.list, (d, i, arr) => {
      // Shades of the cluster color by rank
      const factor = 1.3 - 0.6 * (i / Math.max(1, arr.length - 1));
      return {
        key: `${d.cl}_${d.sub}`,
        color: shadeColor(base, factor),
        label: d.name,
        pct: d.pct,
        count: d.count,
        trend: byGid ? this._trendFromSeries(byGid[String(d.gid)]) : '',
        active: this.focusGid === d.gid,
        // Clicking the focused subtopic zooms back out to cluster level.
        onClick: () => {
          if (this.focusGid === d.gid) this.focus({ cl: d.cl });
          else this.focus({ cl: d.cl, gid: d.gid });
        },
        hover: { cl: d.cl, gid: d.gid },
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
    // Counts from the point-level position assignments — every point in
    // this subcluster has been tagged with exactly one position (or 255
    // for "unassigned"). Falls back to the LLM's example-samples length
    // if the per-point assignment bin isn't loaded.
    let pointCounts = null;
    const st = this.state;
    if (st.positionAssignments && st.cluster && st.subLocal) {
      pointCounts = new Uint32Array(doc.positions.length);
      const pa = st.positionAssignments;
      const cluster = st.cluster, subLocal = st.subLocal;
      const N = cluster.length;
      for (let i = 0; i < N; i++) {
        if (cluster[i] !== sub.cl || subLocal[i] !== sub.sub) continue;
        const p = pa[i];
        if (p < pointCounts.length) pointCounts[p]++;
      }
    }
    const items = doc.positions.map((p, i) => ({
      name: p.name,
      description: p.description || '',
      idx: i,
      count: pointCounts
        ? pointCounts[i]
        : (p.example_sample_indices || []).length,
    }));
    const total = items.reduce((s, d) => s + Math.max(1, d.count), 0);
    for (const d of items) d.pct = Math.max(1, d.count) / total;
    items.sort((a,b) => b.count - a.count);
    const base = clusterColor(sub.cl);
    this._l3Items = items;
    const pth = this.state.positionTimeHist?.by_position;
    this._renderStack(this.stackL3, items, (d, i, arr) => {
      const factor = 1.5 - 0.7 * (i / Math.max(1, arr.length - 1));
      // Prefer the sentence-form description over the noun-phrase name,
      // so the L3 column reads as actual stances rather than headlines.
      return {
        key: `${gid}_${d.idx}`,
        color: shadeColor(base, factor),
        label: d.description || d.name,
        pct: d.pct,
        count: d.count,
        trend: this._trendFromSeries(pth?.[`${gid}:${d.idx}`]),
        active: this.focusPosIdx === d.idx,
        onClick: () => {
          if (this.focusPosIdx === d.idx) this.focus({ cl: sub.cl, gid });
          else this.focus({ cl: sub.cl, gid, posIdx: d.idx });
        },
        hover: { cl: sub.cl, gid, posIdx: d.idx },
      };
    }, { keepRibbon: true });
  }

  // ─── Nav-bar hover → globe point highlight ─────────────────────
  _onSegHover(info) {
    const globe = window.App?.globe;
    if (!globe || !info?.hover) return;
    // Debounce re-entries with a short timer so quickly sliding across
    // adjacent segments doesn't thrash the globe shader.
    clearTimeout(this._hoverHighlightTimer);
    this._hoverHighlightTimer = setTimeout(() => {
      globe.setHighlight(info.hover);
    }, 30);
  }
  _onSegUnhover() {
    const globe = window.App?.globe;
    if (!globe) return;
    clearTimeout(this._hoverHighlightTimer);
    this._hoverHighlightTimer = setTimeout(() => {
      // Revert to the currently-focused selection (or clear if unfocused).
      globe.setHighlight({
        cl: this.focusCl,
        gid: this.focusGid,
        posIdx: this.focusPosIdx,
      });
    }, 80);
  }

  _renderStack(stackEl, data, mapper, opts = {}) {
    if (!data || data.length === 0) {
      // Fade out and remove whatever was there.
      for (const seg of Array.from(stackEl.children)) {
        if (!seg.classList?.contains('bar-seg')) continue;
        seg.classList.add('leaving');
        seg.style.opacity = '0';
        setTimeout(() => seg.remove(), 260);
      }
      return;
    }
    const rect = stackEl.getBoundingClientRect();
    const h = rect.height;
    if (h === 0) return;
    const n = data.length;
    const minTotal = n * MIN_SEG_PX + (n - 1) * GAP_PX;
    const sumPct = data.reduce((s, d) => s + d.pct, 0) || 1;
    const fits = minTotal <= h + 4;
    const scale = fits ? (h - minTotal) : 0;
    let maxPct = 0;
    for (const d of data) if (d.pct > maxPct) maxPct = d.pct;
    // Display strings rounded so the visible percentages sum to 100%.
    // Computed once per render (#36) — used everywhere _renderStack paints
    // an "X%" label or aria/title attribute.
    const pctDisplays = formatPctsLargestRemainder(data.map(d => d.pct));

    // Index existing segments by data-key so we can reuse them (letting
    // the CSS top/height/background transitions animate).
    const existing = new Map();
    for (const seg of Array.from(stackEl.children)) {
      if (!seg.classList?.contains('bar-seg')) continue;
      existing.set(seg.dataset.key, seg);
    }

    let y = 0;
    data._layout = [];
    const seenKeys = new Set();
    for (let i = 0; i < n; i++) {
      const d = data[i];
      const span = fits
        ? MIN_SEG_PX + (d.pct / sumPct) * scale
        : MIN_SEG_PX + PROPORTIONAL_BONUS_PX *
            (Math.log(1 + d.pct * 100) / Math.log(1 + maxPct * 100 || 2));
      const info = mapper(d, i, data);
      const key = String(info.key);
      seenKeys.add(key);
      let seg = existing.get(key);
      const isNew = !seg;
      if (isNew) {
        seg = document.createElement('div');
        seg.dataset.key = key;
        seg.style.opacity = '0';
        // Keyboard + screen-reader support: clickable bars need to be
        // Tab-focusable and announce as buttons, otherwise keyboard-only
        // users can't drill in.
        seg.setAttribute('role', 'button');
        seg.setAttribute('tabindex', '0');
        seg.addEventListener('keydown', (e) => {
          const stackId = stackEl.id;
          const isL1 = stackId === 'stack-l1' || stackId === 'col-l1';
          const isL2 = stackId === 'stack-l2' || stackId === 'col-l2';
          const isL3 = stackId === 'stack-l3' || stackId === 'col-l3';

          const cycleWithinStack = () => {
            const segs = [...stackEl.querySelectorAll(':scope > .bar-seg')]
              .filter((s) => !s.classList.contains('leaving'));
            if (!segs.length) return;
            const idx = Math.max(0, segs.indexOf(seg));
            const next = e.shiftKey
              ? (segs[idx - 1] ?? segs[segs.length - 1])
              : (segs[idx + 1] ?? segs[0]);
            next.focus();
          };

          if (e.key === 'Tab' && (isL1 || isL2 || isL3)) {
            if (isL1 && this.focusCl == null) {
              e.preventDefault();
              cycleWithinStack();
              return;
            }
            if (isL1 && this.focusCl != null && !e.shiftKey) {
              e.preventDefault();
              info.onClick?.();
              requestAnimationFrame(() => {
                const next = document.querySelector('#stack-l2 .bar-seg.active, #stack-l2 .bar-seg, #col-l2 .bar-seg.active, #col-l2 .bar-seg');
                next?.focus();
              });
              return;
            }
            if (isL2 || isL3) {
              e.preventDefault();
              cycleWithinStack();
              return;
            }
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            seg.click();
          }
        });
        // Append first so layout matches order on first paint, even if
        // order changed.
        stackEl.appendChild(seg);
        // Next frame: flip to visible so the transition runs.
        requestAnimationFrame(() => { seg.style.opacity = ''; });
      } else {
        seg.classList.remove('leaving');
      }
      seg.className = 'bar-seg' + (info.active ? ' active' : '');
      if (seg.dataset.key !== key) seg.dataset.key = key;
      seg.style.top = `${y}px`;
      seg.style.height = `${span}px`;
      // Clicking a narrow-collapsed column pops focus back to that
      // column's level (unfocus). Only when the column is expanded
      // (open on hover, or actually the active level) does a click
      // drill into that specific segment.
      seg.onclick = (e) => {
        const col = seg.parentElement;
        const isNarrow = col?.classList?.contains('narrow');
        const isOpen   = col?.classList?.contains('open');
        if (isNarrow && !isOpen) {
          if (col.id === 'col-l1') this.focus({});
          else if (col.id === 'col-l2') this.focus({ cl: this.focusCl });
          else if (col.id === 'col-l3') this.focus({ cl: this.focusCl, gid: this.focusGid });
          return;
        }
        info.onClick?.();
      };
      // Hover → highlight on the globe; leave → restore the active focus.
      seg.onmouseenter = () => this._onSegHover(info);
      seg.onmouseleave = () => this._onSegUnhover();
      const pctDisplay = pctDisplays[i] || '';
      if (span < MIN_LABEL_PX) {
        const countStr = info.count != null ? ` · ${info.count.toLocaleString()} posts` : '';
        const pctStr = info.pct != null && pctDisplay ? ` · ${pctDisplay}` : '';
        seg.title = `${info.label}${countStr}${pctStr}`;
      } else {
        seg.removeAttribute('title');
      }

      // Rebuild inner DOM only on first mount or when label/color change.
      const needInner = isNew
        || seg.dataset.label !== info.label
        || seg.dataset.color !== info.color
        || seg.dataset.trend !== (info.trend || '');
      if (needInner) {
        const pctTxt = info.pct != null && pctDisplay ? `, ${pctDisplay} of parent` : '';
        seg.setAttribute('aria-label', `${info.label}${pctTxt}`);
        seg.innerHTML = '';
        const bg = document.createElement('div');
        bg.className = 'bg';
        bg.style.background = info.color;
        seg.appendChild(bg);
        if (span >= MIN_LABEL_PX) {
          const label = document.createElement('div');
          label.className = 'label' + (span >= 36 ? ' two-line' : '');
          label.textContent = info.label;
          seg.appendChild(label);
          const pct = document.createElement('div');
          pct.className = 'pct';
          pct.textContent = pctDisplay;
          seg.appendChild(pct);
        }
        // Trend-arrow badges removed per user request (they were adding
        // visual noise on top of the colored stripes).
        seg.dataset.label = info.label;
        seg.dataset.color = info.color;
        seg.dataset.trend = info.trend || '';
      } else {
        // Update the two-line class + pct text in place so label-height
        // changes don't reset inner DOM.
        const labelEl = seg.querySelector('.label');
        if (labelEl) labelEl.classList.toggle('two-line', span >= 36);
        const pctEl = seg.querySelector('.pct');
        if (pctEl && info.pct != null) {
          pctEl.textContent = pctDisplay;
        }
      }

      data._layout.push({ y, span, key: info.key, color: info.color, data: d });
      y += span + GAP_PX;
    }
    // Remove segments whose keys no longer appear — fade out, then drop.
    for (const [key, seg] of existing) {
      if (seenKeys.has(key)) continue;
      seg.classList.add('leaving');
      seg.style.opacity = '0';
      setTimeout(() => seg.remove(), 260);
    }
    stackEl.style.setProperty('--content-h', `${y}px`);
    // Auto-scroll to active segment right after layout so focusing a
    // cluster that lives far down the list actually brings it on-screen.
    // This runs synchronously — calling from focus() via rAF raced with
    // the renderL1 → innerHTML wipe which resets scrollTop to 0.
    const activeSeg = stackEl.querySelector('.bar-seg.active');
    if (activeSeg) {
      const segTop = parseFloat(activeSeg.style.top) || 0;
      const segH = parseFloat(activeSeg.style.height) || 0;
      const windowH = stackEl.clientHeight;
      if (segTop + segH > windowH || segTop < 0) {
        stackEl.scrollTop = Math.max(0, segTop + segH / 2 - windowH / 2);
      }
    }
  }

  focus({ cl = null, gid = null, posIdx = null } = {}) {
    // Clear any active regex/text paint when the user drills into a
    // specific cluster/sub/position — intersecting a paint set with a
    // single focus commonly leaves an empty-bright globe (if the focused
    // cluster wasn't in the paint set). Clearing makes "drill in" the
    // dominant intent; user can re-run the search to repaint.
    if (cl != null && window.App?.globe?._multiHighlightActive) {
      this._clearRegexPaint?.();
    }
    // Same logic for per-post spotlight: navigating to a topic should
    // override the phrase filter, otherwise position clicks after a phrase
    // search produce empty intersections that look like "nothing happened".
    if (cl != null && window.App?.globe?._spotlightActive) {
      this._clearSpotlight?.();
    }
    this.focusCl = cl;
    this.focusGid = gid;
    this.focusPosIdx = posIdx;
    // Mirror drill state into the cross-module store so non-owners can
    // read store.get().drill instead of reaching into the NavController.
    try { store.set({ drill: { cl, gid, posIdx } }); } catch {}
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
    // Non-active levels collapse to a narrow colored strip — CSS hover
    // re-expands them and widens the whole sidebar via :has(). Keeps the
    // current-level column wide enough to read without ellipsis.
    const l3Visible = gid != null && !this.colL3.classList.contains('collapsed');
    this.colL1.classList.toggle('narrow', cl != null);
    this.colL2.classList.toggle('narrow', l3Visible);
    // Clear any hover-open state left over from a previous interaction
    // so the sidebar snaps to the new focus width immediately rather
    // than waiting for the cursor to leave.
    if (this._hoverCloseTimer) { clearTimeout(this._hoverCloseTimer); this._hoverCloseTimer = null; }
    for (const c of document.querySelectorAll('.bar-column.narrow.open')) c.classList.remove('open');
    document.getElementById('nav')?.classList.remove('nav-narrow-open');
    // Narrow-column titles stay as generic level labels ("Topics",
    // "Subtopics", "Points of view"). The dynamic focused topic name —
    // previously crammed sideways into the rotated label and hard to
    // read — now lives in the horizontal breadcrumb above the bars
    // (see renderBreadcrumbs).
    const t1 = document.getElementById('title-l1');
    const t2 = document.getElementById('title-l2');
    const t3 = document.getElementById('title-l3');
    if (t1) t1.textContent = t1.dataset.default || 'Topics';
    if (t2) t2.textContent = t2.dataset.default || 'Subtopics';
    if (t3) t3.textContent = t3.dataset.default || 'Points of view';
    this._applyFade();
    this.renderBreadcrumbs();
    requestAnimationFrame(() => {
      this.drawRibbons();
      this._scrollActiveIntoView();
    });
    // Toggling .narrow changes the flex layout; bar-seg bounding rects may
    // not settle until after the next layout pass. Redraw ribbons a few
    // times over ~120ms to catch the settled positions.
    for (const d of [40, 90, 160]) setTimeout(() => this.drawRibbons(), d);
    this.dispatchEvent(new CustomEvent('focus', { detail: { cl, gid, posIdx } }));
  }

  // When drilled, scroll each stack so its active segment is visible. The
  // stacks grow far beyond the container in scroll mode, so without this
  // the focused cluster/sub/position can sit thousands of pixels offscreen.
  _scrollActiveIntoView() {
    const scrollTo = (stack, key) => {
      if (!stack || !key) return;
      const seg = stack.querySelector(`.bar-seg[data-key="${CSS.escape(String(key))}"]`);
      if (!seg) return;
      const segTop = parseFloat(seg.style.top) || 0;
      const segH = parseFloat(seg.style.height) || 0;
      const windowH = stack.clientHeight;
      const target = Math.max(0, segTop + segH / 2 - windowH / 2);
      // Direct assignment — scrollTo({behavior: 'smooth'}) silently no-ops
      // under prefers-reduced-motion, which we honor elsewhere.
      stack.scrollTop = target;
    };
    if (this.focusCl != null) scrollTo(this.stackL1, String(this.focusCl));
    if (this.focusGid != null) {
      const g = this.subGidMap.byGid[this.focusGid];
      if (g) scrollTo(this.stackL2, `${g.cl}_${g.sub}`);
    }
    if (this.focusPosIdx != null && this.focusGid != null) {
      scrollTo(this.stackL3, `${this.focusGid}_${this.focusPosIdx}`);
    }
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

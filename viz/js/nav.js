// Stacked-bar navigation (L1 clusters → L2 subtopics → L3 points of view)
// with Sankey-style ribbons connecting parent segments to their children.

import { clusterColor, shadeColor, summarizeClusters, summarizeSubs, buildSubGidMap } from './data.js';
import { storage } from './core/storage.js';
import { keys } from './core/keys.js';
import { overlayManager } from './core/overlays.js';
import { store } from './core/store.js';
import { highlightSearchHits } from './features/html-utils.js';
import { setVisibilityTiers, clearVisibilityTiers } from './features/visibility-tiers.js';
import {
  BAR_SEG_FLOOR_PX,
  BAR_SEG_LABEL_MIN_PX,
  BAR_SEG_TWO_LINE_PX,
  BAR_SEG_GAP_PX,
  BAR_SEG_PROPORTIONAL_BONUS_PX,
} from './core/constants.js';

// Stacked-bar geometry comes from constants.js (#31): every segment is at
// least BAR_SEG_FLOOR_PX tall (one label line + tiny margins) so labels
// stay legible, and the remainder of the column is distributed
// proportionally to each segment's pct share. Topics with bigger %
// genuinely look bigger; tiny ones don't disappear.
const MIN_SEG_PX = BAR_SEG_FLOOR_PX;
const MIN_LABEL_PX = BAR_SEG_LABEL_MIN_PX;
const GAP_PX = BAR_SEG_GAP_PX;
const PROPORTIONAL_BONUS_PX = BAR_SEG_PROPORTIONAL_BONUS_PX;

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
    this._updateColumnTitles();

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
    this._initBackChips();
    this._maybeShowIntroToast();
  }

  _maybeShowIntroToast() {
    // Only show on the very first visit; suppressed after dismiss or once
    // the shortcuts sheet (? ) has been opened.
    if (storage.get('intro-seen') === '1' || storage.get('help-seen') === '1') return;
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
        helpHidden: true,
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

  // Back-chip on L2 / L3 column headers: pop one drill level. L2 → topics,
  // L3 → subtopics. Hidden when the column is in narrow mode (CSS).
  _initBackChips() {
    const b2 = document.getElementById('back-l2');
    const b3 = document.getElementById('back-l3');
    if (b2) b2.addEventListener('click', (e) => {
      e.stopPropagation();
      this.focus({});
    });
    if (b3) b3.addEventListener('click', (e) => {
      e.stopPropagation();
      this.focus({ cl: this.focusCl });
    });
  }

  _initGlobalShortcuts() {
    // ─── Escape cascade ─────────────────────────────────────────────
    //
    //   250 — shortcuts sheet (help-overlay.js).
    //   200 — tour (tour/index.js + noop below while overlay visible).
    //   100 — overlayManager.closeTop() (e.g. other modal overlays).
    //     4 — full reset via App.resetAll() (main.js): topics, filters,
    //         scattershot, timeline UI, cards, zoom — disabled during tour.
    //
    // Search box still clears on Esc from its own keydown handler.

    // Tour (priority 200). Esc is intentionally a no-op while the tour
    // overlay is up — Skip is the only way out.
    keys.bind({
      keys: ['Escape'], priority: 200, label: 'esc-tour-noop',
      helpHidden: true,
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
    // which closes the most recently opened closeOnEsc overlay (shortcuts sheet).
    keys.bind({
      keys: ['Escape'], priority: 100, label: 'esc-overlay-closeTop',
      helpHidden: true,
      allowInInput: true,
      handler: (e) => {
        if (!overlayManager.closeTop()) return false;
        e.preventDefault();
        return true;
      },
    });

    // ─── Top-level shortcuts (priority 20) ──────────────────────────
    keys.bind({
      keys: ['/'], priority: 20, label: 'focus-search',
      helpLabel: 'Focus the search box', helpGroup: 'search',
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
      keys: ['t'], priority: 20, label: 'toggle-timeline',
      helpLabel: 'Toggle the timeline scrubber', helpGroup: 'view',
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
      helpLabel: 'Surprise me: jump to a random well-supported stance',
      helpGroup: 'navigate',
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
      helpLabel: 'Reset everything: drill, filters, search, zoom',
      helpGroup: 'view',
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
    // Default placeholder hints at the quoted-phrase escape so users
    // discover that `mass ave` and `"mass ave"` differ. _updateSearchPlaceholder
    // (called on focus changes) swaps in a scope-aware version once drilled.
    input.placeholder = 'Search (use quotes for exact phrase)';
    input.setAttribute('aria-label', 'Search (use quotes for exact phrase)');

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
      const groups = { cluster: [], sub: [], subreddit: [] };
      for (const e of (this._searchIndex || [])) {
        if (groups[e.kind]) groups[e.kind].push(e);
      }
      if (!groups.cluster.length && !groups.sub.length && !groups.subreddit.length) {
        return renderHistory();
      }
      // Empty-state directory mirrors the typed-state ordering minus n-grams
      // (which require a query to make sense). No "points of view" — those
      // were intentionally dropped from the dropdown alongside post snippets.
      const order = ['cluster', 'sub', 'subreddit'];
      const kindLabel = { cluster: 'topics', sub: 'subtopics', subreddit: 'subreddits' };
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

    // Pseudo-hit kind for the always-on top row: "Search for {query}" runs the
    // same per-post spotlight as the Enter key would on a plain phrase.
    const makeLiteralHit = (qTrim) => ({ kind: 'literal', label: qTrim });

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
      const hits = this._searchMatches(qTrim);
      this._currentSearchHits = hits;
      // No auto-paint while typing — globe only changes when the user
      // explicitly clicks a result (literal, cluster, sub, phrase, …).
      const parsed = this._lastQuery;
      input.classList.toggle('regex-mode', parsed && parsed.kind === 'regex');
      input.classList.toggle('regex-error', parsed && parsed.kind === 'error');
      if (parsed && parsed.kind === 'error') {
        suggestions.innerHTML = `<div class="sugg-item"><span class="sugg-text" style="color:#ff8a8a; font-style:italic;">invalid regex: ${this._escHtml(parsed.error)}</span></div>`;
        suggestions.classList.remove('hidden');
        return;
      }
      // The literal-search row is ALWAYS the first entry, even before any
      // backend matches resolve — clicking it (or pressing Enter on it) runs
      // the same per-post regex/substring spotlight as Enter on a plain query.
      const literal = makeLiteralHit(qTrim);
      // Reordered groups: ngrams (phrases by frequency) → topic → subtopic
      // → subreddit. `position`, `gridcell`, and `text` (post snippets) are
      // intentionally dropped from the dropdown: positions/sentiment cells
      // are noise here, and snippets are visible in the details viewer when
      // a result is clicked.
      const groups = { ngram: [], cluster: [], sub: [], subreddit: [] };
      for (const h of hits) {
        if (groups[h.kind]) groups[h.kind].push(h);
      }
      const kindLabel = {
        ngram: 'phrases', cluster: 'topics', sub: 'subtopics', subreddit: 'subreddits',
      };
      const kindChip = {
        ngram: 'phrase', cluster: 'topic', sub: 'subtopic', subreddit: 'subreddit',
      };
      const kindHint = {
        ngram: 'Click to paint every post containing this phrase on the globe',
        cluster: 'Click to drill into this topic in the sidebar',
        sub: 'Click to drill into this subtopic in the sidebar',
        subreddit: 'Click to filter posts to this subreddit',
      };
      const parts = [];
      // Flattened display-order array — keyboard nav + click both index into
      // this so visual order matches selection order.
      const displayOrdered = [];
      const hasScoped = parsed.includes.some(t => t.field) || parsed.excludes.length > 0;
      const visibleKinds = new Set(['ngram', 'cluster', 'sub', 'subreddit']);
      if (parsed.kind === 'regex' || hasScoped) {
        const fmt = (t) => {
          const body = t.kind === 'regex' ? `/${this._escHtml(t.display)}/` : this._escHtml(t.display);
          return `${t.field ? t.field + ':' : ''}${body}`;
        };
        const bits = [
          ...parsed.includes.map(fmt),
          ...parsed.excludes.map(t => '−' + fmt(t)),
        ];
        const visible = hits.filter(h => visibleKinds.has(h.kind));
        const subCount = visible.filter(h => h.kind === 'sub' || h.kind === 'cluster').length;
        const paintHint = subCount >= 2
          ? ` <span class="sugg-paint-hint"><kbd>⇧↵</kbd> paint ${subCount} on globe</span>`
          : '';
        parts.push(`<div class="sugg-mode-hint">${bits.join(' · ')} · ${visible.length} match${visible.length===1?'':'es'}${paintHint}</div>`);
      }
      // Always-on literal-search row — sits above any matched suggestions and
      // runs the same per-post spotlight as Enter on a plain phrase.
      {
        const i = displayOrdered.length;
        displayOrdered.push(literal);
        parts.push(`
          <div class="sugg-group">
            <div class="sugg-item sugg-item-literal" data-idx="${i}">
              <span class="sugg-literal-glyph" aria-hidden="true">🔍</span>
              <span class="sugg-text">Search for <code class="sugg-literal-q">${this._escHtml(qTrim)}</code></span>
              <span class="sugg-type-chip sugg-type-literal" title="Spotlight every post matching this exact text">search</span>
            </div>
          </div>`);
      }
      // Scope hint: when the user is drilled and metadata search returned no
      // chips, show a single small note so the dropdown doesn't appear silent
      // (Change 1). The literal row above still works — it'll spotlight
      // points inside the active scope.
      const nonLiteralHitCount = hits.length;
      if (this._hasSearchScope() && nonLiteralHitCount === 0) {
        const lbl = this._scopeLabel();
        parts.push(`<div class="sugg-mode-hint" style="background:rgba(255,255,255,0.03); color:var(--fg-mute);">No suggestions match in <b>${this._escHtml(lbl)}</b> — press <kbd>↵</kbd> to search posts inside this scope, or <kbd>Esc</kbd> to clear.</div>`);
      }
      // Reordered: ngram → cluster → sub → subreddit.
      const order = ['ngram', 'cluster', 'sub', 'subreddit'];
      for (const k of order) {
        if (groups[k].length === 0) continue;
        const titleClass = k === 'ngram' ? 'sugg-group-title sugg-group-title--paintable' : 'sugg-group-title';
        parts.push(`<div class="sugg-group"><div class="${titleClass}">${kindLabel[k]}</div>`);
        for (const h of groups[k]) {
          const dotColor = h.color || '#7cf0c9';
          const i = displayOrdered.length;
          displayOrdered.push(h);
          const chipText = kindChip[k] || k;
          const chipTitle = kindHint[k] || '';
          const typeChip = `<span class="sugg-type-chip sugg-type-${k}" title="${this._escHtml(chipTitle)}">${this._escHtml(chipText)}</span>`;
          parts.push(`
            <div class="sugg-item" data-idx="${i}">
              <span class="sugg-dot" style="background:${dotColor}; color:${dotColor}"></span>
              <span class="sugg-text">${this._highlight(h.label, parsed)}</span>
              ${typeChip}
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
      currentMatches = displayOrdered;
      // Default selection: the literal-search row (index 0). Pressing Enter
      // without arrowing runs the literal spotlight, matching the user's
      // intuition that "Enter searches for what I typed".
      activeIdx = displayOrdered.length > 0 ? 0 : -1;
      suggestions.querySelectorAll('.sugg-item').forEach(el => {
        const idx = +el.dataset.idx;
        el.onclick = () => this._applySearchHit(currentMatches[idx], input);
        el.onmouseenter = () => { activeIdx = idx; updateActive(); };
      });
      updateActive();
    };

    // Debounced render: each keystroke previously rebuilt the suggestion DOM
    // synchronously (parsing the query, scoring the index of ~1k–5k entries,
    // emitting innerHTML for up to ~50 rows). Fast typing thrashed layout and
    // made the input feel laggy on the deployed site. Coalesce keystrokes
    // arriving within ~90ms; the trailing edge fires render() with the latest
    // value. Empty input still routes through renderAll synchronously so the
    // browse dropdown opens instantly on focus.
    let _renderDebounceTimer = null;
    const _scheduleRender = (val) => {
      if (_renderDebounceTimer != null) clearTimeout(_renderDebounceTimer);
      _renderDebounceTimer = setTimeout(() => {
        _renderDebounceTimer = null;
        render(val);
      }, 90);
    };
    input.addEventListener('input', () => {
      const v = input.value;
      // Empty input: clear immediately (no debounce) so the dropdown vanishes
      // / browse-all reappears the instant the user wipes the box.
      if (!v.trim()) {
        if (_renderDebounceTimer != null) { clearTimeout(_renderDebounceTimer); _renderDebounceTimer = null; }
        render(v);
        return;
      }
      _scheduleRender(v);
    });
    const showDropdown = () => {
      // Drop any pending debounced render: focus/click should always paint
      // immediately, never get out-raced by a stale 90ms-old keystroke.
      if (_renderDebounceTimer != null) { clearTimeout(_renderDebounceTimer); _renderDebounceTimer = null; }
      if (input.value) { render(input.value); return; }
      // Empty focus / click: show a browsable directory of all clusters/
      // subtopics/positions so the search box doubles as a table of contents.
      renderAll();
    };
    input.addEventListener('focus', showDropdown);
    // Clicking back into an already-focused input (e.g. after dismissing the
    // dropdown via Esc) doesn't re-fire `focus`, so wire `click` too —
    // ensures the suggestions reappear whenever the user clicks the box.
    input.addEventListener('click', showDropdown);
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

      // Flush any pending debounced render before reading currentMatches —
      // otherwise pressing Enter immediately after typing reads a stale
      // suggestion list (the debounce timer fires after the Enter handler).
      if (_renderDebounceTimer != null) {
        clearTimeout(_renderDebounceTimer);
        _renderDebounceTimer = null;
        render(input.value);
      }
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

      // Literal-search row (always present at index 0 when there is input):
      // run the per-post spotlight on the raw query — same as the prior
      // "plain phrase + user hasn't arrowed" path, but explicit.
      if (sel && sel.kind === 'literal') {
        pushHist(input.value);
        suggestions.classList.add('hidden');
        input.blur();
        this._runSpotlightSearch(qTrim);
        e.preventDefault();
        return;
      }

      const parsed = this._lastQuery;
      const hasMultiKinds = currentMatches.some(m =>
        m.kind === 'sub' || m.kind === 'cluster');

      // Shift+Enter paints the union of sub/cluster hits on the globe.
      if (e.shiftKey && hasMultiKinds) {
        this._paintRegexOnGlobe(currentMatches);
        pushHist(input.value);
        e.preventDefault();
        return;
      }

      // Plain text + user hasn't arrowed → spotlight the literal input. The
      // literal row at idx 0 already covers this, but keep the fallback so
      // edge paths (regex with no match selected, etc.) still spotlight.
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
        && hasMultiKinds && currentMatches.filter(m => m.kind !== 'ngram' && m.kind !== 'literal').length > 1;
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
    // Change 2: strip surrounding double-quotes so `"mass ave"` and `mass ave`
    // hit the corpus the same way (findPointsContaining is a literal
    // substring scan and would never match if the quotes were left in).
    let p = String(phrase || '').trim();
    if (p.length >= 2 && p[0] === '"' && p[p.length - 1] === '"') {
      p = p.slice(1, -1).trim();
    }
    if (!p) return;
    this._spotlightToken = (this._spotlightToken || 0) + 1;
    const myToken = this._spotlightToken;
    this._showSpotlightChip(`Indexing posts… 0/${this.state.manifest?.files?.length ?? 22}`, false);
    App.findPointsContaining(p, (done, total) => {
      if (myToken !== this._spotlightToken) return;
      this._showSpotlightChip(`Indexing posts… ${done}/${total}`, false);
    }).then(set => {
      if (myToken !== this._spotlightToken) return;
      // Change 1: when drilled, restrict the spotlight to in-scope points
      // only. Final pass over the result Set keeps findPointsContaining
      // global (no churn in search-find.js).
      let scoped = set;
      const scopeLabel = this._scopeLabel();
      if (this._hasSearchScope()) {
        scoped = new Set();
        for (const i of set) if (this._pointIsInScope(i)) scoped.add(i);
      }
      App.globe.setSpotlight(scoped);
      const n = scoped.size;
      if (n === 0) {
        const where = scopeLabel ? ` in ${scopeLabel}` : '';
        this._showSpotlightChip(`No posts contain "${p}"${where}`, true);
      } else {
        const where = scopeLabel ? ` in ${scopeLabel}` : '';
        this._showSpotlightChip(`${n.toLocaleString()} post${n === 1 ? '' : 's'} mention "${p}"${where}`, true);
      }
      // Frame the densest pocket of hits so a multi-thousand match set
      // lands on its centroid instead of whichever index came first (#49).
      if (n > 0) { try { App.rotateToHitsCentroid?.(scoped); } catch {} }
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

  // ── Search scope (Change 1) ────────────────────────────────────────────
  // When the user has drilled into a cluster / sub / position, every search
  // surface (suggestions dropdown + per-post spotlight) is restricted to
  // that drill scope. The helpers below answer "is point i in scope?" and
  // "is suggestion h in scope?" without rebuilding the search index — the
  // index stays global, scope is applied as a final pass.
  _hasSearchScope() {
    return this.focusCl != null || this.focusGid != null || this.focusPosIdx != null;
  }
  // Short human-readable name of the active drill scope, for chip text.
  _scopeLabel() {
    if (!this._hasSearchScope()) return '';
    if (this.focusGid != null) {
      const g = this.subGidMap.byGid[this.focusGid];
      if (g?.name) return g.name;
    }
    if (this.focusCl != null) {
      return this.state.clusterMeta?.[String(this.focusCl)]?.name || `Topic ${this.focusCl}`;
    }
    return '';
  }
  // Per-point: is global point index `i` inside the active drill?
  _pointIsInScope(i) {
    if (!this._hasSearchScope()) return true;
    const st = this.state;
    if (this.focusCl != null && st.cluster && st.cluster[i] !== this.focusCl) return false;
    if (this.focusGid != null) {
      const g = this.subGidMap.byGid[this.focusGid];
      if (!g) return false;
      // sub matches when the point's local sub label inside its cluster
      // matches the focused gid's sub. cluster check above already covers cl.
      if (st.subLocal && st.subLocal[i] !== g.sub) return false;
    }
    if (this.focusPosIdx != null && st.positionAssignments) {
      // 255 sentinel marks "unassigned" — exclude when scoped to a position.
      if (st.positionAssignments[i] !== this.focusPosIdx) return false;
    }
    return true;
  }
  // Suggestion-row scope test for the dropdown. Topic chips outside the
  // focused cluster (or subtopic outside the focused gid) are pure noise.
  // Subreddits and ngrams use lazily-computed in-scope sets so we don't
  // suggest "r/cambridgema" when the user is drilled into a cluster that
  // has zero cambridgema posts.
  _hitInScope(h) {
    if (!h) return false;
    if (!this._hasSearchScope()) return true;
    if (h.kind === 'literal') return true;
    if (h.kind === 'cluster') {
      return this.focusCl == null || h.cl === this.focusCl;
    }
    if (h.kind === 'sub') {
      if (this.focusCl != null && h.cl !== this.focusCl) return false;
      if (this.focusGid != null && h.gid !== this.focusGid) return false;
      return true;
    }
    if (h.kind === 'position') {
      if (this.focusCl != null && h.cl !== this.focusCl) return false;
      if (this.focusGid != null && h.gid !== this.focusGid) return false;
      if (this.focusPosIdx != null && h.posIdx !== this.focusPosIdx) return false;
      return true;
    }
    if (h.kind === 'gridcell') {
      if (this.focusCl != null && h.cl !== this.focusCl) return false;
      if (this.focusGid != null && h.gid != null && h.gid !== this.focusGid) return false;
      return true;
    }
    if (h.kind === 'subreddit') {
      const s = this._scopeIndex();
      if (!s.inScopeSubreddits) return true;   // not yet computable
      return s.inScopeSubreddits.has(h.srId);
    }
    if (h.kind === 'ngram') {
      // N-gram scope check is best-effort against the small text-corpus
      // sample (3,675 snippets). When the corpus isn't loaded yet we keep
      // the suggestion (graceful degradation) rather than silently dropping
      // it. Inline-anchored substring match keeps it cheap.
      const s = this._scopeIndex();
      if (!s.inScopeTexts) return true;
      const needle = String(h.label || '').toLowerCase();
      if (!needle) return true;
      for (const t of s.inScopeTexts) if (t.includes(needle)) return true;
      return false;
    }
    if (h.kind === 'text') {
      // Text-snippet hit already carries its (cl, gid). Match the same rule
      // as sub/cluster chips.
      if (this.focusCl != null && h.cl !== this.focusCl) return false;
      if (this.focusGid != null && h.gid != null && h.gid !== this.focusGid) return false;
      return true;
    }
    return true;
  }
  // Lazily memoize per-scope index sets used by _hitInScope. Invalidated
  // by _invalidateScopeIndex() inside focus().
  _scopeIndex() {
    if (this._scopeIndexCache) return this._scopeIndexCache;
    const out = { inScopeSubreddits: null, inScopeTexts: null };
    if (!this._hasSearchScope()) {
      this._scopeIndexCache = out;
      return out;
    }
    const st = this.state;
    if (st.subredditAssignments) {
      const sr = new Set();
      const N = st.N | 0;
      for (let i = 0; i < N; i++) {
        if (this._pointIsInScope(i)) sr.add(st.subredditAssignments[i]);
      }
      out.inScopeSubreddits = sr;
    }
    if (this._textCorpus) {
      const arr = [];
      for (const e of this._textCorpus) {
        if (this.focusCl != null && e.cl !== this.focusCl) continue;
        if (this.focusGid != null && e.gid != null && e.gid !== this.focusGid) continue;
        if (this.focusGid != null && e.gid == null) continue;   // unattributed sample → drop when subdrilled
        arr.push(String(e.text || '').toLowerCase());
      }
      out.inScopeTexts = arr;
    }
    this._scopeIndexCache = out;
    return out;
  }
  _invalidateScopeIndex() { this._scopeIndexCache = null; }
  // Update the search input placeholder to show the currently-focused
  // topic/subtopic name (Option A from the spec). Called from focus().
  _updateSearchPlaceholder() {
    const input = document.getElementById('search-input');
    if (!input) return;
    let label = null;
    if (this.focusGid != null) {
      const g = this.subGidMap.byGid[this.focusGid];
      if (g) label = g.name;
    } else if (this.focusCl != null) {
      label = this.state.clusterMeta?.[String(this.focusCl)]?.name || `Topic ${this.focusCl}`;
    }
    const text = label ? `Search inside ${label}` : 'Search (use quotes for exact phrase)';
    input.placeholder = text;
    input.setAttribute('aria-label', text);
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

    // Change 2: a plain multi-word query (no field prefixes, no regex syntax,
    // no exclusions, no embedded quotes) is treated as a single exact-substring
    // match — `mass ave` looks for that literal phrase, not for `mass` AND
    // `ave` independently. Quoted phrases (`"mass ave"`) take the same path.
    // Regex / field-scoped queries (`cl:rent /MBTA/`) keep the old per-token
    // semantics so power-user syntax still composes.
    const isPlainPhrase =
      raw.indexOf(' ') >= 0 &&
      !/["\\]/.test(raw) &&
      !/^[-]/.test(raw) &&
      !/(^|\s)-/.test(raw) &&
      !/(^|\s)(sub|cl|pos|r|ng|text):/i.test(raw) &&
      !/(^|\s)r\//i.test(raw) &&
      !/[\\^$.*+?()[\]{}|/]/.test(raw);
    if (isPlainPhrase) {
      const m = this._makeMatcher(raw);
      if (m.kind !== 'error') {
        const includes = [{ field: null, test: m.test, display: m.display,
                            kind: m.kind, re: m.re, low: m.low, exclude: false }];
        const self = this;
        return {
          kind: 'substr',
          display: raw,
          primaryDisplay: m.display,
          re: m.re || null,
          low: m.low || null,
          includes, excludes: [], hasRegex: false,
          test(hay, entry) {
            for (const t of includes) if (!self._matchTerm(t, entry, hay)) return false;
            return true;
          },
        };
      }
    }

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
    // Final pass: when the user is drilled into a cluster/subtopic/position,
    // drop suggestions that fall outside that scope so the dropdown only
    // shows things actually reachable in the current view (Change 1).
    let scoped = capped;
    if (this._hasSearchScope()) {
      scoped = capped.filter(h => this._hitInScope(h));
    }
    return scoped.slice(0, 30);
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
    // Shared helper renders matched substrings as <b class="search-hit">.
    // Same logic now lives in features/html-utils.js so the pinned view
    // (post body + thread context) can reuse the exact same markup (#4).
    if (parsed && (!parsed.includes || !parsed.includes.length) && parsed.low) {
      // Legacy fallback for callers that pass a parsed query without an
      // `includes` array — synthesize one so the shared helper sees it.
      parsed = { includes: [{ low: parsed.low }] };
    }
    return highlightSearchHits(label, parsed);
  }

  _applySearchHit(hit, input) {
    if (!hit) return;
    if (hit.kind === 'literal') {
      // Always-on top row. Runs the same per-post spotlight search as Enter
      // on a plain phrase: scans every chunk and lights up matching points.
      const phrase = (hit.label || input?.value || '').trim();
      if (!phrase) return;
      document.getElementById('search-suggestions').classList.add('hidden');
      input?.blur?.();
      this._runSpotlightSearch(phrase);
      return;
    }
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
      // Fire the toggleSubredditFilter path so the chip + intersection logic
      // run. Fall back to direct globe call if the hook isn't available.
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

  // Append the current selection per level next to the rotated section
  // title (#30). Replaces the old breadcrumb pill stack — same back-nav
  // affordance, no extra vertical real-estate.
  _updateColumnTitles() {
    const fillTitle = (el, defaultText, currentName, popFn) => {
      if (!el) return;
      el.innerHTML = '';
      const def = document.createElement('span');
      def.className = 'bct-default';
      def.textContent = defaultText;
      el.appendChild(def);
      if (currentName) {
        const sep = document.createElement('span');
        sep.className = 'bct-sep';
        sep.textContent = '▸';
        el.appendChild(sep);
        const cur = document.createElement('span');
        cur.className = 'bct-current';
        cur.textContent = currentName;
        cur.title = currentName;
        cur.setAttribute('role', 'button');
        cur.setAttribute('tabindex', '0');
        cur.addEventListener('click', (e) => { e.stopPropagation(); popFn(); });
        cur.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); popFn(); }
        });
        el.appendChild(cur);
      }
    };
    const t1 = document.getElementById('title-l1');
    const t2 = document.getElementById('title-l2');
    const t3 = document.getElementById('title-l3');
    const clName = this.focusCl != null
      ? (this.state.clusterMeta?.[String(this.focusCl)]?.name || `Topic ${this.focusCl}`)
      : null;
    const sub = this.focusGid != null ? this.subGidMap.byGid[this.focusGid] : null;
    const subName = sub ? sub.name : (this.focusGid != null ? `Sub ${this.focusGid}` : null);
    fillTitle(t1, t1?.dataset.default || 'Topics', clName, () => this.focus({}));
    fillTitle(t2, t2?.dataset.default || 'Subtopics', subName, () => this.focus({ cl: this.focusCl }));
    // L3 ("Points of view") drops the breadcrumb tail — the active stance
    // is already obvious from the highlighted bar segment, and "▸
    // Miscellaneous" was reading as a confusing automatic selection.
    fillTitle(t3, t3?.dataset.default || 'Points of view', null, () => this.focus({ cl: this.focusCl, gid: this.focusGid }));
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

  // ─── Nav-bar hover → globe point highlight (three-tier #34) ─────
  _onSegHover(info) {
    const globe = window.App?.globe;
    if (!globe || !info?.hover) return;
    // Debounce re-entries with a short timer so quickly sliding across
    // adjacent segments doesn't thrash the globe shader.
    clearTimeout(this._hoverHighlightTimer);
    this._hoverHighlightTimer = setTimeout(() => {
      const h = info.hover;
      const level = h.posIdx != null ? 'position' : (h.gid != null ? 'subtopic' : 'topic');
      setVisibilityTiers({ level, scope: h });
    }, 30);
  }
  _onSegUnhover() {
    const globe = window.App?.globe;
    if (!globe) return;
    clearTimeout(this._hoverHighlightTimer);
    this._hoverHighlightTimer = setTimeout(() => {
      // Revert to the currently-focused selection (or clear if unfocused).
      // Drop the dim layer first, then re-apply the focus highlight.
      clearVisibilityTiers();
      const h = {
        cl: this.focusCl,
        gid: this.focusGid,
        posIdx: this.focusPosIdx,
      };
      if (h.cl == null && h.gid == null && h.posIdx == null) {
        globe.setHighlight(h);
      } else {
        const level = h.posIdx != null ? 'position' : (h.gid != null ? 'subtopic' : 'topic');
        setVisibilityTiers({ level, scope: h });
      }
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
      // Fixed-scale row heights: each row is sized by its share, not by
      // the available column height. The column scrolls if total exceeds
      // its visible area. This keeps row heights stable when the user
      // drags the topics ↔ details viewer split.
      // Linear-proportional: a 42% bar reads as ~3.8× a 11% bar, the way
      // the percentages claim (the prior log scale compressed a 3.8× gap
      // down to ~1.3×, which made the bars look near-equal). The MIN_SEG_PX
      // floor keeps tiny percentages legible without flattening the rest.
      const topSpan = MIN_SEG_PX + PROPORTIONAL_BONUS_PX;
      const proportional = topSpan * (d.pct / (maxPct || 1));
      const span = Math.max(MIN_SEG_PX, proportional);
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
      // Mark short segments so CSS can hide the .pct + .bar-trend pieces
      // that don't fit on a single ~14px-tall flex row alongside the
      // label (#45). Threshold matches the two-line cutoff: any seg
      // shorter than that has at most one label line of room.
      const isShort = span < BAR_SEG_TWO_LINE_PX;
      seg.className = 'bar-seg' + (info.active ? ' active' : '') + (isShort ? ' bar-seg--short' : '');
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
      } else if (isShort) {
        // Short segs render the label but CSS hides the .pct + .bar-trend
        // pieces — surface the percent on hover so it's still reachable (#45).
        const pctStr = info.pct != null && pctDisplay ? ` — ${pctDisplay}` : '';
        seg.title = `${info.label}${pctStr}`;
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
          label.className = 'label' + (span >= BAR_SEG_TWO_LINE_PX ? ' two-line' : '');
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
        if (labelEl) labelEl.classList.toggle('two-line', span >= BAR_SEG_TWO_LINE_PX);
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
    // Search scope changed — drop the cached in-scope subreddit/text sets
    // and refresh the placeholder so the input mirrors the new drill.
    this._invalidateScopeIndex?.();
    this._updateSearchPlaceholder?.();
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
    this._updateColumnTitles();
    this._applyFade();
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

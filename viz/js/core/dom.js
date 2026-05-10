// dom — element registry; single source of truth for known DOM IDs.

const KNOWN = {
  // ── overlays ───────────────────────────────────────────────────────
  loading: 'loading',
  loadingMsg: 'loading-msg',
  tourOverlay: 'tour-overlay',
  globeOverlay: 'globe-overlay',
  // tour hero / card
  tourCard: { selector: '.tour-card' },

  // ── globe ──────────────────────────────────────────────────────────
  globeCanvas: 'globe-canvas',
  globeRoot: 'globe-root',
  globeLabels: 'globe-labels',
  pinLabels: 'pin-labels',
  pointTooltip: 'point-tooltip',
  hoverHalo: 'hover-halo',
  sprouts: 'sprouts',
  sproutLines: 'sprout-lines',

  // ── nav / sidebar ──────────────────────────────────────────────────
  nav: 'nav',
  navHeader: 'nav-header',
  navBars: 'nav-bars',
  searchInput: 'search-input',
  searchResults: 'search-results',
  searchSuggestions: 'search-suggestions',
  inspBody: 'insp-body',
  inspEmptyMain: 'insp-empty-main',
  spotlightChip: 'spotlight-chip',
  srFilterChip: 'sr-filter-chip',
  srAgendaPanel: 'sr-agenda-panel',
  regexChip: 'regex-chip',

  // ── chips / dock / hints ───────────────────────────────────────────
  globeControlsDock: 'globe-controls-dock',
  randomHint: 'random-hint',
  surpriseHint: 'surprise-hint',

  // ── HUD buttons ────────────────────────────────────────────────────
  btnLabels: 'btn-labels',
  btnPins: 'btn-pins',
  btnReset: 'btn-reset',
  btnShare: 'btn-share',
  btnSurprise: 'btn-surprise',
  btnVoices: 'btn-voices',

  // ── cards ──────────────────────────────────────────────────────────
  // pinned-view (B1: pinned-comment surface lives in nav, not floating)
  pinnedView: 'pinned-view',
  pvBack: 'pv-back',
  pvForward: 'pv-forward',
  pvThread: 'pv-thread',

  focusCompass: 'focus-compass',

  interviewCard: 'interview-card',
  icClose: 'ic-close',
  icCloseBtn: 'ic-close-btn',

  voicesListInline: 'voices-list-inline',

  // ── timeline ───────────────────────────────────────────────────────
  timelineScrubber: 'timeline-scrubber',
  tlSvg: 'tl-svg',
  tlToggle: 'tl-toggle',
  tlLabel: 'tl-label',
  tlClear: 'tl-clear',
  tlHint: 'tl-hint',
  tlPlay: 'tl-play',
  tlTooltip: 'tl-tooltip',
  tlFilterChip: 'tl-filter-chip',

  // ── tour launcher ──────────────────────────────────────────────────
  tourLauncher: 'tour-launcher',

  // ── misc ───────────────────────────────────────────────────────────
  layoutToggle: 'layout-toggle',
};

const _cache = {};
let _initted = false;

function _resolve(spec) {
  if (typeof spec === 'string') return document.getElementById(spec);
  if (spec && spec.selector) return document.querySelector(spec.selector);
  return null;
}

export const dom = {
  init() {
    _initted = true;
    for (const [name, spec] of Object.entries(KNOWN)) {
      _cache[name] = _resolve(spec);
    }
  },
  el(name) {
    if (!_initted) throw new Error('dom.init() must be called before dom.el()');
    if (!(name in KNOWN)) throw new Error(`Unknown element name: ${name}`);
    let el = _cache[name];
    // Re-resolve on cache miss (element may have been hidden then re-shown,
    // or appended late by feature setup).
    if (!el) {
      el = _resolve(KNOWN[name]);
      _cache[name] = el;
    }
    return el || null;
  },
  query(selector) { return document.querySelector(selector); },
  queryAll(selector) { return Array.from(document.querySelectorAll(selector)); },
  reset() { for (const k in _cache) delete _cache[k]; _initted = false; },
};

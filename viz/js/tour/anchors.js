// anchors — curated dataset choices the tour points at. Beats import from here
// rather than hardcoding indices, so anchors live in one place.
//
// `assertBeatAnchors({ data, log })` runs once at tour init and verifies every
// anchor's live label still contains its `expect` substring. Drift surfaces as
// a console.error + tiny banner — the tour keeps running with the broken
// click rather than blocking boot. (See tour-plan.md Stage 1.4 / pattern P2.)

export const ANCHORS = {
  position: {
    // gid=32 is cl=8 sub=2 (Legal Advice → Lease Terms & Tenant Rights subtopic).
    gid: 32,
    posIdx: 3,
    label: 'Lease Terms & Tenant Rights',
    expect: 'Lease Terms & Tenant Rights',
  },
  search: {
    commentIdx: 240430,
    expect: 'On the Mass Ave',
    kind: 'submission',
  },
};

// ── helpers ──────────────────────────────────────────────────────────

function norm(s) {
  return String(s || '').toLowerCase().trim();
}

function checkBodyContains(state, commentIdx, expect, key) {
  // Returns one of: { ok: true } | { ok: false, reason, found } | { deferred: true }
  if (!state) return { ok: false, reason: 'no-state', found: null };
  const manifest = state.manifest;
  if (!manifest || !Array.isArray(manifest.files)) {
    return { ok: false, reason: 'no-manifest', found: null };
  }
  const cs = manifest.chunkSize;
  if (!Number.isInteger(commentIdx) || commentIdx < 0
      || commentIdx >= manifest.totalPoints) {
    return { ok: false, reason: 'idx-out-of-range', found: null };
  }
  const ci = Math.floor(commentIdx / cs);
  // Only inspect chunks already in the cache — never trigger a fetch from
  // an init-time assertion. Chunks load lazily when the user actually clicks
  // their region; if a relevant chunk hasn't streamed in yet we defer.
  if (!state.chunkCache || !state.chunkCache.has(ci)) {
    return { deferred: true };
  }
  const cached = state.chunkCache.get(ci);
  // Cache stores promises. If the promise is still pending we can't read
  // synchronously — defer rather than block boot on the resolver.
  if (!cached || typeof cached.then !== 'function') {
    return { deferred: true };
  }
  // Synchronous peek: attach a then to surface the result later.
  return { async: cached.then((c) => {
    if (!c) return { ok: false, reason: 'chunk-empty', found: null };
    const j = commentIdx - c.offset;
    const body = (c.panel_body && c.panel_body[j])
      || (c.hover_body && c.hover_body[j])
      || (c.title && c.title[j])
      || '';
    if (!body) return { ok: false, reason: 'no-body', found: '' };
    if (norm(body).includes(norm(expect))) return { ok: true };
    return { ok: false, reason: 'mismatch', found: String(body).slice(0, 200) };
  }, () => ({ ok: false, reason: 'chunk-fetch-failed', found: null })) };
}

function checkPositionLabel(state, gid, posIdx, expect) {
  if (!state) return { ok: false, reason: 'no-state', found: null };
  const doc = state.positionAnchors?.[String(gid)];
  if (!doc) return { ok: false, reason: 'no-position-doc', found: null };
  const positions = doc.positions || [];
  const entry = positions.find((p) => p.idx === posIdx) || positions[posIdx];
  if (!entry) return { ok: false, reason: 'no-position-entry', found: null };
  const name = entry.name || '';
  if (norm(name).includes(norm(expect))) return { ok: true };
  return { ok: false, reason: 'mismatch', found: name };
}

function showBanner(message) {
  // Tiny, idempotent banner pinned to the bottom-right inside <body>. Avoids
  // restructuring the tour overlay or runner. Auto-styled inline so it works
  // even before tour CSS attaches.
  try {
    let el = document.getElementById('tour-anchor-drift-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tour-anchor-drift-banner';
      el.setAttribute('role', 'alert');
      Object.assign(el.style, {
        position: 'fixed',
        right: '12px',
        bottom: '12px',
        zIndex: '99999',
        padding: '8px 12px',
        background: '#3a0e0e',
        color: '#ffd0d0',
        border: '1px solid #d04848',
        borderRadius: '6px',
        font: '12px/1.3 system-ui, sans-serif',
        maxWidth: '320px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
      });
      document.body.appendChild(el);
    }
    el.textContent = message;
  } catch (_) { /* DOM may be unavailable in tests */ }
}

export function assertBeatAnchors({ data, log = console } = {}) {
  const state = data || (typeof window !== 'undefined' && window.App?.state) || null;
  const failures = [];
  const deferred = [];

  // position — label lookup (synchronous; the table is loaded with state)
  {
    const a = ANCHORS.position;
    const r = checkPositionLabel(state, a.gid, a.posIdx, a.expect);
    if (!r.ok) failures.push({ key: 'position', expected: a.expect,
      found: r.found, reason: r.reason, idx: `gid=${a.gid} posIdx=${a.posIdx}` });
  }

  // search — body lookup
  {
    const a = ANCHORS.search;
    const r = checkBodyContains(state, a.commentIdx, a.expect, 'search');
    if (r.deferred) deferred.push('search');
    else if (r.async) r.async.then((res) => {
      if (!res.ok) {
        log.error('[tour] anchor drift', { key: 'search', expected: a.expect,
          found: res.found, reason: res.reason, idx: a.commentIdx });
        showBanner('Tour anchor mismatch — see console');
      }
    });
    else if (!r.ok) failures.push({ key: 'search', expected: a.expect,
      found: r.found, reason: r.reason, idx: a.commentIdx });
  }

  if (deferred.length) {
    for (const k of deferred) {
      log.info?.(`[tour] anchor check deferred (chunk not loaded): ${k}`);
    }
  }

  if (failures.length) {
    log.error('[tour] anchor drift', failures);
    showBanner('Tour anchor mismatch — see console');
  }

  return { failures, deferred };
}

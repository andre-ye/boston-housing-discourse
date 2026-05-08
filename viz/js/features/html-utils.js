// Tiny shared HTML helpers used by every feature module.

export function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/**
 * Wrap matches of the active search query in `<b class="search-hit">…</b>`.
 * `parsed` is the same shape NavController emits as `_lastQuery` (with
 * `includes: [{re?, low?, field?}, …]`). Falls back to escapeHtml when no
 * search is active or no usable terms are present. Mirrors the nav
 * suggestions list so users see hits in the pinned view too (#4).
 */
export function highlightSearchHits(text, parsed) {
  const safe = escapeHtml(text);
  if (!parsed || !parsed.includes || !parsed.includes.length) return safe;
  const sources = [];
  for (const t of parsed.includes) {
    if (t.field) continue;
    if (t.re) sources.push(t.re.source);
    else if (t.low) sources.push(t.low.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  }
  if (!sources.length) return safe;
  let re;
  try { re = new RegExp('(' + sources.join('|') + ')', 'gi'); }
  catch { return safe; }
  let out = '', last = 0, m;
  const s = String(text || '');
  while ((m = re.exec(s)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    out += escapeHtml(s.slice(last, m.index));
    out += `<b class="search-hit">${escapeHtml(m[0])}</b>`;
    last = m.index + m[0].length;
  }
  out += escapeHtml(s.slice(last));
  return out || safe;
}

/** Read the active parsed search query from the NavController, if any. */
export function getActiveSearchParsed() {
  return window.App?.nav?._lastQuery || null;
}

/** Signed net score on the meta line (display only). */
export function redditScoreInlineHtml(score) {
  if (score == null || score === '') return '';
  const n = typeof score === 'number' ? score : +score;
  if (Number.isNaN(n)) return '';
  const t = Math.trunc(n);
  const cls = t > 0 ? 'is-positive' : (t < 0 ? 'is-negative' : 'is-zero');
  const text = t > 0 ? `+${t}` : String(t);
  return `<span class="reddit-score-inline ${cls}" title="Reddit score" aria-label="Score ${t}">${escapeHtml(text)}</span>`;
}

/** Meta strip label for Reddit items — post vs. comment is not shown; always "Thread". */
export function formatRedditKindLabel(_type) {
  return 'Thread';
}

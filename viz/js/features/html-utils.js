// Tiny shared HTML helpers used by every feature module.

export function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
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

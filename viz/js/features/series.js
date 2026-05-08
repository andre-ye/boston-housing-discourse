// series — trend math + per-series accessors (cluster/sub/position).

// Recent-window mean over all-time mean, normalized by corpus growth so
// "trending" means faster than the overall conversation, not just newer.
export function computeTrend(series, windowMonths = 6) {
  if (!series || series.length < windowMonths * 2) return null;
  const n = series.length;
  const recentSum = series.slice(n - windowMonths).reduce((s, v) => s + v, 0);
  const historicalSum = series.slice(0, n - windowMonths).reduce((s, v) => s + v, 0);
  const recent = recentSum / windowMonths;
  const baseline = historicalSum / (n - windowMonths);
  const ratio = recent / Math.max(0.8, baseline);
  const rel = ratio / (window.App?._corpusRatio || 1);
  return { ratio, rel, recent, baseline };
}

export function renderTrendBadge(series) {
  const t = computeTrend(series);
  if (!t) return '';
  const corpus = (window.App?._corpusRatio || 1).toFixed(2);
  const fmt = (n) => n.toFixed(n < 10 ? 1 : 0);
  if (t.rel >= 1.80) return `<span class="trend-badge surging" title="${fmt(t.ratio)}× historical avg — ${t.rel.toFixed(1)}× the corpus's own ${corpus}× growth">▲ surging</span>`;
  if (t.rel >= 1.35) return `<span class="trend-badge trending" title="${fmt(t.ratio)}× historical avg — ${t.rel.toFixed(1)}× the corpus's own ${corpus}× growth">▲ trending</span>`;
  if (t.rel <= 0.65) return `<span class="trend-badge fading" title="${fmt(t.ratio)}× historical avg — ${t.rel.toFixed(1)}× the corpus's own ${corpus}× growth">▼ fading</span>`;
  return '';
}

export function getSubSeries(gid) {
  return window.App?.state?.timeHist?.by_sub_gid?.[String(gid)];
}

export function getClusterSeries(cl) {
  return window.App?.state?.timeHist?.by_cluster?.[String(cl)];
}

export function getPositionSeries(gid, posIdx) {
  return window.App?.state?.positionTimeHist?.by_position?.[`${gid}:${posIdx}`];
}

// Relative trend — ratio of recent/base normalized by corpus growth.
// Returns { ratio, rel, dir } where dir is 'up' | 'down' | ''.
// Every callsite should use this; raw ratios drift with corpus growth.
export function getTrendInfo(series) {
  if (!series || series.length < 12) return { ratio: 1, rel: 1, dir: '' };
  const n = series.length;
  const rc = series.slice(n - 6).reduce((a, v) => a + v, 0) / 6;
  const bs = series.slice(0, n - 6).reduce((a, v) => a + v, 0) / (n - 6);
  const ratio = rc / Math.max(0.8, bs);
  const rel = ratio / (window.App?._corpusRatio || 1);
  const dir = rel >= 1.35 ? 'up' : rel <= 0.65 ? 'down' : '';
  return { ratio, rel, dir };
}

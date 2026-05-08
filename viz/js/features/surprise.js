// Surprise Me: drop the user at a random, well-supported position.
// Weights by sqrt(count) so larger stances dominate but small surprising
// ones still appear. Honors active timeline + subreddit filters and
// down-weights recently-shown clusters so the next pick rarely repeats.

import { getTrendInfo, getPositionSeries } from './series.js';

export function init(ctx) {
  const { App, nav, store, focusPosition, getActiveSubredditFilter } = ctx;
  const btnSurprise = document.getElementById('btn-surprise');
  let _inSurpriseMode = false;
  if (btnSurprise) {
    const _surpriseRecent = [];
    function trendRatio(series) {
      return getTrendInfo(series).rel;
    }
    const _surpriseRecentClusters = [];
    function pickSurprise() {
      const anchors = App.state.positionAnchors || {};
      const candidates = [];
      const mr = store.get().filters.monthRange;
      const hasTimeFilter = !!mr;
      const srId = getActiveSubredditFilter()?.id ?? null;
      const posSubTable = App._posSubTable;
      const clusterPenalty = new Map();
      for (const cl of _surpriseRecentClusters) {
        clusterPenalty.set(cl, (clusterPenalty.get(cl) || 1) * 0.55);
      }
      for (const [gidStr, doc] of Object.entries(anchors)) {
        const gid = +gidStr;
        const subSeries = App.state?.timeHist?.by_sub_gid?.[String(gid)];
        const subRatio = trendRatio(subSeries);
        (doc.positions || []).forEach((p, idx) => {
          if (p.lat == null || !p.count || p.count < 40) return;
          const key = `${gid}:${idx}`;
          if (_surpriseRecent.includes(key)) return;
          const posSeries = getPositionSeries(gid, idx);
          const ratio = posSeries ? trendRatio(posSeries) : subRatio;
          const boost = Math.max(0.5, Math.min(2.5, ratio));
          let weight = p.count;
          if (hasTimeFilter && posSeries) {
            let inRange = 0;
            for (let m = mr.lo; m <= mr.hi && m < posSeries.length; m++) inRange += posSeries[m] || 0;
            if (inRange < 5) return;
            weight = inRange;
          }
          if (srId != null && posSubTable) {
            const m = posSubTable.get((gid << 8) | idx);
            const nSr = m ? (m.get(srId) || 0) : 0;
            if (nSr < 5) return;
            weight = nSr;
          }
          const clDamp = clusterPenalty.get(doc.cl) || 1;
          candidates.push({ cl: doc.cl, gid, posIdx: idx, w: Math.sqrt(weight) * boost * clDamp });
        });
      }
      if (candidates.length === 0) return;
      const total = candidates.reduce((s, c) => s + c.w, 0);
      let r = Math.random() * total;
      let pick = candidates[0];
      for (const c of candidates) { r -= c.w; if (r <= 0) { pick = c; break; } }
      _surpriseRecent.push(`${pick.gid}:${pick.posIdx}`);
      if (_surpriseRecent.length > 10) _surpriseRecent.shift();
      _surpriseRecentClusters.push(pick.cl);
      if (_surpriseRecentClusters.length > 4) _surpriseRecentClusters.shift();
      _inSurpriseMode = true;
      nav.focus({ cl: pick.cl, gid: pick.gid });
      setTimeout(() => {
        focusPosition(pick.cl, pick.gid, pick.posIdx);
      }, 250);
      btnSurprise.classList.add('flashing');
      setTimeout(() => btnSurprise.classList.remove('flashing'), 600);
    }
    btnSurprise.onclick = pickSurprise;

    nav.addEventListener('focus', (ev) => {
      const recent = _surpriseRecent[_surpriseRecent.length - 1];
      if (recent) {
        const [gRecent] = recent.split(':').map(Number);
        if (ev.detail.gid !== gRecent) _inSurpriseMode = false;
      } else { _inSurpriseMode = false; }
    });
  }

  // Wire the clickable surprise hint (top-right of globe) to synthesize
  // the same keydown the nav controller listens for.
  const hint = document.getElementById('surprise-hint');
  if (hint) {
    const trigger = (e) => {
      e?.preventDefault?.();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    };
    hint.addEventListener('click', trigger);
    hint.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') trigger(e);
    });
  }
}

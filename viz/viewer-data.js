// Shared data loader for experimental viewers (viewer2+).
// Streams the tsne_chunks/* files and aggregates per-subcluster metrics
// used by topic-centric visualizations.
//
// Usage:
//   const agg = await ViewerData.loadSubAggregates({
//     onProgress: (loaded, total) => { ... },
//     withSamples: true,
//     sampleReservoir: 8,
//   });
//   agg.subs, agg.subs[gid].postHist, agg.clusterNames, agg.months, etc.
//
// To remove: delete this file + the `<script src="viewer-data.js">` tags
// in viewer2-6; each viewer would need its own inline loader (see git history
// of viewer2.html for the original self-contained version).
(function (global) {
  'use strict';

  const BASE = "tsne_chunks";

  async function fetchJson(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error("failed " + path);
    return r.json();
  }

  // Session cache for aggregated data — keeps repeat navigations fast.
  // Not user-visible; just stores the aggregation so each viewer doesn't
  // re-download 440MB of chunks on every page load.
  const CACHE_KEY = "boston-reddit-aggregates-v2";
  const CACHE_VERSION = 2;

  function tryLoadCache() {
    try {
      const s = sessionStorage.getItem(CACHE_KEY);
      if (!s) return null;
      const obj = JSON.parse(s);
      if (!obj || obj.version !== CACHE_VERSION) return null;
      // Rehydrate typed arrays
      const subs = new Array(obj.subs.length);
      for (let i = 0; i < obj.subs.length; i++) {
        const r = obj.subs[i];
        if (!r) { subs[i] = null; continue; }
        subs[i] = {
          gid: r.gid, cl: r.cl, sub: r.sub, name: r.name,
          postN: r.postN, commN: r.commN, total: r.total, scoreSum: r.scoreSum,
          postHist: new Int32Array(r.postHist),
          commHist: new Int32Array(r.commHist),
          samples: r.samples || null,
          ratio: r.ratio, avgScore: r.avgScore,
          peakMonth: r.peakMonth, peakN: r.peakN, concentration: r.concentration,
          topSubreddits: r.topSubreddits || []
        };
      }
      return { ...obj, subs };
    } catch (e) {
      return null;
    }
  }

  function trySaveCache(result) {
    try {
      const serializable = {
        version: CACHE_VERSION,
        manifest: result.manifest,
        months: result.months,
        nMonths: result.nMonths,
        nTotal: result.nTotal,
        clusterNames: result.clusterNames,
        subclusterNames: result.subclusterNames,
        subGlobalMap: result.subGlobalMap,
        subTotalK: result.subTotalK,
        subs: result.subs.map(r => r ? {
          gid: r.gid, cl: r.cl, sub: r.sub, name: r.name,
          postN: r.postN, commN: r.commN, total: r.total, scoreSum: r.scoreSum,
          postHist: Array.from(r.postHist),
          commHist: Array.from(r.commHist),
          samples: r.samples,
          ratio: r.ratio, avgScore: r.avgScore,
          peakMonth: r.peakMonth, peakN: r.peakN, concentration: r.concentration,
          topSubreddits: r.topSubreddits
        } : null)
      };
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(serializable));
    } catch (e) {
      // quota exceeded or disallowed — silently skip
    }
  }

  async function loadSubAggregates(opts) {
    opts = opts || {};
    const withSamples = opts.withSamples !== false;
    const reservoir   = opts.sampleReservoir || 8;
    const onProgress  = opts.onProgress || function () {};
    const useCache    = opts.useCache !== false;

    // Fast path: session cache
    if (useCache) {
      const cached = tryLoadCache();
      if (cached) {
        // Signal "done" to any progress listeners
        onProgress(cached.nTotal, cached.nTotal);
        return cached;
      }
    }

    const manifest = await fetchJson(BASE + "/manifest.json");
    const months = manifest.months || [];
    const nMonths = months.length;
    const nTotal = manifest.totalPoints;

    let clusterNames = {};
    try {
      const d = await fetchJson(BASE + "/cluster_labels.json");
      clusterNames = d.embedding || d;
    } catch (e) { /* optional */ }

    let subclusterNames = {};
    let subGlobalMap = {};
    let subTotalK = 0;
    try {
      subclusterNames = await fetchJson(BASE + "/subcluster_labels.json");
      const sortedParents = Object.keys(subclusterNames).map(Number).sort((a, b) => a - b);
      let gid = 0;
      for (const cl of sortedParents) {
        subGlobalMap[cl] = {};
        for (const e of subclusterNames[String(cl)]) subGlobalMap[cl][e.sub] = gid++;
      }
      subTotalK = gid;
    } catch (e) { /* optional */ }

    if (subTotalK === 0) {
      throw new Error("no subcluster data");
    }

    // Allocate aggregate records
    const subs = new Array(subTotalK);
    for (const clStr of Object.keys(subclusterNames)) {
      const cl = parseInt(clStr, 10);
      for (const e of subclusterNames[clStr]) {
        const gid = subGlobalMap[cl][e.sub];
        subs[gid] = {
          gid, cl, sub: e.sub, name: e.name,
          postN: 0, commN: 0, total: 0, scoreSum: 0,
          postHist: new Int32Array(nMonths),
          commHist: new Int32Array(nMonths),
          samples: withSamples ? [] : null,
          // Running tally of subreddit counts. Kept as a small object; after
          // load we prune to the top ~12 so the cache stays compact.
          subrCounts: Object.create(null)
        };
      }
    }

    // Per-point subcluster assignment
    let subAsgn = null;
    try {
      const ad = await fetchJson(BASE + "/subcluster_assignments.json");
      subAsgn = new Uint8Array(ad.data);
    } catch (e) { /* optional */ }
    if (!subAsgn) throw new Error("no subcluster assignments");

    // Stream chunks
    let offset = 0;
    for (let fi = 0; fi < manifest.files.length; fi++) {
      const C = await fetchJson(BASE + "/" + manifest.files[fi]);
      const cn = C.n;
      for (let j = 0; j < cn; j++) {
        const i = offset + j;
        const cl = C.cluster ? (C.cluster[j] | 0) : -1;
        if (cl < 0) continue;
        const sl = subAsgn[i];
        if (sl === 255) continue;
        const map = subGlobalMap[cl];
        if (!map) continue;
        const gid = map[sl];
        if (gid == null) continue;
        const rec = subs[gid];
        if (!rec) continue;
        const m = C.month_idx[j];
        const isPost = C.type[j] === "submission";
        if (isPost) { rec.postN++; rec.postHist[m]++; }
        else        { rec.commN++; rec.commHist[m]++; }
        rec.total++;
        rec.scoreSum += (C.score[j] | 0);
        const _sr = C.subreddit[j];
        if (_sr) rec.subrCounts[_sr] = (rec.subrCounts[_sr] || 0) + 1;
        if (withSamples) {
          if (rec.samples.length < reservoir) {
            rec.samples.push({
              title: C.title[j] || "", permalink: C.permalink[j] || "",
              type: isPost ? "post" : "comment",
              score: C.score[j] | 0, ym: C.year_month[j] || "",
              subreddit: C.subreddit[j] || ""
            });
          } else {
            const r2 = (Math.random() * rec.total) | 0;
            if (r2 < reservoir) {
              rec.samples[r2] = {
                title: C.title[j] || "", permalink: C.permalink[j] || "",
                type: isPost ? "post" : "comment",
                score: C.score[j] | 0, ym: C.year_month[j] || "",
                subreddit: C.subreddit[j] || ""
              };
            }
          }
        }
      }
      offset += cn;
      onProgress(offset, nTotal);
      if (fi % 3 === 2) await new Promise(r => setTimeout(r, 0));
    }

    // Derived metrics
    for (const r of subs) {
      if (!r) continue;
      r.ratio = r.postN / (r.postN + r.commN + 1e-9);
      r.avgScore = r.scoreSum / (r.total + 1e-9);
      let bestM = 0, bestN = -1, sumV = 0;
      for (let m = 0; m < nMonths; m++) {
        const v = r.postHist[m] + r.commHist[m];
        sumV += v;
        if (v > bestN) { bestN = v; bestM = m; }
      }
      r.peakMonth = bestM;
      r.peakN = bestN;
      r.concentration = bestN / (sumV + 1e-9);
      // Prune subreddit counts to top 12 so the cache stays small
      const subrEntries = Object.entries(r.subrCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12);
      r.topSubreddits = subrEntries.map(([name, count]) => ({ name, count }));
      delete r.subrCounts;
    }

    const result = {
      manifest, months, nMonths, nTotal,
      clusterNames, subclusterNames, subGlobalMap, subTotalK,
      subs
    };
    if (useCache) trySaveCache(result);
    return result;
  }

  // Cluster-level aggregation from already-loaded subs
  function aggregateClusters(agg) {
    const { subs, clusterNames, nMonths } = agg;
    const map = new Map();
    for (const r of subs) {
      if (!r) continue;
      let c = map.get(r.cl);
      if (!c) {
        c = {
          cl: r.cl,
          name: (clusterNames[String(r.cl)] || {}).name || ("Cluster " + r.cl),
          postN: 0, commN: 0, total: 0,
          postHist: new Int32Array(nMonths),
          commHist: new Int32Array(nMonths),
          subs: []
        };
        map.set(r.cl, c);
      }
      c.postN += r.postN;
      c.commN += r.commN;
      c.total += r.total;
      for (let m = 0; m < nMonths; m++) {
        c.postHist[m] += r.postHist[m];
        c.commHist[m] += r.commHist[m];
      }
      c.subs.push(r);
    }
    return [...map.values()];
  }

  // Shared cluster palette (must match main index.html / CLUSTER_PALETTE)
  const CLUSTER_PALETTE = [
    "#6ea8ff","#7cf0c9","#ff6b5c","#ffd166","#c084fc",
    "#fb923c","#34d399","#f472b6","#38bdf8","#facc15",
    "#a78bfa","#4ade80","#f87171","#2dd4bf","#fb7185",
    "#a3e635","#e879f9","#60a5fa","#fbbf24","#818cf8",
    "#86efac","#fca5a5","#93c5fd","#d8b4fe","#6ee7b7",
  ];
  function clusterColor(c) { return CLUSTER_PALETTE[((c % 25) + 25) % 25]; }

  function escapeHtml(s) {
    return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ── Full-point loader ────────────────────────────────────────────────
  //
  // Unlike loadSubAggregates (which only keeps per-subcluster aggregates),
  // this loader retains every point's title / permalink / subreddit / score /
  // type / month / cluster / sub so callers can drill all the way down to
  // individual threads and comments. The result is NOT cached in
  // sessionStorage — the per-point arrays are too big (~35MB) to fit.
  async function loadPointsAndAggregates(opts) {
    opts = opts || {};
    const onProgress = opts.onProgress || function () {};
    const skipPanelBody = opts.skipPanelBody !== false;  // default: skip body text to save memory

    const manifest = await fetchJson(BASE + "/manifest.json");
    const months = manifest.months || [];
    const nMonths = months.length;
    const nTotal = manifest.totalPoints;

    // Cluster / subcluster metadata (same as the aggregate loader)
    let clusterNames = {};
    try {
      const d = await fetchJson(BASE + "/cluster_labels.json");
      clusterNames = d.embedding || d;
    } catch (e) {}

    let subclusterNames = {};
    let subGlobalMap = {};
    let subTotalK = 0;
    try {
      subclusterNames = await fetchJson(BASE + "/subcluster_labels.json");
      const sortedParents = Object.keys(subclusterNames).map(Number).sort((a, b) => a - b);
      let gid = 0;
      for (const cl of sortedParents) {
        subGlobalMap[cl] = {};
        for (const e of subclusterNames[String(cl)]) subGlobalMap[cl][e.sub] = gid++;
      }
      subTotalK = gid;
    } catch (e) {}
    if (subTotalK === 0) throw new Error("no subcluster data");

    // Aggregate records (same shape as loadSubAggregates output)
    const subs = new Array(subTotalK);
    for (const clStr of Object.keys(subclusterNames)) {
      const cl = parseInt(clStr, 10);
      for (const e of subclusterNames[clStr]) {
        const gid = subGlobalMap[cl][e.sub];
        subs[gid] = {
          gid, cl, sub: e.sub, name: e.name,
          postN: 0, commN: 0, total: 0, scoreSum: 0,
          postHist: new Int32Array(nMonths),
          commHist: new Int32Array(nMonths),
          samples: null,
          subrCounts: Object.create(null)
        };
      }
    }

    let subAsgn = null;
    try {
      const ad = await fetchJson(BASE + "/subcluster_assignments.json");
      subAsgn = new Uint8Array(ad.data);
    } catch (e) {}
    if (!subAsgn) throw new Error("no subcluster assignments");

    // Per-point typed arrays — allocated up front
    const titles      = new Array(nTotal);
    const bodies      = new Array(nTotal);  // truncated panel_body — used for comment previews
    const permalinks  = new Array(nTotal);
    const subreddits  = new Array(nTotal);
    const typeCode    = new Uint8Array(nTotal);   // 0 post, 1 comment
    const scores      = new Int32Array(nTotal);
    const monthIdx    = new Int16Array(nTotal);
    const clusterIdx  = new Int16Array(nTotal).fill(-1);
    const subGid      = new Int16Array(nTotal).fill(-1);
    const BODY_MAX_CHARS = 220;
    // Reverse index — postId string → indices in that thread
    const postIndex   = new Map();
    // Per-subcluster → array of point indices (for drill-down)
    const subPoints   = new Array(subTotalK);
    for (let i = 0; i < subTotalK; i++) subPoints[i] = [];

    let offset = 0;
    for (let fi = 0; fi < manifest.files.length; fi++) {
      const C = await fetchJson(BASE + "/" + manifest.files[fi]);
      const cn = C.n;
      for (let j = 0; j < cn; j++) {
        const i = offset + j;
        const cl = C.cluster ? (C.cluster[j] | 0) : -1;
        clusterIdx[i] = cl;
        const sl = subAsgn[i];
        const map = (cl >= 0) ? subGlobalMap[cl] : null;
        const gid = (map && sl !== 255) ? map[sl] : undefined;
        if (gid != null) subGid[i] = gid;

        const isPost = C.type[j] === "submission";
        typeCode[i] = isPost ? 0 : 1;
        scores[i]   = C.score[j] | 0;
        monthIdx[i] = C.month_idx[j];
        titles[i]      = C.title[j] || "";
        const _body = C.panel_body ? (C.panel_body[j] || "") : "";
        bodies[i]      = _body.length > BODY_MAX_CHARS ? _body.slice(0, BODY_MAX_CHARS) : _body;
        permalinks[i]  = C.permalink[j] || "";
        subreddits[i]  = C.subreddit[j] || "";

        // Parent post grouping via /comments/<postId>/
        const pl = permalinks[i];
        if (pl) {
          const m = pl.match(/\/comments\/([^/]+)/);
          if (m) {
            const pid = m[1];
            let arr = postIndex.get(pid);
            if (!arr) { arr = []; postIndex.set(pid, arr); }
            arr.push(i);
          }
        }

        // Aggregate update
        if (gid != null) {
          const rec = subs[gid];
          subPoints[gid].push(i);
          const mi = monthIdx[i];
          if (isPost) { rec.postN++; rec.postHist[mi]++; }
          else        { rec.commN++; rec.commHist[mi]++; }
          rec.total++;
          rec.scoreSum += scores[i];
          const _sr = subreddits[i];
          if (_sr) rec.subrCounts[_sr] = (rec.subrCounts[_sr] || 0) + 1;
        }
      }
      offset += cn;
      onProgress(offset, nTotal);
      if (fi % 3 === 2) await new Promise(r => setTimeout(r, 0));
    }

    // Derived metrics
    for (const r of subs) {
      if (!r) continue;
      r.ratio = r.postN / (r.postN + r.commN + 1e-9);
      r.avgScore = r.scoreSum / (r.total + 1e-9);
      let bestM = 0, bestN = -1, sumV = 0;
      for (let m = 0; m < nMonths; m++) {
        const v = r.postHist[m] + r.commHist[m];
        sumV += v;
        if (v > bestN) { bestN = v; bestM = m; }
      }
      r.peakMonth = bestM;
      r.peakN = bestN;
      r.concentration = bestN / (sumV + 1e-9);
      const subrEntries = Object.entries(r.subrCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12);
      r.topSubreddits = subrEntries.map(([name, count]) => ({ name, count }));
      delete r.subrCounts;
    }

    return {
      manifest, months, nMonths, nTotal,
      clusterNames, subclusterNames, subGlobalMap, subTotalK,
      subs,
      points: {
        titles, bodies, permalinks, subreddits,
        typeCode, scores, monthIdx, clusterIdx, subGid,
        postIndex,      // Map<postId, index[]>
        subPoints       // Array<subGid, index[]>
      }
    };
  }

  // Load LLM-generated per-sub position labels.
  // Returns { by_gid: { "<gid>": { sub_name, cluster_name, cl, positions: [...] } } }
  // or null if the file doesn't exist. Never throws — missing positions is fine.
  async function loadPositions() {
    try {
      const r = await fetch(BASE + "/positions.json");
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  global.ViewerData = {
    loadSubAggregates,
    loadPointsAndAggregates,
    loadPositions,
    aggregateClusters,
    CLUSTER_PALETTE,
    clusterColor,
    escapeHtml,
  };
})(window);

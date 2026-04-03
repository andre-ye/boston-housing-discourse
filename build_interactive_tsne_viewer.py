#!/usr/bin/env python3
"""
Build a self-contained HTML viewer: t-SNE 2D scatter, hover + click (opens permalink),
detail panel with text, month slider that highlights one month (dims others).

Data sources:
  --npz          Partial or final embeddings file (ids + embeddings + created_ts)
  --parquet      Metadata join (permalink, title, body, …). Required.

If --npz is omitted, encodes from parquet with sentence-transformers (use CPU while GPU job runs).

For large N, t-SNE is subsampled to --tsne-max-points (deterministic seed) unless --tsne-max-points 0 (all points).
Use --tsne-backend opentsne (or auto for n>25k) with --tsne-pca-dims for full-corpus runs; sklearn t-SNE does not scale to ~500k points.
"""

from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from sklearn.manifold import TSNE
from sentence_transformers import SentenceTransformer


def build_text(row: pd.Series, max_chars: int) -> str:
    parts = []
    if row.get("title"):
        parts.append(str(row["title"]))
    parts.append(str(row.get("body") or ""))
    parts.append(f"[{row.get('type')}] r/{row.get('subreddit')}")
    s = "\n".join(parts).strip()
    if max_chars and len(s) > max_chars:
        s = s[: max_chars - 1] + "…"
    return s


def resolve_device(preferred: str) -> str:
    if preferred != "auto":
        return preferred
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _tsne_subsample(n: int, max_pts: int, seed: int) -> np.ndarray:
    if max_pts <= 0 or n <= max_pts:
        return np.arange(n, dtype=np.int64)
    rng = np.random.default_rng(seed)
    return np.sort(rng.choice(n, size=max_pts, replace=False))


def _run_tsne_2d(
    emb: np.ndarray,
    perplexity: float,
    seed: int,
    backend: str,
    pca_dims: int,
) -> np.ndarray:
    """Return (n, 2) float32. Prefer OpenTSNE for large n; sklearn for small n."""
    n = len(emb)
    perp = float(min(perplexity, max(5.0, (n - 1) / 3.0)))
    if backend == "sklearn" and n > 25_000:
        raise SystemExit(
            "sklearn t-SNE is not practical for n>25000; use --tsne-backend opentsne or --tsne-max-points."
        )
    use_sklearn = backend == "sklearn" or (backend == "auto" and n <= 25_000)
    if use_sklearn:
        xy = TSNE(
            n_components=2,
            perplexity=perp,
            learning_rate="auto",
            init="pca",
            random_state=seed,
        ).fit_transform(emb)
        return np.asarray(xy, dtype=np.float32)
    try:
        from openTSNE import TSNE as OpenTSNE
        from sklearn.decomposition import PCA
    except ImportError as e:
        raise SystemExit(
            "Large-N t-SNE needs openTSNE (pip install openTSNE) or reduce --tsne-max-points."
        ) from e
    x = np.asarray(emb, dtype=np.float64, order="C")
    if pca_dims and x.shape[1] > pca_dims:
        print(f"PCA {x.shape[1]} -> {pca_dims} before OpenTSNE", flush=True)
        x = PCA(n_components=pca_dims, random_state=seed).fit_transform(x)
    print(f"OpenTSNE n={n} perplexity={perp} (this can take a long time)", flush=True)
    xy = OpenTSNE(
        n_components=2,
        perplexity=perp,
        random_state=seed,
        n_jobs=-1,
        verbose=True,
    ).fit(x)
    return np.asarray(xy, dtype=np.float32)


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True)

    ap = argparse.ArgumentParser()
    ap.add_argument("--parquet", type=Path, default=Path("data/reddit_boston_housing.parquet"))
    ap.add_argument("--npz", type=Path, default=None, help="Embeddings checkpoint/final .npz")
    ap.add_argument("--encode-model", default="sentence-transformers/all-MiniLM-L6-v2")
    ap.add_argument("--encode-device", default="cpu", help="Use cpu while a GPU/MPS job runs in parallel")
    ap.add_argument("--batch-size", type=int, default=64)
    ap.add_argument("--max-chars", type=int, default=8000)
    ap.add_argument("--max-encode-rows", type=int, default=0, help="0 = all rows (after NPZ join)")
    ap.add_argument(
        "--tsne-max-points",
        type=int,
        default=25_000,
        help="Subsample size for t-SNE; 0 = use all rows (needs --tsne-backend opentsne or auto for large n).",
    )
    ap.add_argument(
        "--tsne-backend",
        choices=["auto", "sklearn", "opentsne"],
        default="auto",
        help="auto: sklearn if n<=25k else OpenTSNE; opentsne: force OpenTSNE (for full-corpus t-SNE).",
    )
    ap.add_argument(
        "--tsne-pca-dims",
        type=int,
        default=50,
        help="If embedding dim exceeds this, PCA-reduce before OpenTSNE (0 = disable). Speeds large runs.",
    )
    ap.add_argument("--perplexity", type=float, default=30.0)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", type=Path, default=Path("viz/tsne_interactive.html"))
    ap.add_argument(
        "--payload-mode",
        choices=["inline", "external"],
        default="inline",
        help="inline: embed payload JSON in HTML; external: write sidecar JSON and fetch at runtime",
    )
    ap.add_argument(
        "--payload-file",
        default="tsne_payload.json",
        help="Sidecar JSON filename when --payload-mode external",
    )
    args = ap.parse_args()

    need_cols = [
        "id",
        "type",
        "subreddit",
        "created_utc",
        "created_ts",
        "score",
        "title",
        "body",
        "permalink",
    ]
    meta = pd.read_parquet(args.parquet, columns=need_cols)
    meta = meta.drop_duplicates(subset=["id"], keep="last")
    meta["id"] = meta["id"].astype(str)

    if args.npz is not None:
        z = np.load(args.npz, allow_pickle=True)
        ids = z["ids"].astype(str)
        emb = np.asarray(z["embeddings"], dtype=np.float32)
        if len(ids) != len(emb):
            raise ValueError(f"npz ids ({len(ids)}) vs embeddings ({len(emb)}): length mismatch")
        meta_ix = meta.set_index("id", drop=False)
        keep = [i for i, rid in enumerate(ids) if rid in meta_ix.index]
        if len(keep) < len(ids):
            print(f"warning: {len(ids) - len(keep)} ids missing from parquet; dropped", flush=True)
        ids_k = ids[keep]
        emb = emb[keep]
        df = meta_ix.loc[ids_k].reset_index(drop=True)
        df["id"] = ids_k
    else:
        if args.max_encode_rows and len(meta) > args.max_encode_rows:
            meta = meta.sample(n=args.max_encode_rows, random_state=args.seed).reset_index(drop=True)
        df = meta.copy()
        df["text"] = df.apply(lambda r: build_text(r, args.max_chars), axis=1)
        device = resolve_device(args.encode_device)
        print(f"encoding device={device} model={args.encode_model} rows={len(df)}", flush=True)
        model = SentenceTransformer(args.encode_model, device=device)
        texts = df["text"].tolist()
        emb_chunks = []
        for start in range(0, len(texts), args.batch_size):
            batch = texts[start : start + args.batch_size]
            emb_chunks.append(
                model.encode(
                    batch,
                    batch_size=len(batch),
                    show_progress_bar=False,
                    convert_to_numpy=True,
                    normalize_embeddings=True,
                )
            )
        emb = np.vstack(emb_chunks)

    df["created_dt"] = pd.to_datetime(df["created_utc"], utc=True)
    df["year_month"] = df["created_dt"].dt.strftime("%Y-%m")

    n = len(df)
    idx = _tsne_subsample(n, args.tsne_max_points, args.seed)
    emb_s = emb[idx]
    sub = df.iloc[idx].reset_index(drop=True)

    n_s = len(sub)
    perp = min(args.perplexity, max(5, (n_s - 1) // 3))
    print(f"t-SNE n={n_s} perplexity={perp} backend={args.tsne_backend}", flush=True)
    xy = _run_tsne_2d(
        emb_s,
        perplexity=perp,
        seed=args.seed,
        backend=args.tsne_backend,
        pca_dims=args.tsne_pca_dims,
    )

    months = sorted(sub["year_month"].unique().tolist())
    permalinks = sub["permalink"].fillna("").astype(str).tolist()
    titles = sub["title"].fillna("").astype(str).tolist()
    bodies = sub["body"].fillna("").astype(str).tolist()
    subs = sub["subreddit"].fillna("").astype(str).tolist()
    types = sub["type"].fillna("").astype(str).tolist()
    scores = sub["score"].fillna(0).astype(int).tolist()
    ym = sub["year_month"].astype(str).tolist()

    # Keep payload moderate for browser (full text in panel; hover uses shorter strings)
    hover_body = [b[:500] + ("…" if len(b) > 500 else "") for b in bodies]
    panel_body = [b[:12_000] + ("…" if len(b) > 12_000 else "") for b in bodies]

    month_to_idx = {m: i for i, m in enumerate(months)}
    month_idx = [month_to_idx[m] for m in ym]

    payload = {
        "x": [float(x) for x in xy[:, 0]],
        "y": [float(x) for x in xy[:, 1]],
        "year_month": ym,
        "month_idx": month_idx,
        "months": months,
        "permalink": permalinks,
        "title": titles,
        "hover_body": hover_body,
        "panel_body": panel_body,
        "subreddit": subs,
        "type": types,
        "score": scores,
    }

    title_esc = html.escape(f"t-SNE viewer ({n_s} pts)")

    payload_json = json.dumps(payload, ensure_ascii=True)
    payload_json = payload_json.replace("</", "\\u003c/")
    payload_url = args.payload_file
    payload_inline = payload_json if args.payload_mode == "inline" else ""
    # nosemgrep: ignore - we build static HTML from controlled JSON string
    html_doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title_esc}</title>
  <script src="https://cdn.plot.ly/plotly-2.35.2.min.js" charset="utf-8"></script>
  <style>
    :root {{
      --bg: #f6f8fb;
      --panel: #ffffff;
      --line: #dbe2ea;
      --text: #1c2430;
      --muted: #5b6776;
      --accent: #2f6feb;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      margin: 0;
      color: var(--text);
      background: radial-gradient(1200px 700px at 0% 0%, #f2f6ff 0%, var(--bg) 60%);
      display: flex;
      flex-direction: column;
      height: 100vh;
    }}
    header {{
      padding: 10px 14px;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.82);
      backdrop-filter: blur(6px);
    }}
    #main {{ flex: 1; display: flex; min-height: 0; gap: 10px; padding: 10px; }}
    #plotwrap {{
      flex: 2.2;
      min-width: 0;
      min-height: 0;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--panel);
      overflow: hidden;
    }}
    #side {{
      flex: 1;
      min-width: 320px;
      max-width: 520px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--panel);
      display: flex;
      flex-direction: column;
      min-height: 0;
    }}
    #controls {{ padding: 10px 12px; border-bottom: 1px solid #edf1f6; }}
    .control-row {{ margin-bottom: 8px; }}
    .control-row:last-child {{ margin-bottom: 0; }}
    .label {{ display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }}
    .muted {{ color: var(--muted); font-size: 11px; }}
    #monthslider {{ width: 100%; accent-color: var(--accent); }}
    .time-brush {{ position: relative; height: 34px; }}
    .time-brush .track {{
      position: absolute;
      top: 15px;
      left: 0;
      right: 0;
      height: 4px;
      background: #e9eef6;
      border-radius: 999px;
    }}
    .time-brush .fill {{
      position: absolute;
      top: 15px;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(
        90deg,
        #3657C8 0%,
        #2D7FDB 25%,
        #1FA187 50%,
        #9E9D24 75%,
        #D84A3A 100%
      );
      border-radius: 999px;
      pointer-events: none;
      clip-path: inset(0 0 0 0 round 999px);
    }}
    .time-brush input[type="range"] {{
      position: absolute;
      left: 0;
      right: 0;
      top: 6px;
      width: 100%;
      margin: 0;
      background: none;
      pointer-events: none;
      -webkit-appearance: none;
      appearance: none;
    }}
    .time-brush input[type="range"]::-webkit-slider-thumb {{
      -webkit-appearance: none;
      appearance: none;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #ffffff;
      border: 1px solid #6e7c91;
      box-shadow: 0 1px 2px rgba(0,0,0,0.15);
      pointer-events: auto;
      cursor: ew-resize;
    }}
    .time-brush input[type="range"]::-moz-range-thumb {{
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #ffffff;
      border: 1px solid #6e7c91;
      box-shadow: 0 1px 2px rgba(0,0,0,0.15);
      pointer-events: auto;
      cursor: ew-resize;
    }}
    #detail {{
      padding: 12px;
      overflow: auto;
      flex: 1;
      white-space: pre-wrap;
      font-size: 12px;
      line-height: 1.4;
    }}
    #detail .title {{ font-size: 14px; font-weight: 650; margin-bottom: 6px; }}
    #detail .meta {{ color: var(--muted); margin-bottom: 6px; }}
    #detail a.perm {{ font-weight: 600; color: var(--accent); text-decoration: none; }}
    #detail a.perm:hover {{ text-decoration: underline; }}
    #detail .body {{
      display: -webkit-box;
      -webkit-line-clamp: 16;
      line-clamp: 16;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }}
    .tiny {{ font-size: 10px; color: var(--muted); }}
    #unpinBtn {{
      border: 1px solid var(--line);
      background: #fff;
      color: var(--text);
      border-radius: 8px;
      padding: 5px 10px;
      font-size: 12px;
      cursor: pointer;
    }}
    #unpinBtn:disabled {{
      opacity: 0.45;
      cursor: default;
    }}
  </style>
</head>
<body>
  <header>
    <strong>{title_esc}</strong>
  </header>
  <div id="main">
    <div id="plotwrap"><div id="plot" style="width:100%;height:100%;"></div></div>
    <div id="side">
      <div id="controls">
        <div class="control-row">
          <span class="label">Time Brush</span>
          <div class="muted" id="brushLabel"></div>
          <div class="time-brush">
            <div class="track"></div>
            <div class="fill" id="brushFill"></div>
            <input type="range" id="brushStart" min="0" value="0" />
            <input type="range" id="brushEnd" min="0" value="0" />
          </div>
        </div>
        <div class="control-row">
          <label><input type="checkbox" id="showPosts" checked /> Posts</label>
          <label style="margin-left:12px;"><input type="checkbox" id="showComments" checked /> Comments</label>
        </div>
        <div class="control-row">
          <button id="unpinBtn" disabled>Unpin</button>
        </div>
        <div class="tiny">Hover = preview, click = pin. Double-click plot to reset zoom.</div>
      </div>
      <div id="detail">Hover a point to preview.</div>
    </div>
  </div>

  <script id="payload" type="application/json">{payload_inline}</script>
  <script>
  (async function() {{
    let P;
    const payloadEl = document.getElementById('payload');
    const inlineText = (payloadEl && payloadEl.textContent) ? payloadEl.textContent.trim() : '';
    if (inlineText) {{
      P = JSON.parse(inlineText);
    }} else {{
      const resp = await fetch({json.dumps(payload_url)});
      if (!resp.ok) throw new Error('Failed to load payload JSON: ' + resp.status);
      P = await resp.json();
    }}
    const n = P.x.length;
    const months = P.months;
    const brushStart = document.getElementById('brushStart');
    const brushEnd = document.getElementById('brushEnd');
    const brushFill = document.getElementById('brushFill');
    const brushLabel = document.getElementById('brushLabel');
    const showPosts = document.getElementById('showPosts');
    const showComments = document.getElementById('showComments');
    const detail = document.getElementById('detail');
    const unpinBtn = document.getElementById('unpinBtn');

    const maxMonthIdx = Math.max(0, months.length - 1);
    brushStart.max = maxMonthIdx;
    brushEnd.max = maxMonthIdx;
    brushStart.value = '0';
    brushEnd.value = String(maxMonthIdx);
    let brushLo = 0;
    let brushHi = maxMonthIdx;

    function escapeHtml(s) {{
      return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }}

    let pinnedIndex = null;

    function renderDetail(i, mode) {{
      const url = P.permalink[i] || '';
      const title = (P.title[i] || '').trim();
      const body = (P.panel_body[i] || '');
      const modePrefix = mode === 'hover' ? 'Preview' : 'Selected';
      const head = url
        ? '<a class="perm" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(url) + '</a>'
        : '(no link)';
      const meta = '[' + P.type[i] + '] r/' + P.subreddit[i] + ' | score ' + P.score[i] + ' | ' + P.year_month[i];
      detail.innerHTML =
        '<div class="meta">' + modePrefix + '</div>' +
        (title ? '<div class="title">' + escapeHtml(title) + '</div>' : '') +
        '<div class="meta">' + escapeHtml(meta) + '</div>' +
        '<div>' + head + '</div><br>' +
        '<div class="body">' + escapeHtml(body) + '</div>';
    }}

    function isTypeVisible(i) {{
      const t = (P.type[i] || '').toLowerCase();
      if (t === 'submission') return !!showPosts.checked;
      if (t === 'comment') return !!showComments.checked;
      return true;
    }}

    function isTimeVisible(i) {{
      const m = P.month_idx[i];
      return m >= brushLo && m <= brushHi;
    }}

    function refreshBrushUi() {{
      const leftPct = maxMonthIdx === 0 ? 0 : (brushLo / maxMonthIdx) * 100;
      const rightPct = maxMonthIdx === 0 ? 100 : (brushHi / maxMonthIdx) * 100;
      const rightInset = Math.max(0, 100 - rightPct);
      brushFill.style.clipPath = 'inset(0 ' + rightInset + '% 0 ' + leftPct + '% round 999px)';
      const loTxt = months[brushLo] || 'n/a';
      const hiTxt = months[brushHi] || 'n/a';
      brushLabel.textContent = loTxt + '  ->  ' + hiTxt;
    }}

    function computeMarkerStyle() {{
      const hi = 0.68;
      const sm = 5.5;
      const opacity = new Array(n);
      const size = new Array(n);
      for (let i = 0; i < n; i++) {{
        if (!isTypeVisible(i) || !isTimeVisible(i)) {{
          opacity[i] = 0.0;
          size[i] = 0.0;
          continue;
        }}
        opacity[i] = hi;
        size[i] = sm;
      }}
      return {{ opacity, size }};
    }}

    const trace = {{
      type: 'scattergl',
      mode: 'markers',
      x: P.x,
      y: P.y,
      text: P.year_month,
      hovertemplate: '<extra></extra>',
      marker: {{
        size: 6.2,
        opacity: 0.5,
        color: P.month_idx,
        cmin: 0,
        cmax: Math.max(0, months.length - 1),
        colorscale: [
          [0.00, '#3657C8'],
          [0.25, '#2D7FDB'],
          [0.50, '#1FA187'],
          [0.75, '#9E9D24'],
          [1.00, '#D84A3A'],
        ],
        colorbar: {{
          title: '',
          tickmode: 'array',
          tickvals: (months.length > 1 ? [0, Math.floor((months.length - 1) / 2), months.length - 1] : [0]),
          ticktext: (months.length > 1 ? [months[0], months[Math.floor((months.length - 1) / 2)], months[months.length - 1]] : [months[0] || 'n/a']),
          len: 0.68,
          thickness: 11,
        }},
        line: {{ width: 0.2, color: 'rgba(0,0,0,0.20)' }},
      }},
    }};

    const layout = {{
      title: '',
      xaxis: {{ title: '', showgrid: false, zeroline: false, showticklabels: false }},
      yaxis: {{ title: '', showgrid: false, zeroline: false, showticklabels: false }},
      dragmode: 'pan',
      plot_bgcolor: '#ffffff',
      paper_bgcolor: '#ffffff',
      margin: {{ t: 16, r: 12, b: 16, l: 16 }},
    }};
    const config = {{ responsive: true, scrollZoom: true }};

    const gd = document.getElementById('plot');
    Plotly.newPlot(gd, [trace], layout, config);

    function applyFilters() {{
      const s = computeMarkerStyle();
      Plotly.restyle(gd, {{ 'marker.opacity': [s.opacity], 'marker.size': [s.size] }}, [0]);
    }}

    brushStart.addEventListener('input', (e) => {{
      brushLo = Math.min(parseInt(e.target.value, 10) || 0, brushHi);
      brushStart.value = String(brushLo);
      refreshBrushUi();
      applyFilters();
    }});
    brushEnd.addEventListener('input', (e) => {{
      brushHi = Math.max(parseInt(e.target.value, 10) || 0, brushLo);
      brushEnd.value = String(brushHi);
      refreshBrushUi();
      applyFilters();
    }});
    showPosts.addEventListener('change', () => {{
      applyFilters();
    }});
    showComments.addEventListener('change', () => {{
      applyFilters();
    }});

    gd.on('plotly_hover', (ev) => {{
      if (pinnedIndex !== null) return;
      const pt = ev.points[0];
      const i = (pt.pointIndex !== undefined) ? pt.pointIndex : pt.pointNumber;
      renderDetail(i, 'hover');
    }});

    gd.on('plotly_click', (ev) => {{
      const pt = ev.points[0];
      const i = (pt.pointIndex !== undefined) ? pt.pointIndex : pt.pointNumber;
      pinnedIndex = i;
      unpinBtn.disabled = false;
      renderDetail(i, 'selected');
    }});

    gd.on('plotly_doubleclick', () => {{
      pinnedIndex = null;
      unpinBtn.disabled = true;
    }});

    unpinBtn.addEventListener('click', () => {{
      pinnedIndex = null;
      unpinBtn.disabled = true;
      detail.textContent = 'Hover a point to preview.';
    }});

    refreshBrushUi();
    applyFilters();
    window.addEventListener('resize', () => Plotly.Plots.resize(gd));
  }})();
  </script>
</body>
</html>
"""

    args.out.parent.mkdir(parents=True, exist_ok=True)
    if args.payload_mode == "external":
      payload_path = args.out.parent / args.payload_file
      payload_path.write_text(payload_json, encoding="utf-8")
    args.out.write_text(html_doc, encoding="utf-8")
    if args.payload_mode == "external":
      print(f"Wrote {args.out.resolve()} + {(args.out.parent / args.payload_file).resolve()} (points={n_s})", flush=True)
    else:
      print(f"Wrote {args.out.resolve()} (points={n_s})", flush=True)


if __name__ == "__main__":
    main()

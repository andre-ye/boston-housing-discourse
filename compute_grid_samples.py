#!/usr/bin/env python3
"""
Build a grid over the t-SNE map. For each cell with enough points, sample
~25 posts/comments and dump them as text — ready to be summarized into a
single propositional statement by an LLM.

Outputs:
  viz/tsne_chunks/grid_cells_samples.json
    {
      "grid":   {"cell_w": 15.0, "cell_h": 15.0, "x0": -100, "y0": -100,
                 "nx": 14, "ny": 13},
      "cells": [
        { "id": "5_4", "gx": 5, "gy": 4,
          "cx": 12.3, "cy": -8.1,        # cell center in data coords
          "n_total": 412, "n_sample": 25,
          "samples": ["title — body", "title — body", ...] },
        ...
      ]
    }
"""

import json, random
from pathlib import Path
import pandas as pd
import numpy as np

ROOT       = Path(__file__).parent
PARQUET    = ROOT / "data" / "reddit_boston_housing.parquet"
CHUNKS_DIR = ROOT / "viz" / "tsne_chunks"
MANIFEST   = CHUNKS_DIR / "manifest.json"
OUT_FILE   = CHUNKS_DIR / "grid_cells_samples.json"

CELL_W = 15.0   # data-unit width  per cell
CELL_H = 15.0   # data-unit height per cell
SAMPLES_PER_CELL = 25
MIN_POINTS_PER_CELL = 30          # skip sparse cells
MAX_TEXT_LEN = 380                # truncate each sample to keep prompts small

random.seed(42)
np.random.seed(42)

# ── Load manifest extents ─────────────────────────────────────────────────────
manifest = json.load(open(MANIFEST))
xmin, xmax = manifest["extent"]["x"]
ymin, ymax = manifest["extent"]["y"]

# Snap origin so grid lines are stable
x0 = float(np.floor(xmin / CELL_W) * CELL_W)
y0 = float(np.floor(ymin / CELL_H) * CELL_H)
nx = int(np.ceil((xmax - x0) / CELL_W))
ny = int(np.ceil((ymax - y0) / CELL_H))

print(f"Extent: x=[{xmin:.1f}, {xmax:.1f}]  y=[{ymin:.1f}, {ymax:.1f}]")
print(f"Grid:   {nx} x {ny} cells of {CELL_W} x {CELL_H} data units")
print(f"Origin: ({x0}, {y0})")

# ── Load t-SNE coords + text from chunks (faster than re-running parquet+tsne) ─
print("Loading chunks for x/y…")
import glob
chunk_files = sorted(glob.glob(str(CHUNKS_DIR / "chunk_*.json")))
xs, ys, titles, bodies = [], [], [], []
for cf in chunk_files:
    c = json.load(open(cf))
    n = c["n"]
    xs.extend(c["x"])
    ys.extend(c["y"])
    titles.extend(c["title"])
    bodies.extend(c["panel_body"])
xs = np.asarray(xs, dtype=np.float32)
ys = np.asarray(ys, dtype=np.float32)
N = len(xs)
print(f"  loaded {N:,} points")

# ── Bin every point into a grid cell ──────────────────────────────────────────
gxs = np.clip(((xs - x0) / CELL_W).astype(np.int32), 0, nx - 1)
gys = np.clip(((ys - y0) / CELL_H).astype(np.int32), 0, ny - 1)

# Build dict: cell -> list of indices
from collections import defaultdict
cell_pts = defaultdict(list)
for i in range(N):
    cell_pts[(int(gxs[i]), int(gys[i]))].append(i)

print(f"Non-empty cells: {len(cell_pts)} (of {nx*ny} total)")

# ── Build samples per cell ────────────────────────────────────────────────────
def clean_text(t, b):
    title = (t or "").strip()
    body  = (b or "").strip()
    body  = " ".join(body.split())  # collapse whitespace
    if title and body:
        s = f"{title} — {body}"
    elif title:
        s = title
    else:
        s = body
    if len(s) > MAX_TEXT_LEN:
        s = s[:MAX_TEXT_LEN].rstrip() + "…"
    return s

cells_out = []
for (gx, gy), idxs in sorted(cell_pts.items()):
    if len(idxs) < MIN_POINTS_PER_CELL:
        continue
    # uniformly sample from the cell's points
    sample_idx = random.sample(idxs, min(SAMPLES_PER_CELL, len(idxs)))
    samples = [clean_text(titles[i], bodies[i]) for i in sample_idx]
    samples = [s for s in samples if s]  # drop empty
    if len(samples) < 5:
        continue
    cx = x0 + (gx + 0.5) * CELL_W
    cy = y0 + (gy + 0.5) * CELL_H
    cells_out.append({
        "id":       f"{gx}_{gy}",
        "gx":       gx,
        "gy":       gy,
        "cx":       round(cx, 3),
        "cy":       round(cy, 3),
        "n_total":  len(idxs),
        "n_sample": len(samples),
        "samples":  samples,
    })

print(f"Cells with ≥{MIN_POINTS_PER_CELL} points and ≥5 valid samples: {len(cells_out)}")

# Sort cells by density (most populous first) so we can process top-N first
cells_out.sort(key=lambda c: -c["n_total"])

out = {
    "grid": {
        "cell_w": CELL_W, "cell_h": CELL_H,
        "x0": x0, "y0": y0,
        "nx": nx, "ny": ny,
    },
    "cells": cells_out,
}

with open(OUT_FILE, "w") as f:
    json.dump(out, f, separators=(",", ":"))

size_kb = OUT_FILE.stat().st_size // 1024
print(f"\nWritten → {OUT_FILE}  ({size_kb} KB)")
print(f"Top 5 most populous cells:")
for c in cells_out[:5]:
    print(f"  {c['id']:>7s}  ({c['cx']:>7.1f}, {c['cy']:>7.1f})  n={c['n_total']}")

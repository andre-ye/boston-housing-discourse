"""Compute per-grid-cell dominant cluster/sub counts so the front-end can
attribute regex hits in grid_cells_samples.json back to a cluster+sub for
navigation (clicking a text match jumps to its area of the globe).

Reads:
- viz/tsne_chunks/grid_cells_samples.json (cell definitions)
- viz/tsne_chunks/chunk_NNNNN.json (each point's x, y, cluster)

Writes:
- viz/tsne_chunks/grid_cell_clusters.json
  { "<gx>_<gy>": { "dominant_cl": N, "total": K,
                    "top_cls": [[cl, count], ...],
                    "top_sub_gid": G, "top_subs": [[gid, count], ...] } }
"""
from __future__ import annotations
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CHUNKS = ROOT / "viz" / "tsne_chunks"


def main():
    samples = json.loads((CHUNKS / "grid_cells_samples.json").read_text())
    grid = samples["grid"]
    x0, y0 = grid["x0"], grid["y0"]
    cw, ch = grid["cell_w"], grid["cell_h"]
    nx, ny = grid["nx"], grid["ny"]

    # Build (cl, sub) → gid map using the same canonical ordering the viz uses.
    sub_meta = json.loads((CHUNKS / "subcluster_labels.json").read_text())
    gid_of = {}
    gid = 0
    for cl_str in sorted(sub_meta.keys(), key=int):
        cl_i = int(cl_str)
        for e in sub_meta[cl_str]:
            gid_of[(cl_i, e["sub"])] = gid
            gid += 1

    # Pair chunk (x, y) with canonical (cluster, sub) from point_labels.bin;
    # the 'cluster' field is missing from some later chunks, so rely on the
    # bin for both.
    buf = (CHUNKS / "point_labels.bin").read_bytes()
    raw = np.frombuffer(buf, dtype=np.uint8).reshape(-1, 3)
    lo = raw[:, 0].astype(np.int32); hi = raw[:, 1].astype(np.int32)
    cl_all = (hi << 8) | lo
    cl_all = np.where(cl_all >= 0x8000, cl_all - 0x10000, cl_all).astype(np.int16)
    sub_arr = raw[:, 2].astype(np.uint8)

    cell_cl = defaultdict(lambda: defaultdict(int))
    cell_sub = defaultdict(lambda: defaultdict(int))
    total_points = 0

    n_labeled = cl_all.shape[0]
    for chunk_file in sorted(CHUNKS.glob("chunk_*.json")):
        d = json.loads(chunk_file.read_text())
        offset = d["offset"]
        n = d["n"]
        # Skip supplementary chunks that don't align with point_labels.bin
        # (chunks 22+ contain a separate dataset outside the canonical 422k).
        if offset >= n_labeled or "cluster" not in d:
            print(f"  {chunk_file.name}: skipping (offset={offset} outside labels)")
            continue
        xs = d["x"]
        ys = d["y"]
        for i in range(n):
            x, y = xs[i], ys[i]
            gx = int((x - x0) // cw)
            gy = int((y - y0) // ch)
            if not (0 <= gx < nx and 0 <= gy < ny):
                continue
            cell_id = f"{gx}_{gy}"
            idx = offset + i
            cl = int(cl_all[idx])
            cell_cl[cell_id][cl] += 1
            sub_local = int(sub_arr[idx])
            g = gid_of.get((cl, sub_local))
            if g is not None:
                cell_sub[cell_id][g] += 1
        total_points += n
        print(f"  {chunk_file.name}: cum={total_points}")

    out = {}
    for cell_id, counts in cell_cl.items():
        sorted_cls = sorted(counts.items(), key=lambda kv: -kv[1])
        sub_counts = cell_sub.get(cell_id, {})
        sorted_subs = sorted(sub_counts.items(), key=lambda kv: -kv[1])
        out[cell_id] = {
            "dominant_cl": int(sorted_cls[0][0]),
            "total": int(sum(counts.values())),
            "top_cls": [[int(c), int(n)] for c, n in sorted_cls[:3]],
            "top_sub_gid": int(sorted_subs[0][0]) if sorted_subs else None,
            "top_subs": [[int(g), int(n)] for g, n in sorted_subs[:3]],
        }

    path = CHUNKS / "grid_cell_clusters.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Wrote {path} — {path.stat().st_size // 1024} KB, {len(out)} cells")


if __name__ == "__main__":
    main()

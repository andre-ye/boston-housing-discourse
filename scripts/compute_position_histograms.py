"""Bake per-position monthly histograms so the position card's sparkline
can show that specific stance's temporal curve — not just the sub's.

Merges position_assignments.bin (uint8 per point) with the already-baked
month_assignments.bin to aggregate counts.

Output: viz/tsne_chunks/time_histograms_positions.json
{ "by_position": { "<gid>:<posIdx>": [counts...] } }
"""
from __future__ import annotations
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CHUNKS = ROOT / "viz" / "tsne_chunks"


def main():
    th = json.loads((CHUNKS / "time_histograms.json").read_text())
    T = len(th["labels"])

    buf = (CHUNKS / "point_labels.bin").read_bytes()
    raw = np.frombuffer(buf, dtype=np.uint8).reshape(-1, 3)
    lo = raw[:, 0].astype(np.int32); hi = raw[:, 1].astype(np.int32)
    cl_arr = (hi << 8) | lo
    cl_arr = np.where(cl_arr >= 0x8000, cl_arr - 0x10000, cl_arr).astype(np.int16)
    sub_arr = raw[:, 2].astype(np.uint8)
    N = len(cl_arr)

    pos_assign = np.frombuffer((CHUNKS / "position_assignments.bin").read_bytes(), dtype=np.uint8)
    month_assign = np.frombuffer((CHUNKS / "month_assignments.bin").read_bytes(), dtype=np.uint8)

    # Build (cl, sub) → gid map matching canonical ordering.
    sub_meta = json.loads((CHUNKS / "subcluster_labels.json").read_text())
    gid_of = {}
    gid = 0
    for cl_str in sorted(sub_meta.keys(), key=int):
        cl_i = int(cl_str)
        for e in sub_meta[cl_str]:
            gid_of[(cl_i, e["sub"])] = gid
            gid += 1

    by_pos = defaultdict(lambda: np.zeros(T, dtype=np.int32))
    UNASSIGNED = 255
    for i in range(N):
        p = int(pos_assign[i])
        if p == UNASSIGNED:
            continue
        g = gid_of.get((int(cl_arr[i]), int(sub_arr[i])))
        if g is None:
            continue
        m = int(month_assign[i])
        by_pos[f"{g}:{p}"][m] += 1

    out = {"labels": th["labels"], "by_position": {k: v.tolist() for k, v in by_pos.items()}}
    path = CHUNKS / "time_histograms_positions.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    size_kb = path.stat().st_size // 1024
    print(f"Wrote {path} — {size_kb} KB, {len(by_pos)} positions × {T} months")


if __name__ == "__main__":
    main()

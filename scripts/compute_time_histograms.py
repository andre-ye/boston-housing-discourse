"""Bake per-cluster and per-sub monthly histograms from the tsne chunks.

For each chunk we already have `month_idx` (int) and `cluster` (int) per
point; sub locality comes from `viz/tsne_chunks/point_labels.bin`. We also
fold in the LLM "positions.json" so the position card can show temporal
context too — but cluster + sub are the primary granularities.

Output: viz/tsne_chunks/time_histograms.json

{
  "labels": ["2015-01", ..., "2024-12"],
  "bounds": [minIdx, maxIdx],
  "total":      [n_per_month,  length == len(labels)],
  "by_cluster": {"0": [counts...], ...},
  "by_sub_gid": {"0": [counts...], ...},
}

sub_gid ordering matches scripts/attribute_positions.py (sorted by cl, sub).

Keep counts as ints for tight JSON. At max ~49 clusters × 79 months + 194
subs × 79 months ≈ 20k ints, tiny.
"""
from __future__ import annotations
import json, struct
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CHUNKS = ROOT / "viz" / "tsne_chunks"


def main():
    manifest = json.loads((CHUNKS / "manifest.json").read_text())
    sub_meta = json.loads((CHUNKS / "subcluster_labels.json").read_text())

    # Build gid → (cl, sub_local) mirroring attribute_positions.py.
    gid_by_clsub = {}
    for cl_str in sorted(sub_meta.keys(), key=int):
        cl = int(cl_str)
        for gid_offset, e in enumerate(sub_meta[cl_str]):
            gid_by_clsub.setdefault(cl, {})[e["sub"]] = None
    # second pass to assign gids in the canonical global order
    gid = 0
    gid_of = {}   # (cl, sub) -> gid
    for cl_str in sorted(sub_meta.keys(), key=int):
        cl = int(cl_str)
        for e in sub_meta[cl_str]:
            gid_of[(cl, e["sub"])] = gid
            gid += 1

    # Load global sub-local labels for all points.
    buf = (CHUNKS / "point_labels.bin").read_bytes()
    N = len(buf) // 3
    raw = np.frombuffer(buf, dtype=np.uint8).reshape(N, 3)
    lo = raw[:, 0].astype(np.int32)
    hi = raw[:, 1].astype(np.int32)
    cl_arr = (hi << 8) | lo
    cl_arr = np.where(cl_arr >= 0x8000, cl_arr - 0x10000, cl_arr).astype(np.int16)
    sub_arr = raw[:, 2].astype(np.uint8)

    # Month labels from the chunks — first pass to determine global bounds.
    all_labels = set()
    for f in manifest["files"]:
        ch = json.loads((CHUNKS / f).read_text())
        all_labels.update(ch["year_month"])
    labels = sorted(all_labels)
    label_to_idx = {s: i for i, s in enumerate(labels)}
    T = len(labels)

    total = np.zeros(T, dtype=np.int32)
    by_cluster = {}
    by_sub = {}

    for fi, f in enumerate(manifest["files"]):
        ch = json.loads((CHUNKS / f).read_text())
        offset = ch["offset"]
        n = ch["n"]
        ym = ch["year_month"]
        # Sort order: use labels from chunk, map to global idx.
        ch_idx = np.array([label_to_idx[s] for s in ym], dtype=np.int32)
        ch_cl = cl_arr[offset:offset + n]
        ch_sub = sub_arr[offset:offset + n]

        # Total
        np.add.at(total, ch_idx, 1)
        # Per cluster
        for cl in np.unique(ch_cl):
            mask = ch_cl == cl
            key = str(int(cl))
            arr = by_cluster.get(key)
            if arr is None:
                arr = np.zeros(T, dtype=np.int32)
                by_cluster[key] = arr
            np.add.at(arr, ch_idx[mask], 1)
        # Per (cl, sub) → gid
        for cl in np.unique(ch_cl):
            cl_mask = ch_cl == cl
            subs_here = np.unique(ch_sub[cl_mask])
            for sub in subs_here:
                sub_mask = cl_mask & (ch_sub == sub)
                gkey = gid_of.get((int(cl), int(sub)))
                if gkey is None:
                    continue
                key = str(gkey)
                arr = by_sub.get(key)
                if arr is None:
                    arr = np.zeros(T, dtype=np.int32)
                    by_sub[key] = arr
                np.add.at(arr, ch_idx[sub_mask], 1)
        print(f"  chunk {fi:>2}/{len(manifest['files'])}: {n:,} points")

    out = {
        "labels": labels,
        "bounds": [0, T - 1],
        "total": total.tolist(),
        "by_cluster": {k: v.tolist() for k, v in by_cluster.items()},
        "by_sub_gid": {k: v.tolist() for k, v in by_sub.items()},
    }
    path = CHUNKS / "time_histograms.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    size_kb = path.stat().st_size // 1024
    print(f"\nWrote {path} — {size_kb} KB, {T} months, "
          f"{len(by_cluster)} clusters, {len(by_sub)} subs")


if __name__ == "__main__":
    main()

"""Bake top-K subreddit contributions per cluster and per sub from the
chunk payloads.

Each chunk has `subreddit` per point. We aggregate across all chunks into
per-cluster and per-sub-gid histograms, keeping only the top 5. Tiny file,
massive data-narrative value — users can ask "is this NIMBY cluster
mostly r/boston or r/Cambridge?" at a glance.

Output: viz/tsne_chunks/subreddit_breakdown.json

{
  "by_cluster": {"0": [{"r": "boston", "n": 12345}, ...], ...},
  "by_sub_gid": {"0": [...], ...},
}

Sub-gid ordering matches scripts/attribute_positions.py (sorted by cl,
sub).
"""
from __future__ import annotations
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHUNKS = ROOT / "viz" / "tsne_chunks"
TOP_K = 5


def main():
    manifest = json.loads((CHUNKS / "manifest.json").read_text())
    sub_meta = json.loads((CHUNKS / "subcluster_labels.json").read_text())

    # gid_of[(cl, sub)] = global_gid, canonical ordering.
    gid_of = {}
    gid = 0
    for cl_str in sorted(sub_meta.keys(), key=int):
        cl = int(cl_str)
        for e in sub_meta[cl_str]:
            gid_of[(cl, e["sub"])] = gid
            gid += 1

    # Load global per-point sub-local labels from point_labels.bin.
    import numpy as np
    buf = (CHUNKS / "point_labels.bin").read_bytes()
    N = len(buf) // 3
    raw = np.frombuffer(buf, dtype=np.uint8).reshape(N, 3)
    lo = raw[:, 0].astype(np.int32)
    hi = raw[:, 1].astype(np.int32)
    cl_arr = (hi << 8) | lo
    cl_arr = np.where(cl_arr >= 0x8000, cl_arr - 0x10000, cl_arr).astype(np.int16)
    sub_arr = raw[:, 2].astype(np.uint8)

    by_cluster: dict[int, Counter] = {}
    by_sub: dict[int, Counter] = {}

    for fi, f in enumerate(manifest["files"]):
        ch = json.loads((CHUNKS / f).read_text())
        off = ch["offset"]; n = ch["n"]
        subreddits = ch.get("subreddit") or []
        ch_cl = cl_arr[off:off + n]
        ch_sub = sub_arr[off:off + n]
        for i in range(n):
            cl = int(ch_cl[i])
            sub = int(ch_sub[i])
            r = subreddits[i] if i < len(subreddits) else ""
            if not r:
                continue
            by_cluster.setdefault(cl, Counter())[r] += 1
            gk = gid_of.get((cl, sub))
            if gk is not None:
                by_sub.setdefault(gk, Counter())[r] += 1
        print(f"  chunk {fi:>2}/{len(manifest['files'])}: {n:,} points")

    def top_k(c: Counter):
        return [{"r": r, "n": n} for r, n in c.most_common(TOP_K)]

    out = {
        "by_cluster": {str(k): top_k(v) for k, v in by_cluster.items()},
        "by_sub_gid": {str(k): top_k(v) for k, v in by_sub.items()},
    }
    path = CHUNKS / "subreddit_breakdown.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    size_kb = path.stat().st_size // 1024
    print(f"\nWrote {path} — {size_kb} KB, "
          f"{len(out['by_cluster'])} clusters, {len(out['by_sub_gid'])} subs")


if __name__ == "__main__":
    main()

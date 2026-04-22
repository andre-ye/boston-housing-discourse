#!/usr/bin/env python3
"""Dump every point's text (title + body snippet) for one cluster,
grouped by sub-cluster, into a JSON file that a Haiku subagent can
read in one go.

Output: data/cluster_{cl}_posts.json
  {
    "cluster": 6,
    "cluster_name": "Affordable Housing Advocacy",
    "subs": [
      {"sub": 0, "name": "Policy Updates", "posts": [{"i": 1234, "t": "title", "b": "body"}, ...]},
      ...
    ]
  }
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CHUNKS = ROOT / "viz" / "tsne_chunks"
OUT_DIR = ROOT / "data"

BODY_MAX = 480


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cluster", type=int, required=True)
    ap.add_argument("--body-max", type=int, default=BODY_MAX)
    ap.add_argument("--sample-per-sub", type=int, default=0,
                    help="If >0, sample at most this many posts per subcluster.")
    ap.add_argument("--seed", type=int, default=17)
    args = ap.parse_args()
    cl = args.cluster
    import random as _random
    _random.seed(args.seed)

    buf = (CHUNKS / "point_labels.bin").read_bytes()
    N = len(buf) // 3
    cluster = np.empty(N, dtype=np.int16)
    sub = np.empty(N, dtype=np.uint8)
    for i in range(N):
        lo, hi = buf[3 * i], buf[3 * i + 1]
        v = (hi << 8) | lo
        if v & 0x8000:
            v -= 0x10000
        cluster[i] = v
        sub[i] = buf[3 * i + 2]

    in_cluster = set(np.where(cluster == cl)[0].tolist())
    manifest = json.loads((CHUNKS / "manifest.json").read_text())
    cluster_labels = json.loads((CHUNKS / "cluster_labels.json").read_text())
    if "embedding" in cluster_labels:
        cluster_labels = cluster_labels["embedding"]
    sub_labels = json.loads((CHUNKS / "subcluster_labels.json").read_text())

    # Build index of points by sub for this cluster.
    by_sub: dict[int, list[int]] = {}
    for i in in_cluster:
        by_sub.setdefault(int(sub[i]), []).append(i)

    # Pull texts by streaming chunk files.
    texts: dict[int, tuple[str, str]] = {}
    for fn in manifest["files"]:
        c = json.loads((CHUNKS / fn).read_text())
        off = c["offset"]
        titles = c.get("title", [""] * c["n"])
        # Chunks use `panel_body` (full) or `hover_body` (truncated); fall
        # back to `body` for older chunk formats. For comments the title
        # is empty and only the body carries the text.
        bodies = c.get("panel_body") or c.get("hover_body") or c.get("body", [""] * c["n"])
        for j in range(c["n"]):
            gi = off + j
            if gi in in_cluster:
                texts[gi] = (
                    (titles[j] or "").strip(),
                    (bodies[j] or "").strip()[: args.body_max],
                )

    sub_meta_for_cl = {s["sub"]: s["name"] for s in sub_labels.get(str(cl), [])}
    out_subs = []
    for s_id in sorted(by_sub.keys()):
        ids = sorted(by_sub[s_id])
        full_n = len(ids)
        if args.sample_per_sub and full_n > args.sample_per_sub:
            ids = sorted(_random.sample(ids, args.sample_per_sub))
        posts = []
        for i in ids:
            t, b = texts.get(i, ("", ""))
            posts.append({"i": int(i), "t": t, "b": b})
        out_subs.append({
            "sub": int(s_id),
            "name": sub_meta_for_cl.get(s_id, f"Sub {s_id}"),
            "n": full_n,
            "sampled": len(posts),
            "posts": posts,
        })

    out = {
        "cluster": cl,
        "cluster_name": cluster_labels.get(str(cl), {}).get("name", f"Cluster {cl}"),
        "n": sum(s["n"] for s in out_subs),
        "sampled": sum(s.get("sampled", s["n"]) for s in out_subs),
        "subs": out_subs,
    }
    out_path = OUT_DIR / f"cluster_{cl}_posts.json"
    out_path.write_text(json.dumps(out))
    print(f"wrote {out_path}  ({out['n']} total, {out['sampled']} sampled, {len(out_subs)} subs)  {Path(out_path).stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()

"""Sample attributed-point evidence per position and write a Haiku-friendly
eval bundle. Pick 20 positions (stratified across clusters) and 3 attributed
point snippets for each.

Output: /tmp/position_eval_bundle.json (small enough for a single LLM pass)
"""
from __future__ import annotations
import json
import random
import re
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CHUNKS = ROOT / "viz" / "tsne_chunks"

random.seed(7)

anchors = json.loads((CHUNKS / "position_anchors.json").read_text())
manifest = json.loads((CHUNKS / "manifest.json").read_text())
sub_meta = json.loads((CHUNKS / "subcluster_labels.json").read_text())

assignments = np.frombuffer((CHUNKS / "position_assignments.bin").read_bytes(), dtype=np.uint8)
labels_arr = np.frombuffer((CHUNKS / "point_labels.bin").read_bytes(), dtype=np.uint8).reshape(-1, 3)
lo, hi = labels_arr[:, 0].astype(np.int32), labels_arr[:, 1].astype(np.int32)
cluster_arr = (hi << 8) | lo
cluster_arr = np.where(cluster_arr >= 0x8000, cluster_arr - 0x10000, cluster_arr).astype(np.int16)
sub_arr = labels_arr[:, 2].astype(np.int32)

# Sample 20 positions, stratified across distinct clusters.
all_positions = []
for gid_str, doc in anchors.items():
    cl = doc.get("cl")
    sub = doc.get("sub")
    for pi, p in enumerate(doc.get("positions", [])):
        if p["count"] >= 30:   # only grade positions with real sample mass
            all_positions.append({
                "gid": gid_str, "cl": cl, "sub": sub, "pi": pi,
                "pos": p,
                "cluster_name": doc.get("cluster_name"),
                "sub_name": doc.get("sub_name"),
                "count": p["count"],
            })

random.shuffle(all_positions)
seen_cl = set()
stratified = []
for x in all_positions:
    if x["cl"] in seen_cl and len(seen_cl) < 20:
        continue
    seen_cl.add(x["cl"])
    stratified.append(x)
    if len(stratified) >= 20:
        break

# Load chunks on demand
chunk_cache: dict[int, dict] = {}
cs = manifest["chunkSize"]


def load_chunk(ci: int) -> dict:
    if ci not in chunk_cache:
        chunk_cache[ci] = json.loads((CHUNKS / manifest["files"][ci]).read_text())
    return chunk_cache[ci]


def point_snippet(gi: int) -> dict:
    ci = gi // cs
    ch = load_chunk(ci)
    j = gi - ch["offset"]
    title = (ch["title"][j] or "").strip()
    body = ((ch.get("panel_body") or [""] * ch["n"])[j] or
            (ch.get("hover_body") or [""] * ch["n"])[j] or "").strip()
    return {
        "idx": int(gi),
        "subreddit": ch["subreddit"][j],
        "title": title,
        "body": body[:400],
    }


bundle = {"positions": []}
for row in stratified:
    cl, sub, pi = row["cl"], row["sub"], row["pi"]
    mask = (cluster_arr == cl) & (sub_arr == sub) & (assignments == pi)
    idxs = np.where(mask)[0]
    if len(idxs) == 0:
        continue
    sample = random.sample(list(idxs.tolist()), min(3, len(idxs)))
    bundle["positions"].append({
        "id": f"{row['gid']}/{pi}",
        "cluster": row["cluster_name"],
        "sub": row["sub_name"],
        "position_name": row["pos"]["name"],
        "position_description": row["pos"].get("description", ""),
        "position_keywords": row["pos"].get("keywords", []),
        "total_count": row["count"],
        "samples": [point_snippet(int(gi)) for gi in sample],
    })

out = Path("/tmp/position_eval_bundle.json")
out.write_text(json.dumps(bundle, indent=2, ensure_ascii=False))
print(f"Wrote {out} with {len(bundle['positions'])} positions")

"""Build Haiku-friendly bundles for re-labeling weak positions.

For each position with count >= 40, gather up to 6 attributed sample
snippets and bundle them for a Haiku relabeling pass.

Writes /tmp/relabel_bundles/batch_<N>.json — 6 positions per file,
designed to fit in one Haiku pass per file.
"""
from __future__ import annotations
import json
import random
import re
from pathlib import Path

import numpy as np

random.seed(42)

ROOT = Path(__file__).resolve().parent.parent
CHUNKS = ROOT / "viz" / "tsne_chunks"
OUT_DIR = Path("/tmp/relabel_bundles")
OUT_DIR.mkdir(exist_ok=True)

MIN_COUNT = 80        # only relabel positions with real support
MAX_SAMPLES_PER_POSITION = 6
POSITIONS_PER_BATCH = 5
MAX_BATCHES = 18      # cap total work at ~90 positions

anchors = json.loads((CHUNKS / "position_anchors.json").read_text())
manifest = json.loads((CHUNKS / "manifest.json").read_text())
assignments = np.frombuffer((CHUNKS / "position_assignments.bin").read_bytes(), dtype=np.uint8)
labels_arr = np.frombuffer((CHUNKS / "point_labels.bin").read_bytes(), dtype=np.uint8).reshape(-1, 3)
lo, hi = labels_arr[:, 0].astype(np.int32), labels_arr[:, 1].astype(np.int32)
cluster_arr = (hi << 8) | lo
cluster_arr = np.where(cluster_arr >= 0x8000, cluster_arr - 0x10000, cluster_arr).astype(np.int16)
sub_arr = labels_arr[:, 2].astype(np.int32)

CS = manifest["chunkSize"]
chunk_cache: dict[int, dict] = {}


def load_chunk(ci: int) -> dict:
    if ci not in chunk_cache:
        chunk_cache[ci] = json.loads((CHUNKS / manifest["files"][ci]).read_text())
    return chunk_cache[ci]


def snippet(gi: int) -> dict:
    ci = gi // CS
    ch = load_chunk(ci)
    j = gi - ch["offset"]
    title = (ch["title"][j] or "").strip()
    body = ((ch.get("panel_body") or [""] * ch["n"])[j] or
            (ch.get("hover_body") or [""] * ch["n"])[j] or "").strip()
    return {
        "idx": int(gi),
        "subreddit": ch["subreddit"][j],
        "title": title,
        "body": body[:350].replace("\n", " "),
    }


all_tasks = []
for gid_str, doc in anchors.items():
    cl = doc.get("cl")
    sub = doc.get("sub")
    for pi, p in enumerate(doc.get("positions", [])):
        if p["count"] < MIN_COUNT:
            continue
        mask = (cluster_arr == cl) & (sub_arr == sub) & (assignments == pi)
        idxs = np.where(mask)[0]
        if len(idxs) == 0:
            continue
        sample_gids = random.sample(list(idxs.tolist()), min(MAX_SAMPLES_PER_POSITION, len(idxs)))
        all_tasks.append({
            "position_id": f"{gid_str}/{pi}",
            "gid": gid_str,
            "pi": pi,
            "cluster_name": doc.get("cluster_name"),
            "sub_name": doc.get("sub_name"),
            "original_name": p["name"],
            "original_description": p.get("description", ""),
            "count": p["count"],
            "samples": [snippet(int(g)) for g in sample_gids],
        })

# Prioritize by count (biggest positions = most-seen on globe); limit total work.
all_tasks.sort(key=lambda t: -t["count"])
all_tasks = all_tasks[:MAX_BATCHES * POSITIONS_PER_BATCH]

# Remove any pre-existing batch files so old runs don't linger
for f in OUT_DIR.glob("batch_*.json"):
    f.unlink()

for i in range(0, len(all_tasks), POSITIONS_PER_BATCH):
    batch = all_tasks[i:i + POSITIONS_PER_BATCH]
    out = OUT_DIR / f"batch_{i // POSITIONS_PER_BATCH:03d}.json"
    out.write_text(json.dumps({"positions": batch}, ensure_ascii=False, indent=2))

print(f"Wrote {len(all_tasks)} positions across {(len(all_tasks)+POSITIONS_PER_BATCH-1)//POSITIONS_PER_BATCH} batches into {OUT_DIR}")

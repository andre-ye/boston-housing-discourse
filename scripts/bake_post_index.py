#!/usr/bin/env python3
"""
Bake a small post-id → point-index lookup so the globe viewer doesn't have to
fetch all 22 chunk JSONs (~440MB) on first thread render.

Reads the chunk JSONs in viz/tsne_chunks and writes:
  viz/tsne_chunks/post_index.json
    {
      "ids": ["2qyzxv", "2qzauf", ...],     # base36 reddit submission ids
      "idx": [0, 1, ...]                    # corresponding point indices
    }

The resulting file is small (a few hundred KB).
"""
import json
import re
from pathlib import Path

repo = Path(__file__).resolve().parents[1]
chunks_dir = repo / "viz" / "tsne_chunks"

manifest = json.loads((chunks_dir / "manifest.json").read_text())
ids = []
idxs = []
for fname in manifest["files"]:
    c = json.loads((chunks_dir / fname).read_text())
    off = c["offset"]
    types = c["type"]
    perms = c["permalink"]
    for j in range(c["n"]):
        if types[j] not in ("submission", "post"):
            continue
        m = re.search(r"/comments/([a-z0-9]+)/", perms[j] or "")
        if not m:
            continue
        ids.append(m.group(1))
        idxs.append(off + j)

out = chunks_dir / "post_index.json"
out.write_text(json.dumps({"ids": ids, "idx": idxs}, separators=(",", ":")))
print(f"wrote {out}: {len(ids)} posts, {out.stat().st_size/1024:.1f} KB")

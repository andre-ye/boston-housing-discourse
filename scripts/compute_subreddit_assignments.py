"""Bake per-point subreddit index (uint8) + id→name map.

Enables live globe filtering by subreddit. With only ~30 distinct
subreddits in the corpus, uint8 per point is sufficient.

Outputs:
  viz/tsne_chunks/subreddit_assignments.bin   (N bytes, uint8 per point)
  viz/tsne_chunks/subreddit_names.json        ([{id, name, count}, ...])
"""
from __future__ import annotations
import json, struct
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHUNKS = ROOT / "viz" / "tsne_chunks"


def main():
    manifest = json.loads((CHUNKS / "manifest.json").read_text())
    # First pass: tally subreddits across all chunks to assign IDs.
    tally: Counter = Counter()
    for f in manifest["files"]:
        ch = json.loads((CHUNKS / f).read_text())
        for r in (ch.get("subreddit") or []):
            tally[r or ""] += 1
    # Stable ordering: by count desc so the most common subreddit gets id 0.
    names = [r for r, _ in tally.most_common()]
    if len(names) > 255:
        raise RuntimeError(f"too many subreddits ({len(names)}) for uint8 index")
    id_of = {r: i for i, r in enumerate(names)}

    # Second pass: write a byte per point.
    N = sum(json.loads((CHUNKS / f).read_text()).get("n", 0) for f in manifest["files"])
    buf = bytearray(N)
    for f in manifest["files"]:
        ch = json.loads((CHUNKS / f).read_text())
        off = ch["offset"]; n = ch["n"]
        subs = ch.get("subreddit") or [""] * n
        for i in range(n):
            buf[off + i] = id_of.get(subs[i] or "", 0)

    (CHUNKS / "subreddit_assignments.bin").write_bytes(bytes(buf))
    names_json = [{"id": i, "name": r, "count": tally[r]} for i, r in enumerate(names)]
    (CHUNKS / "subreddit_names.json").write_text(json.dumps(names_json))
    print(f"Wrote {len(buf):,} bytes + {len(names)} subreddit names")
    for e in names_json[:10]:
        print(f"  id={e['id']:>3}  r/{e['name']:<20}  n={e['count']:>7,}")


if __name__ == "__main__":
    main()

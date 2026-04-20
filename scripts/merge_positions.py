#!/usr/bin/env python3
"""Merge viz/tsne_chunks/positions/sub_*.json into one positions.json.

Final shape:
  {
    "by_gid": {
      "<gid>": { "positions": [...] },
      ...
    }
  }

Skipped gids fall back to the old post-grouping in viewer2 at render time.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "viz" / "tsne_chunks"
SRC_DIR = ROOT / "positions"
OUT = ROOT / "positions.json"

by_gid: dict[str, dict] = {}
for f in sorted(SRC_DIR.glob("sub_*.json")):
    try:
        d = json.loads(f.read_text())
    except Exception as e:
        print(f"skip {f.name}: {e}")
        continue
    gid = str(d.get("gid"))
    if gid == "None":
        continue
    by_gid[gid] = {
        "sub_name": d.get("sub_name"),
        "cluster_name": d.get("cluster_name"),
        "cl": d.get("cl"),
        "positions": d.get("positions", []),
    }

OUT.write_text(json.dumps({"by_gid": by_gid}, ensure_ascii=False))
print(f"wrote {OUT} with {len(by_gid)} subs")

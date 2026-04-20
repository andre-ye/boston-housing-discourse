#!/usr/bin/env python3
"""Split sub_samples.json into per-sub files so Haiku subagents can Read them.

Each output is viz/tsne_chunks/sub_samples/sub_<gid>.json containing the same
shape as a single entry from sub_samples.json.
"""
import json
from pathlib import Path

CHUNKS = Path(__file__).resolve().parents[1] / "viz" / "tsne_chunks"
SRC = CHUNKS / "sub_samples.json"
OUT_DIR = CHUNKS / "sub_samples"
OUT_DIR.mkdir(exist_ok=True)

data = json.loads(SRC.read_text())
for gid, rec in data.items():
    (OUT_DIR / f"sub_{gid}.json").write_text(json.dumps(rec, ensure_ascii=False, indent=2))
print(f"wrote {len(data)} files to {OUT_DIR}")

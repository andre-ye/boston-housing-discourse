#!/usr/bin/env python3
"""Shrink per-sub sample files so Haiku subagents can Read them without
hitting the ~10K token cap.

Strategy: trim each sample's body to BODY_MAX characters in place.
"""
import json
from pathlib import Path

DIR = Path(__file__).resolve().parents[1] / "viz" / "tsne_chunks" / "sub_samples"
BODY_MAX = 180

n = 0
for f in sorted(DIR.glob("sub_*.json")):
    d = json.loads(f.read_text())
    changed = False
    for s in d.get("samples", []):
        body = s.get("body", "")
        if len(body) > BODY_MAX:
            s["body"] = body[:BODY_MAX] + "…"
            changed = True
    if changed:
        f.write_text(json.dumps(d, ensure_ascii=False, indent=2))
        n += 1
print(f"trimmed {n} files")

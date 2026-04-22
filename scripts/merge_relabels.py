"""Merge Haiku-written position relabels into position_anchors.json.

Reads /tmp/relabel_out/out_*.json and overwrites the corresponding position's
`name`/`description` in position_anchors.json. Keeps original under
`original_name` / `original_description` for provenance.
"""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHUNKS = ROOT / "viz" / "tsne_chunks"
OUT_DIR = Path("/tmp/relabel_out")

anchors = json.loads((CHUNKS / "position_anchors.json").read_text())

updates = 0
for f in sorted(OUT_DIR.glob("out_*.json")):
    try:
        d = json.loads(f.read_text())
    except Exception as e:
        print(f"  skip {f.name}: {e}")
        continue
    for r in d.get("relabels", []):
        pid = r.get("position_id")
        name = r.get("name")
        desc = r.get("description")
        if not pid or not name:
            continue
        gid, pi_str = pid.split("/")
        try:
            pi = int(pi_str)
        except ValueError:
            continue
        doc = anchors.get(gid)
        if not doc:
            continue
        positions = doc.get("positions") or []
        if pi >= len(positions):
            continue
        pos = positions[pi]
        if "original_name" not in pos:
            pos["original_name"] = pos.get("name")
            pos["original_description"] = pos.get("description", "")
        pos["name"] = name
        if desc:
            pos["description"] = desc
        pos["relabeled"] = True
        updates += 1

(CHUNKS / "position_anchors.json").write_text(json.dumps(anchors))
print(f"Applied {updates} relabels to position_anchors.json")

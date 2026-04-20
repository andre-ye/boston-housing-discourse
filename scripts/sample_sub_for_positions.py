#!/usr/bin/env python3
"""Sample top items per subcluster and emit prompt material for position labeling.

For every subcluster in subcluster_assignments.json, this script:
  - Gathers points belonging to that sub by iterating chunk files
  - Picks the top-N highest-score items (posts + comments) as samples
  - Writes `viz/tsne_chunks/sub_samples.json` as:
      { "<gid>": { "cl": N, "sub": N, "name": "...",
                   "samples": [{id, type, score, title, body}, ...] } }

Later, a subagent can read this file for a given gid and output a set of
position labels. Keeping sampling separate keeps the LLM step idempotent.
"""

import json
import sys
from pathlib import Path

CHUNKS_DIR = Path(__file__).resolve().parents[1] / "viz" / "tsne_chunks"
OUT_PATH = CHUNKS_DIR / "sub_samples.json"
TOP_N = 60         # samples per subcluster
BODY_MAX_CHARS = 480


def main() -> None:
    manifest = json.loads((CHUNKS_DIR / "manifest.json").read_text())
    sub_asgn = json.loads((CHUNKS_DIR / "subcluster_assignments.json").read_text())
    sub_data = sub_asgn["data"]

    sub_labels = json.loads((CHUNKS_DIR / "subcluster_labels.json").read_text())
    cluster_labels = json.loads((CHUNKS_DIR / "cluster_labels.json").read_text())

    # Build cluster (int) → { local sub idx → global gid } lookup
    sub_global_map: dict[int, dict[int, int]] = {}
    sub_gid_info: dict[int, dict] = {}
    sorted_parents = sorted(int(k) for k in sub_labels.keys())
    gid = 0
    for cl in sorted_parents:
        sub_global_map[cl] = {}
        for entry in sub_labels[str(cl)]:
            sub_global_map[cl][entry["sub"]] = gid
            sub_gid_info[gid] = {
                "cl": cl,
                "sub": entry["sub"],
                "name": entry["name"],
                "cluster_name": cluster_labels.get("embedding", {}).get(str(cl), {}).get("name", f"Cluster {cl}"),
                "samples": [],   # reservoir accumulator of (score, payload)
            }
            gid += 1

    # Stream chunks, pick top-score items per sub
    offset = 0
    for fi, fname in enumerate(manifest["files"]):
        print(f"chunk {fi+1}/{len(manifest['files'])}  {fname}", file=sys.stderr)
        C = json.loads((CHUNKS_DIR / fname).read_text())
        n = C["n"]
        for j in range(n):
            i = offset + j
            cl = C.get("cluster", [-1] * n)[j] if "cluster" in C else -1
            if cl is None or cl < 0:
                continue
            sl = sub_data[i]
            if sl == 255:
                continue
            g = sub_global_map.get(cl, {}).get(sl)
            if g is None:
                continue
            score = int(C["score"][j] or 0)
            title = (C["title"][j] or "").strip()
            body = (C.get("panel_body", [""] * n)[j] or "").strip()
            if len(body) > BODY_MAX_CHARS:
                body = body[:BODY_MAX_CHARS] + "…"
            type_s = "post" if C["type"][j] == "submission" else "comment"
            sub_gid_info[g]["samples"].append({
                "score": score,
                "type": type_s,
                "permalink": C["permalink"][j],
                "subreddit": C["subreddit"][j],
                "title": title,
                "body": body,
            })
        offset += n

    # Keep top-N by score per sub
    for g, rec in sub_gid_info.items():
        rec["samples"].sort(key=lambda s: s["score"], reverse=True)
        rec["samples"] = rec["samples"][:TOP_N]

    OUT_PATH.write_text(json.dumps({str(g): rec for g, rec in sub_gid_info.items()}, ensure_ascii=False))
    print(f"wrote {OUT_PATH} · {len(sub_gid_info)} subs · {sum(len(r['samples']) for r in sub_gid_info.values())} total samples", file=sys.stderr)


if __name__ == "__main__":
    main()

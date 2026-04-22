"""Bake per-point month index (uint8) + labels map.

Enables live globe filtering by date range. Uses month_idx from chunks,
which is already 0..T-1. With T≈79 months, uint8 is plenty.

Outputs:
  viz/tsne_chunks/month_assignments.bin   (N bytes, uint8 per point)
  viz/tsne_chunks/month_labels.json       ([label, label, ...])
"""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHUNKS = ROOT / "viz" / "tsne_chunks"


def main():
    manifest = json.loads((CHUNKS / "manifest.json").read_text())
    # Pull labels from time_histograms.json to stay consistent.
    th = json.loads((CHUNKS / "time_histograms.json").read_text())
    labels = th["labels"]
    label_to_idx = {s: i for i, s in enumerate(labels)}
    if len(labels) > 255:
        raise RuntimeError(f"too many months ({len(labels)})")

    # Write a byte per point mapped by year_month string from each chunk.
    N = sum(json.loads((CHUNKS / f).read_text()).get("n", 0) for f in manifest["files"])
    buf = bytearray(N)
    for f in manifest["files"]:
        ch = json.loads((CHUNKS / f).read_text())
        off = ch["offset"]; n = ch["n"]
        ym = ch.get("year_month") or [""] * n
        for i in range(n):
            buf[off + i] = label_to_idx.get(ym[i], 0)

    (CHUNKS / "month_assignments.bin").write_bytes(bytes(buf))
    (CHUNKS / "month_labels.json").write_text(json.dumps(labels))
    print(f"Wrote {len(buf):,} bytes + {len(labels)} months "
          f"({labels[0]} → {labels[-1]})")


if __name__ == "__main__":
    main()

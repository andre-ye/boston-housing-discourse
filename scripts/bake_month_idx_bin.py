#!/usr/bin/env python3
"""Concatenate per-point month_idx from tsne_chunks into a single uint8 file for the viz."""
import json
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    chunk_dir = root / "viz" / "tsne_chunks"
    manifest_path = chunk_dir / "manifest.json"
    if not manifest_path.is_file():
        print(f"Missing {manifest_path}", file=sys.stderr)
        return 1
    manifest = json.loads(manifest_path.read_text())
    n = int(manifest["totalPoints"])
    out_path = chunk_dir / "month_idx.bin"
    buf = bytearray(n)
    files = manifest["files"]
    for i, fname in enumerate(files):
        p = chunk_dir / fname
        if not p.is_file():
            print(f"Missing chunk {p}", file=sys.stderr)
            return 1
        data = json.loads(p.read_text())
        off = int(data["offset"])
        arr = data["month_idx"]
        for j, v in enumerate(arr):
            buf[off + j] = int(v) & 0xFF
        print(f"{i + 1}/{len(files)} {fname}", flush=True)
    out_path.write_bytes(buf)
    print(f"Wrote {out_path} ({len(buf)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

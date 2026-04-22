#!/usr/bin/env python3
"""One byte per point: 0 = comment, 1 = submission/post (for viz filters)."""
import json
import sys
from pathlib import Path


def is_post(typ) -> int:
    t = str(typ or "").lower()
    return 1 if t in ("submission", "post") else 0


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    chunk_dir = root / "viz" / "tsne_chunks"
    manifest_path = chunk_dir / "manifest.json"
    if not manifest_path.is_file():
        print(f"Missing {manifest_path}", file=sys.stderr)
        return 1
    manifest = json.loads(manifest_path.read_text())
    n = int(manifest["totalPoints"])
    out_path = chunk_dir / "point_kind.bin"
    buf = bytearray(n)
    files = manifest["files"]
    for i, fname in enumerate(files):
        p = chunk_dir / fname
        if not p.is_file():
            print(f"Missing chunk {p}", file=sys.stderr)
            return 1
        data = json.loads(p.read_text())
        off = int(data["offset"])
        types = data["type"]
        for j, typ in enumerate(types):
            buf[off + j] = is_post(typ) & 0xFF
        print(f"{i + 1}/{len(files)} {fname}", flush=True)
    out_path.write_bytes(buf)
    print(f"Wrote {out_path} ({len(buf)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

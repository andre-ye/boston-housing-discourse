#!/usr/bin/env python3
"""
Split a large tsne_payload.json into numbered chunks + manifest.json for the D3 viewer.

Example:
  .venv/bin/python chunk_tsne_payload.py --in viz/tsne_payload.json --out viz/tsne_chunks --chunk-size 20000
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--in", dest="inp", type=Path, default=Path("viz/tsne_payload.json"))
    ap.add_argument("--out", type=Path, default=Path("viz/tsne_chunks"))
    ap.add_argument("--chunk-size", type=int, default=20_000)
    args = ap.parse_args()

    print(f"Loading {args.inp} …", flush=True)
    with open(args.inp, encoding="utf-8") as f:
        P = json.load(f)

    n = len(P["x"])
    keys = [k for k in P.keys() if k != "months"]
    months = P["months"]

    xs = P["x"]
    ys = P["y"]
    xmin, xmax = min(xs), max(xs)
    ymin, ymax = min(ys), max(ys)

    chunk_size = max(1, args.chunk_size)
    num_chunks = math.ceil(n / chunk_size)

    args.out.mkdir(parents=True, exist_ok=True)

    manifest = {
        "version": 1,
        "totalPoints": n,
        "chunkSize": chunk_size,
        "numChunks": num_chunks,
        "months": months,
        "extent": {"x": [xmin, xmax], "y": [ymin, ymax]},
        "files": [f"chunk_{i:05d}.json" for i in range(num_chunks)],
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=True), encoding="utf-8")

    for ci in range(num_chunks):
        lo = ci * chunk_size
        hi = min(n, lo + chunk_size)
        sl = slice(lo, hi)
        chunk: dict = {"offset": lo, "n": hi - lo}
        for k in keys:
            v = P[k]
            chunk[k] = v[sl] if isinstance(v, list) else v
        path = args.out / f"chunk_{ci:05d}.json"
        path.write_text(json.dumps(chunk, ensure_ascii=True), encoding="utf-8")
        print(f"  wrote {path.name}  rows {lo}:{hi}", flush=True)

    print(f"Wrote manifest + {num_chunks} chunks -> {args.out.resolve()}", flush=True)


if __name__ == "__main__":
    main()

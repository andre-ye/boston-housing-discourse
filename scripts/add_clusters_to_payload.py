#!/usr/bin/env python3
"""
Add cluster labels to viz/tsne_payload.json so the D3 viewer can color by cluster.

Two cluster sources are supported and can be used independently or together:

  1. Embedding-space clusters (--clusters): labels from cluster_embeddings.py output.
     These are semantically meaningful topic clusters derived from BGE vectors.
     Assumes positional alignment — the payload must have been built from the same
     embeddings NPZ in the same order (true for full-corpus runs with --tsne-max-points 0).

  2. t-SNE-space clusters (--tsne-k N): KMeans on the 2D (x, y) payload coordinates.
     These follow the visual blobs in the scatter plot but are less semantically stable.

Both are written into the payload JSON as "cluster" and/or "cluster_tsne".

After running this, re-chunk for the D3 viewer:
  python chunk_tsne_payload.py --in viz/tsne_payload.json --out viz/tsne_chunks
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True)

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--payload", type=Path, default=Path("viz/tsne_payload.json"),
                    help="t-SNE payload JSON (input and output if --out is not set)")
    ap.add_argument("--clusters", type=Path, default=None,
                    help="clusters .npz from cluster_embeddings.py (ids + labels). "
                         "Positionally aligned with the payload.")
    ap.add_argument("--tsne-k", type=int, default=0,
                    help="If >0, cluster the 2D t-SNE (x, y) with KMeans(k) and add 'cluster_tsne'.")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", type=Path, default=None,
                    help="Output path. Defaults to overwriting --payload in-place.")
    args = ap.parse_args()

    if args.clusters is None and args.tsne_k <= 0:
        ap.error("Provide --clusters and/or --tsne-k N (nothing to do otherwise).")

    out = args.out or args.payload

    print(f"Loading {args.payload} …", flush=True)
    with open(args.payload, encoding="utf-8") as f:
        P = json.load(f)
    n = len(P["x"])
    print(f"  {n:,} points", flush=True)

    # ── Embedding-space clusters ──────────────────────────────────────────────
    if args.clusters is not None:
        print(f"Loading embedding-space clusters from {args.clusters} …", flush=True)
        z = np.load(args.clusters, allow_pickle=True)
        labels = np.asarray(z["labels"], dtype=np.int32)
        if len(labels) != n:
            raise SystemExit(
                f"Cluster labels length {len(labels)} != payload length {n}.\n"
                "The payload must have been built from the same embeddings in the same row order\n"
                "(i.e. a full-corpus run with --tsne-max-points 0)."
            )
        k = int(z["k"])
        unique = len(set(labels.tolist()))
        P["cluster"] = labels.tolist()
        print(f"  Added 'cluster' field  k={k}  unique_used={unique}", flush=True)

    # ── t-SNE-space clusters ─────────────────────────────────────────────────
    if args.tsne_k > 0:
        try:
            from sklearn.cluster import MiniBatchKMeans
        except ImportError:
            raise SystemExit("scikit-learn is required for --tsne-k (pip install scikit-learn).")

        xy = np.column_stack([P["x"], P["y"]]).astype(np.float32)
        print(f"KMeans(k={args.tsne_k}) on t-SNE 2D coordinates …", flush=True)
        km = MiniBatchKMeans(
            n_clusters=args.tsne_k,
            batch_size=min(4096, n),
            random_state=args.seed,
            n_init=3,
        )
        tsne_labels = km.fit_predict(xy).astype(np.int32)
        P["cluster_tsne"] = tsne_labels.tolist()
        print(f"  Added 'cluster_tsne' field  k={args.tsne_k}", flush=True)

    print(f"Writing {out} …", flush=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(P, f, ensure_ascii=True)
    size_mb = out.stat().st_size / 1e6
    print(f"Done — {out.resolve()}  ({size_mb:.1f} MB)", flush=True)
    print(
        "\nNext step — re-chunk for the D3 viewer:\n"
        f"  python chunk_tsne_payload.py --in {args.payload} --out viz/tsne_chunks",
        flush=True,
    )


if __name__ == "__main__":
    main()

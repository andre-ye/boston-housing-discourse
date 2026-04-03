#!/usr/bin/env python3
"""
Cluster Reddit rows in **embedding space** (not t-SNE space).

t-SNE is for visualization only; distances in 2D t-SNE are distorted. Use this script
for topic-style groups: MiniBatchKMeans on normalized BGE vectors (optionally PCA first).

Outputs a .npz with ids + cluster labels aligned to the embedding file row order.
Join to the interactive viewer later via id, or use labels for analysis.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from sklearn.cluster import MiniBatchKMeans
from sklearn.decomposition import PCA


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True)

    ap = argparse.ArgumentParser()
    ap.add_argument("--npz", type=Path, required=True, help="Embeddings from embed_tsne_viz.py (ids + embeddings)")
    ap.add_argument("--out", type=Path, default=Path("data/clusters_minibatch_k50.npz"))
    ap.add_argument("--k", type=int, default=50, help="Number of clusters (MiniBatchKMeans)")
    ap.add_argument("--batch-size", type=int, default=4096)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument(
        "--pca-dims",
        type=int,
        default=0,
        help="If >0 and embedding dim is larger, PCA-reduce before k-means (often faster / stabler).",
    )
    ap.add_argument("--n-init", type=int, default=3)
    args = ap.parse_args()

    z = np.load(args.npz, allow_pickle=True)
    ids = np.asarray(z["ids"]).astype(str)
    emb = np.asarray(z["embeddings"], dtype=np.float32)
    if len(ids) != len(emb):
        raise SystemExit(f"len(ids)={len(ids)} != len(emb)={len(emb)}")
    n, d = emb.shape
    print(f"rows={n} dim={d} k={args.k}", flush=True)

    x = emb
    if args.pca_dims and d > args.pca_dims:
        print(f"PCA {d} -> {args.pca_dims}", flush=True)
        x = PCA(n_components=args.pca_dims, random_state=args.seed).fit_transform(emb)

    km = MiniBatchKMeans(
        n_clusters=args.k,
        batch_size=min(args.batch_size, n),
        random_state=args.seed,
        n_init=args.n_init,
    )
    labels = km.fit_predict(x)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.out,
        ids=ids,
        labels=labels.astype(np.int32),
        k=np.array(args.k),
        pca_dims=np.array(args.pca_dims),
    )
    print(f"Wrote {args.out.resolve()} labels shape={labels.shape}", flush=True)


if __name__ == "__main__":
    main()

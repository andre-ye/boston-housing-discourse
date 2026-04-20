#!/usr/bin/env python3
"""
Project BGE embeddings onto a sphere using UMAP with output_metric='haversine'.

Input:  data/embeddings_bge_large_en_v1_5.npz (422114 x 1024)
Output: viz/tsne_chunks/sphere_coords.bin  (float32, 2*N values: lat, lon in radians)
        viz/tsne_chunks/sphere_manifest.json
        viz/tsne_chunks/sphere_centroids.json  (per-cluster + per-subcluster centroids)

Speed trick: PCA to 50D first, then UMAP NN search is ~20x faster.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

# Block transitive tensorflow imports — UMAP on this box deadlocks inside
# protobuf static init when TF gets loaded.
sys.modules["tensorflow"] = None  # type: ignore[assignment]

import numpy as np


def main() -> None:
    repo = Path(__file__).resolve().parents[1]
    emb_path = repo / "data" / "embeddings_bge_large_en_v1_5.npz"
    chunks_dir = repo / "viz" / "tsne_chunks"
    out_bin = chunks_dir / "sphere_coords.bin"
    out_manifest = chunks_dir / "sphere_manifest.json"
    out_centroids = chunks_dir / "sphere_centroids.json"

    print(f"[{time.strftime('%H:%M:%S')}] loading embeddings…", flush=True)
    d = np.load(emb_path, allow_pickle=True)
    X = d["embeddings"].astype(np.float32)
    N, D = X.shape
    print(f"  shape: {X.shape}", flush=True)

    # PCA to 50D for speed.
    print(f"[{time.strftime('%H:%M:%S')}] PCA(50)…", flush=True)
    from sklearn.decomposition import PCA

    pca = PCA(n_components=50, random_state=0)
    Xp = pca.fit_transform(X)
    print(f"  explained var (sum first 50): {pca.explained_variance_ratio_.sum():.3f}", flush=True)

    # UMAP with output_metric='haversine' produces 2D outputs interpreted as
    # (lat, lon). The output is unconstrained, so we wrap to valid sphere coords.
    print(f"[{time.strftime('%H:%M:%S')}] UMAP haversine → sphere…", flush=True)
    import umap

    reducer = umap.UMAP(
        n_components=2,
        output_metric="haversine",
        n_neighbors=30,
        min_dist=0.1,
        metric="cosine",
        low_memory=True,
        verbose=True,
    )
    emb = reducer.fit_transform(Xp)
    print(f"[{time.strftime('%H:%M:%S')}] done. emb shape: {emb.shape}, "
          f"range: ({emb.min():.2f}, {emb.max():.2f})", flush=True)

    # Convert (theta, phi) → unit-sphere XYZ → (lat, lon). This handles the
    # unconstrained UMAP output via spherical coord wrap-around.
    theta = emb[:, 0].astype(np.float64)  # treated as latitude in radians
    phi = emb[:, 1].astype(np.float64)    # treated as longitude in radians
    x = np.cos(theta) * np.cos(phi)
    y = np.sin(theta)                      # may be > 1 in magnitude
    z = np.cos(theta) * np.sin(phi)
    # Re-normalize to unit sphere (collapses latitudes outside [-pi/2, pi/2]).
    n = np.sqrt(x*x + y*y + z*z)
    n[n < 1e-9] = 1e-9
    x /= n; y /= n; z /= n

    lat = np.arcsin(np.clip(y, -1, 1)).astype(np.float32)
    lon = np.arctan2(z, x).astype(np.float32)

    # Interleave lat,lon → binary.
    flat = np.empty(N * 2, dtype=np.float32)
    flat[0::2] = lat
    flat[1::2] = lon
    out_bin.write_bytes(flat.tobytes())
    print(f"  wrote {out_bin} ({out_bin.stat().st_size / 1e6:.1f} MB)", flush=True)

    manifest = {
        "n": int(N),
        "format": "float32 interleaved (lat, lon) radians",
        "lat_range": [-np.pi / 2, np.pi / 2],
        "lon_range": [-np.pi, np.pi],
    }
    out_manifest.write_text(json.dumps(manifest))

    # Compute per-cluster / per-subcluster centroids (spherical mean of unit vectors).
    clusters_path = repo / "data" / "clusters_k50.npz"
    sub_path = chunks_dir / "subcluster_assignments.json"

    centroids: dict[str, dict] = {}

    if clusters_path.exists():
        cl = np.load(clusters_path)
        labels = None
        for k in ("labels", "cluster", "clusters", "y"):
            if k in cl.files:
                labels = cl[k]
                break
        if labels is None:
            labels = cl[cl.files[0]]
        labels = np.asarray(labels).astype(np.int32)
        print(f"  cluster labels: {labels.shape}, unique={len(np.unique(labels))}", flush=True)

        # unit vectors
        vx = (np.cos(lat) * np.cos(lon)).astype(np.float64)
        vy = (np.cos(lat) * np.sin(lon)).astype(np.float64)
        vz = np.sin(lat).astype(np.float64)

        cluster_centroids = {}
        for c in np.unique(labels):
            mask = labels == c
            if mask.sum() == 0:
                continue
            mx, my, mz = vx[mask].mean(), vy[mask].mean(), vz[mask].mean()
            r = (mx * mx + my * my + mz * mz) ** 0.5
            if r < 1e-9:
                continue
            mx, my, mz = mx / r, my / r, mz / r
            clat = float(np.arcsin(mz))
            clon = float(np.arctan2(my, mx))
            cluster_centroids[int(c)] = {
                "lat": clat,
                "lon": clon,
                "count": int(mask.sum()),
            }
        centroids["clusters"] = cluster_centroids

    if sub_path.exists() and "clusters" in centroids:
        sub_doc = json.loads(sub_path.read_text())
        sub_local = np.asarray(sub_doc.get("data", []), dtype=np.int32)
        if sub_local.shape[0] == N:
            vx = (np.cos(lat) * np.cos(lon)).astype(np.float64)
            vy = (np.cos(lat) * np.sin(lon)).astype(np.float64)
            vz = np.sin(lat).astype(np.float64)
            sub_centroids: dict[str, dict] = {}
            unique_cl = np.unique(labels)
            for c in unique_cl:
                for s in np.unique(sub_local[labels == c]):
                    if s < 0:
                        continue
                    mask = (labels == c) & (sub_local == s)
                    if mask.sum() == 0:
                        continue
                    mx, my, mz = vx[mask].mean(), vy[mask].mean(), vz[mask].mean()
                    r = (mx * mx + my * my + mz * mz) ** 0.5
                    if r < 1e-9:
                        continue
                    mx, my, mz = mx / r, my / r, mz / r
                    sub_centroids[f"{int(c)}_{int(s)}"] = {
                        "cl": int(c),
                        "sub": int(s),
                        "lat": float(np.arcsin(mz)),
                        "lon": float(np.arctan2(my, mx)),
                        "count": int(mask.sum()),
                    }
            centroids["subclusters"] = sub_centroids

    out_centroids.write_text(json.dumps(centroids))
    print(f"  wrote {out_centroids}", flush=True)
    print(f"[{time.strftime('%H:%M:%S')}] all done.", flush=True)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Lloyd-style smoothing on the sphere.

Starting from the current sphere_coords.bin (radially-projected t-SNE-3D),
compute each point's k nearest neighbors in the original high-dim embedding
space (once), then iteratively move each point toward the spherical mean
of its neighbors' positions. This repairs the worst "antipodes" artifacts
from radial projection while preserving the t-SNE-induced topology.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)

ITER = 14          # smoothing iterations
K = 20             # neighbors to average
STEP = 0.35        # fraction of the way toward the neighbor-mean each pass


def spherical_mean(vecs_xyz):
    """Mean of unit vectors, re-normalized to the sphere."""
    m = vecs_xyz.mean(axis=0)
    n = np.linalg.norm(m)
    if n < 1e-9:
        return None
    return m / n


def main():
    repo = Path(__file__).resolve().parents[1]
    chunks = repo / "viz" / "tsne_chunks"
    emb_npz = repo / "data" / "embeddings_bge_large_en_v1_5.npz"

    print(f"[{time.strftime('%H:%M:%S')}] loading embeddings + sphere coords…", flush=True)
    X = np.load(emb_npz, allow_pickle=True)["embeddings"].astype(np.float32)
    buf = (chunks / "sphere_coords.bin").read_bytes()
    coords = np.frombuffer(buf, dtype=np.float32).reshape(-1, 2).copy()
    N = coords.shape[0]
    assert X.shape[0] == N, f"N mismatch {X.shape[0]} vs {N}"

    # Reduce embedding dim for fast kNN (kNN on 1024-D with 422k points is
    # unnecessary; PCA-50 captures enough of the manifold).
    print(f"[{time.strftime('%H:%M:%S')}] PCA(50)…", flush=True)
    from sklearn.decomposition import PCA
    Xp = PCA(n_components=50, random_state=0).fit_transform(X).astype(np.float32)

    # kNN graph on PCA-50 with cosine — the same metric t-SNE used.
    print(f"[{time.strftime('%H:%M:%S')}] building kNN (k={K}) in PCA-50 cosine…", flush=True)
    from sklearn.neighbors import NearestNeighbors
    # Cosine metric via normalized vectors + L2 inner BallTree would be faster,
    # but sklearn supports 'cosine' directly for brute force; use 'auto' here.
    # We actually get faster results by normalizing and using Euclidean.
    norms = np.linalg.norm(Xp, axis=1, keepdims=True)
    norms[norms < 1e-9] = 1
    Xn = (Xp / norms).astype(np.float32)

    nn = NearestNeighbors(n_neighbors=K + 1, algorithm="ball_tree", n_jobs=-1)
    nn.fit(Xn)
    _, neigh = nn.kneighbors(Xn, return_distance=True)
    # Drop self (column 0)
    neigh = neigh[:, 1:]
    print(f"[{time.strftime('%H:%M:%S')}] neighbors shape: {neigh.shape}", flush=True)

    # Convert current lat/lon → xyz
    def latlon_to_xyz(lat, lon):
        cl = np.cos(lat)
        return np.stack([cl * np.cos(lon), np.sin(lat), cl * np.sin(lon)], axis=1)

    xyz = latlon_to_xyz(coords[:, 0], coords[:, 1]).astype(np.float64)

    # Iterate Lloyd smoothing
    for it in range(ITER):
        t0 = time.time()
        # Average of each point's neighbors' xyz positions → spherical mean
        # Then slerp current point toward the mean by STEP.
        neigh_xyz = xyz[neigh]              # shape (N, K, 3)
        mean_xyz = neigh_xyz.mean(axis=1)   # (N, 3)
        mean_norm = np.linalg.norm(mean_xyz, axis=1, keepdims=True)
        mean_norm[mean_norm < 1e-9] = 1
        target = mean_xyz / mean_norm
        # Blend (linear) then re-normalize — good-enough approximation of slerp
        # for small steps.
        new = xyz * (1 - STEP) + target * STEP
        newn = np.linalg.norm(new, axis=1, keepdims=True)
        newn[newn < 1e-9] = 1
        xyz = new / newn
        dt = time.time() - t0
        # Mean angular displacement
        cos_disp = np.sum(xyz * target, axis=1).clip(-1, 1)
        avg_disp_deg = float(np.degrees(np.arccos(cos_disp)).mean())
        print(f"[{time.strftime('%H:%M:%S')}] iter {it+1}/{ITER}  "
              f"avg_angle_to_target={avg_disp_deg:.2f}°  ({dt:.1f}s)", flush=True)

    lat = np.arcsin(np.clip(xyz[:, 1], -1, 1)).astype(np.float32)
    lon = np.arctan2(xyz[:, 2], xyz[:, 0]).astype(np.float32)

    # Backup current bin
    cur = chunks / "sphere_coords.bin"
    cur.replace(chunks / "sphere_coords.pre_lloyd.bin")

    flat = np.empty(N * 2, dtype=np.float32)
    flat[0::2] = lat
    flat[1::2] = lon
    cur.write_bytes(flat.tobytes())
    print(f"  wrote {cur} ({cur.stat().st_size/1e6:.1f} MB)", flush=True)

    # Recompute centroids
    cl_npz = repo / "data" / "clusters_k50.npz"
    sub_json = chunks / "subcluster_assignments.json"
    out_centroids = chunks / "sphere_centroids.json"
    centroids = {}
    if cl_npz.exists():
        cl = np.load(cl_npz)
        labels = None
        for k in ("labels", "cluster", "clusters", "y"):
            if k in cl.files:
                labels = cl[k]; break
        if labels is None:
            labels = cl[cl.files[0]]
        labels = np.asarray(labels, dtype=np.int32)
        cc = {}
        for c in np.unique(labels):
            mask = labels == c
            mx, my, mz = xyz[mask, 0].mean(), xyz[mask, 1].mean(), xyz[mask, 2].mean()
            r = (mx*mx + my*my + mz*mz) ** 0.5
            if r < 1e-9: continue
            cc[int(c)] = {
                "lat": float(np.arcsin(my/r)),
                "lon": float(np.arctan2(mz/r, mx/r)),
                "count": int(mask.sum()),
            }
        centroids["clusters"] = cc

        if sub_json.exists():
            sub_local = np.asarray(json.loads(sub_json.read_text())["data"], dtype=np.int32)
            sc = {}
            for c in np.unique(labels):
                for s in np.unique(sub_local[labels == c]):
                    if s < 0: continue
                    mask = (labels == c) & (sub_local == s)
                    if mask.sum() == 0: continue
                    mx, my, mz = xyz[mask, 0].mean(), xyz[mask, 1].mean(), xyz[mask, 2].mean()
                    r = (mx*mx + my*my + mz*mz) ** 0.5
                    if r < 1e-9: continue
                    sc[f"{int(c)}_{int(s)}"] = {
                        "cl": int(c), "sub": int(s),
                        "lat": float(np.arcsin(my/r)),
                        "lon": float(np.arctan2(mz/r, mx/r)),
                        "count": int(mask.sum()),
                    }
            centroids["subclusters"] = sc
    out_centroids.write_text(json.dumps(centroids))
    print(f"  wrote {out_centroids}", flush=True)
    print(f"[{time.strftime('%H:%M:%S')}] all done.", flush=True)


if __name__ == "__main__":
    main()

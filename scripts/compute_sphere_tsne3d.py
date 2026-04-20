#!/usr/bin/env python3
"""
3D openTSNE on PCA-50 embeddings, then normalize to unit sphere.

t-SNE has tighter local-distance preservation than UMAP and produces
denser, more isotropic 3D blobs that look more uniform after radial
normalization than UMAP-3D did.

Output goes to viz/tsne_chunks/sphere_coords.bin (overwrites existing).
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(line_buffering=True)

# Block transitive TF imports — same workaround as compute_sphere_coords.py
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
    print(f"  shape: {X.shape}", flush=True)

    print(f"[{time.strftime('%H:%M:%S')}] PCA(50)…", flush=True)
    from sklearn.decomposition import PCA
    pca = PCA(n_components=50, random_state=0)
    Xp = pca.fit_transform(X)

    print(f"[{time.strftime('%H:%M:%S')}] openTSNE 3D…", flush=True)
    from openTSNE import TSNE
    tsne = TSNE(
        n_components=3,
        perplexity=30,
        metric="cosine",
        n_jobs=os.cpu_count() or 8,
        verbose=True,
        random_state=42,
        n_iter=300,                       # truncated for speed
        early_exaggeration_iter=120,
        negative_gradient_method="bh",
        theta=0.7,                        # Barnes-Hut speed > accuracy
    )
    emb = tsne.fit(Xp)
    emb = np.asarray(emb)
    print(f"[{time.strftime('%H:%M:%S')}] done. shape={emb.shape}, range="
          f"({emb.min():.2f}, {emb.max():.2f})", flush=True)

    # Whiten so the 3D blob is more isotropic (each axis std ≈ 1) before
    # radial normalization. Otherwise long axes dominate and the sphere
    # collapses along narrow directions.
    emb = emb - emb.mean(axis=0, keepdims=True)
    stds = emb.std(axis=0, keepdims=True)
    stds[stds < 1e-9] = 1
    emb = emb / stds

    norms = np.linalg.norm(emb, axis=1, keepdims=True)
    norms[norms < 1e-9] = 1e-9
    unit = (emb / norms).astype(np.float32)

    lat = np.arcsin(np.clip(unit[:, 1], -1, 1)).astype(np.float32)
    lon = np.arctan2(unit[:, 2], unit[:, 0]).astype(np.float32)

    N = lat.shape[0]
    flat = np.empty(N * 2, dtype=np.float32)
    flat[0::2] = lat
    flat[1::2] = lon
    out_bin.write_bytes(flat.tobytes())
    print(f"  wrote {out_bin} ({out_bin.stat().st_size/1e6:.1f} MB)", flush=True)
    out_manifest.write_text(json.dumps({
        "n": int(N),
        "format": "float32 interleaved (lat, lon) radians",
        "method": "openTSNE-3D + whiten + radial normalize",
    }))

    # Centroids (cluster + subcluster, same logic as the UMAP script)
    cl_npz = repo / "data" / "clusters_k50.npz"
    sub_json = chunks_dir / "subcluster_assignments.json"
    centroids: dict = {}
    if cl_npz.exists():
        cl = np.load(cl_npz)
        for k in ("labels", "cluster", "clusters", "y"):
            if k in cl.files: labels = cl[k]; break
        else:
            labels = cl[cl.files[0]]
        labels = np.asarray(labels, dtype=np.int32)

        vx = (np.cos(lat) * np.cos(lon)).astype(np.float64)
        vy = (np.cos(lat) * np.sin(lon)).astype(np.float64)
        vz = np.sin(lat).astype(np.float64)
        cluster_centroids = {}
        for c in np.unique(labels):
            mask = labels == c
            mx, my, mz = vx[mask].mean(), vy[mask].mean(), vz[mask].mean()
            r = (mx*mx + my*my + mz*mz) ** 0.5
            if r < 1e-9: continue
            cluster_centroids[int(c)] = {
                "lat": float(np.arcsin(mz/r)),
                "lon": float(np.arctan2(my/r, mx/r)),
                "count": int(mask.sum()),
            }
        centroids["clusters"] = cluster_centroids

        if sub_json.exists():
            sub_local = np.asarray(json.loads(sub_json.read_text())["data"], dtype=np.int32)
            sub_centroids = {}
            for c in np.unique(labels):
                for s in np.unique(sub_local[labels == c]):
                    if s < 0: continue
                    mask = (labels == c) & (sub_local == s)
                    if mask.sum() == 0: continue
                    mx, my, mz = vx[mask].mean(), vy[mask].mean(), vz[mask].mean()
                    r = (mx*mx + my*my + mz*mz) ** 0.5
                    if r < 1e-9: continue
                    sub_centroids[f"{int(c)}_{int(s)}"] = {
                        "cl": int(c), "sub": int(s),
                        "lat": float(np.arcsin(mz/r)),
                        "lon": float(np.arctan2(my/r, mx/r)),
                        "count": int(mask.sum()),
                    }
            centroids["subclusters"] = sub_centroids

    out_centroids.write_text(json.dumps(centroids))
    print(f"  wrote {out_centroids}", flush=True)
    print(f"[{time.strftime('%H:%M:%S')}] all done.", flush=True)


if __name__ == "__main__":
    main()

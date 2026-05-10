#!/usr/bin/env python3
"""
Principled spherical embedding via manifold-constrained optimization.

Optimizes 3D unit vectors directly on S^2 using a UMAP-style attractive/
repulsive loss. Gradient steps live in ambient R^3, and after each step
positions are projected back to ||v||=1 (retraction). No coordinate chart
means no pole singularity — the artifact UMAP-haversine has at lat=±π/2.

Pipeline:
  1. Load BGE embeddings (1024-D) → PCA(50)
  2. Build kNN graph on PCA-50 (cosine, normalized → Euclidean, sklearn BallTree)
  3. Warm-start from current radial-projected sphere_coords (so topology is
     preserved; no large-scale reshuffle)
  4. Optimize: pull edges close (attract), push random pairs apart (repel),
     output distance = 1 - u·v (monotone with geodesic angle).
  5. After each step, normalize each row to unit length.

Output (does NOT overwrite the existing sphere_coords.bin):
  viz/tsne_chunks/sphere_coords_pymde.bin   — float32 interleaved (lat, lon)
  viz/tsne_chunks/sphere_centroids_pymde.json — per-cluster centroids
  viz/tsne_chunks/sphere_manifest_pymde.json

Toggle in the viewer: append #layout=pymde to the URL or set
localStorage.layout='pymde'.

Usage:
  python3 scripts/compute_sphere_pymde.py            # default 30 epochs
  python3 scripts/compute_sphere_pymde.py --epochs 60
  python3 scripts/compute_sphere_pymde.py --device cuda  # if you have a GPU
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)
sys.modules["tensorflow"] = None  # type: ignore[assignment]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--k", type=int, default=20, help="kNN edges per point")
    ap.add_argument("--neg", type=int, default=5, help="negative samples per edge")
    ap.add_argument("--lr", type=float, default=0.05)
    ap.add_argument("--device", default="cpu", choices=("cpu", "cuda", "mps"))
    ap.add_argument("--warm", default="sphere_coords.bin",
                    help="Binary to warm-start from (lat,lon float32 interleaved). "
                         "Use 'random' for cold start.")
    args = ap.parse_args()

    repo = Path(__file__).resolve().parents[1]
    emb_path = repo / "data" / "embeddings_bge_large_en_v1_5.npz"
    chunks = repo / "viz" / "tsne_chunks"
    out_bin = chunks / "sphere_coords_pymde.bin"
    out_centroids = chunks / "sphere_centroids_pymde.json"
    out_manifest = chunks / "sphere_manifest_pymde.json"

    print(f"[{time.strftime('%H:%M:%S')}] loading embeddings…", flush=True)
    X = np.load(emb_path, allow_pickle=True)["embeddings"].astype(np.float32)
    N = X.shape[0]
    print(f"  {X.shape}", flush=True)

    print(f"[{time.strftime('%H:%M:%S')}] PCA(50)…", flush=True)
    from sklearn.decomposition import PCA
    Xp = PCA(n_components=50, random_state=0).fit_transform(X).astype(np.float32)
    norms = np.linalg.norm(Xp, axis=1, keepdims=True); norms[norms < 1e-9] = 1
    Xn = (Xp / norms).astype(np.float32)

    print(f"[{time.strftime('%H:%M:%S')}] kNN k={args.k} (cosine via normalized L2)…", flush=True)
    from sklearn.neighbors import NearestNeighbors
    nn = NearestNeighbors(n_neighbors=args.k + 1, algorithm="ball_tree", n_jobs=-1)
    nn.fit(Xn)
    _, neigh = nn.kneighbors(Xn)
    neigh = neigh[:, 1:].astype(np.int64)  # drop self
    # Edge list (i, j) for i in [0..N), j in neigh[i]
    edges_i = np.repeat(np.arange(N, dtype=np.int64), args.k)
    edges_j = neigh.reshape(-1)
    print(f"  edges: {edges_i.shape[0]:,}", flush=True)

    # Warm-start positions
    if args.warm != "random":
        warm_path = chunks / args.warm
        print(f"[{time.strftime('%H:%M:%S')}] warm-start from {warm_path.name}…", flush=True)
        coords = np.frombuffer(warm_path.read_bytes(), dtype=np.float32).reshape(-1, 2).copy()
        lat0 = coords[:, 0]; lon0 = coords[:, 1]
        cl_ = np.cos(lat0)
        U0 = np.stack([cl_ * np.cos(lon0), np.sin(lat0), cl_ * np.sin(lon0)], axis=1).astype(np.float32)
    else:
        print(f"[{time.strftime('%H:%M:%S')}] random init on sphere…", flush=True)
        rng = np.random.default_rng(42)
        U0 = rng.standard_normal((N, 3)).astype(np.float32)
        U0 /= np.linalg.norm(U0, axis=1, keepdims=True).clip(1e-9)

    # PyTorch optimization loop on the manifold S^2.
    import torch
    device = torch.device(args.device)
    print(f"[{time.strftime('%H:%M:%S')}] optimizing on {device} for {args.epochs} epochs…", flush=True)

    U = torch.tensor(U0, device=device, requires_grad=False)
    Ei = torch.tensor(edges_i, device=device)
    Ej = torch.tensor(edges_j, device=device)

    # Number of (positive) edges
    M = Ei.shape[0]
    # Mini-batch size: enough to use vectorization, small enough to fit
    BATCH = 1 << 16  # 65,536 edges per step
    rng_t = torch.Generator(device=device).manual_seed(0)

    for epoch in range(args.epochs):
        t0 = time.time()
        # Decay learning rate linearly so late epochs polish, not perturb.
        lr = args.lr * (1 - epoch / max(1, args.epochs))

        # Shuffle edges for this epoch
        perm = torch.randperm(M, generator=rng_t, device=device)

        for start in range(0, M, BATCH):
            idx = perm[start:start + BATCH]
            i = Ei[idx]
            j = Ej[idx]

            ui = U[i]                                  # (B, 3)
            uj = U[j]                                  # (B, 3)
            # Negative samples: random points on the sphere from the dataset.
            # B*neg samples, vectorized.
            B = ui.shape[0]
            neg_idx = torch.randint(0, N, (B, args.neg), generator=rng_t, device=device)
            un = U[neg_idx]                            # (B, neg, 3)

            # Output similarity = u · v (in [-1, 1]); we want sim_pos high, sim_neg low.
            sim_pos = (ui * uj).sum(-1)                # (B,)
            sim_neg = (ui.unsqueeze(1) * un).sum(-1)   # (B, neg)

            # Gradient of attractive force on i and j is +(uj - sim_pos*ui) on i
            # (the tangent component pointing toward j after projection).
            # Use a UMAP-style sigmoid scaling: stronger when sim is low.
            attr_w = (1.0 - sim_pos).clamp(min=0).unsqueeze(-1)        # (B, 1)
            grad_i_attr = -attr_w * (uj - sim_pos.unsqueeze(-1) * ui)
            grad_j_attr = -attr_w * (ui - sim_pos.unsqueeze(-1) * uj)

            # Repulsive: push apart only when too close (sim_neg > some threshold).
            rep_w = (sim_neg + 0.5).clamp(min=0).unsqueeze(-1) / args.neg  # (B, neg, 1)
            # tangent component of un on i: un - sim_neg*ui
            grad_i_rep = (rep_w * (un - sim_neg.unsqueeze(-1) * ui.unsqueeze(1))).sum(dim=1)

            # Apply gradients (note negative gradients = step direction).
            U.index_add_(0, i, lr * (grad_i_attr + grad_i_rep))
            U.index_add_(0, j, lr * grad_j_attr)

            # Retraction: project rows back to the sphere.
            # Only the rows we touched, but easier to just renormalize all.
            # (Cheap: one division per epoch is fine.)
        nrm = torch.linalg.norm(U, dim=1, keepdim=True).clamp(min=1e-9)
        U = U / nrm

        dt = time.time() - t0
        with torch.no_grad():
            mean_pos = (U[Ei] * U[Ej]).sum(-1).mean().item()
        print(f"  epoch {epoch+1:3d}/{args.epochs}  "
              f"lr={lr:.4f}  mean_edge_sim={mean_pos:+.3f}  {dt:.1f}s", flush=True)

    U_np = U.detach().cpu().numpy().astype(np.float64)
    U_np /= np.linalg.norm(U_np, axis=1, keepdims=True).clip(1e-9)

    lat = np.arcsin(np.clip(U_np[:, 1], -1, 1)).astype(np.float32)
    lon = np.arctan2(U_np[:, 2], U_np[:, 0]).astype(np.float32)

    flat = np.empty(N * 2, dtype=np.float32)
    flat[0::2] = lat; flat[1::2] = lon
    out_bin.write_bytes(flat.tobytes())
    print(f"[{time.strftime('%H:%M:%S')}] wrote {out_bin} "
          f"({out_bin.stat().st_size/1e6:.1f} MB)", flush=True)

    out_manifest.write_text(json.dumps({
        "n": int(N),
        "format": "float32 interleaved (lat, lon) radians",
        "method": "manifold UMAP on S^2 (3D unit-vector retraction)",
        "epochs": args.epochs,
        "k": args.k,
        "neg": args.neg,
        "warm": args.warm,
    }))

    # Centroids — same logic as the existing sphere scripts.
    cl_npz = repo / "data" / "clusters_k50.npz"
    sub_json = chunks / "subcluster_assignments.json"
    centroids: dict = {}
    if cl_npz.exists():
        cl = np.load(cl_npz)
        labels = None
        for k in ("labels", "cluster", "clusters", "y"):
            if k in cl.files:
                labels = cl[k]; break
        if labels is None:
            labels = cl[cl.files[0]]
        labels = np.asarray(labels, dtype=np.int32)

        vx = (np.cos(lat) * np.cos(lon)).astype(np.float64)
        vy = (np.cos(lat) * np.sin(lon)).astype(np.float64)
        vz = np.sin(lat).astype(np.float64)
        cluster_centroids = {}
        for c in np.unique(labels):
            mask = labels == c
            if mask.sum() == 0: continue
            mx, my, mz = vx[mask].mean(), vy[mask].mean(), vz[mask].mean()
            r = (mx*mx + my*my + mz*mz) ** 0.5
            if r < 1e-9: continue
            cluster_centroids[int(c)] = {
                "lat": float(np.arcsin(mz / r)),
                "lon": float(np.arctan2(my / r, mx / r)),
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
                        "lat": float(np.arcsin(mz / r)),
                        "lon": float(np.arctan2(my / r, mx / r)),
                        "count": int(mask.sum()),
                    }
            centroids["subclusters"] = sub_centroids

    out_centroids.write_text(json.dumps(centroids))
    print(f"  wrote {out_centroids}", flush=True)
    print(f"[{time.strftime('%H:%M:%S')}] done.", flush=True)


if __name__ == "__main__":
    main()

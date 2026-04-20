#!/usr/bin/env python3
"""
Compute embedding-space subclusters for each top-level cluster.

Steps:
  1. Load BGE embeddings + top-level labels
  2. PCA 1024 → 128
  3. Per cluster: MiniBatchKMeans(k), where k = clamp(round(sqrt(n/500)), 3, 6)
  4. Load chunks → t-SNE centroids per subcluster + 60-text samples
  5. Write data/subcluster_work.json  (intermediate: centroids + samples, for naming)
  6. Write viz/tsne_chunks/subcluster_assignments.json  (422k-entry array for Phase 2)

Usage:
  python compute_subclusters.py
"""
from __future__ import annotations
import json, math, pathlib, random, sys
import numpy as np
from sklearn.decomposition import PCA
from sklearn.cluster import MiniBatchKMeans

ROOT   = pathlib.Path(__file__).parent
DATA   = ROOT / "data"
CHUNKS = ROOT / "viz" / "tsne_chunks"

PCA_DIMS   = 128
SAMPLE_N   = 60
MIN_PTS    = 200   # skip clusters smaller than this
SEED       = 42

def k_for(n: int) -> int:
    return max(3, min(6, round(math.sqrt(n / 500))))


def main() -> None:
    rng = random.Random(SEED)

    # ── 1. Load embeddings ────────────────────────────────────────────────────
    emb_path = DATA / "embeddings_bge_large_en_v1_5.npz"
    print(f"Loading embeddings from {emb_path} …", flush=True)
    z = np.load(emb_path, allow_pickle=True)
    emb = np.asarray(z["embeddings"], dtype=np.float32)   # (N, 1024)
    N, D = emb.shape
    print(f"  {N:,} points, dim={D}", flush=True)

    # ── 2. Load top-level cluster labels ──────────────────────────────────────
    cl_path = DATA / "clusters_k50.npz"
    print(f"Loading cluster labels from {cl_path} …", flush=True)
    c = np.load(cl_path, allow_pickle=True)
    top_labels = np.asarray(c["labels"], dtype=np.int32)   # (N,)
    assert len(top_labels) == N, f"mismatch: {len(top_labels)} vs {N}"

    # ── 3. PCA ────────────────────────────────────────────────────────────────
    print(f"PCA {D} → {PCA_DIMS} …", flush=True)
    pca = PCA(n_components=PCA_DIMS, random_state=SEED)
    X   = pca.fit_transform(emb).astype(np.float32)
    print(f"  explained variance: {pca.explained_variance_ratio_.sum():.3f}", flush=True)
    del emb  # free 1.5 GB

    # ── 4. Per-cluster KMeans ─────────────────────────────────────────────────
    unique_clusters = sorted(set(top_labels.tolist()))
    print(f"Top-level clusters: {unique_clusters}", flush=True)

    # sub_local[i] = local subcluster index (0..k-1) within parent, or 255 if skipped
    sub_local = np.full(N, 255, dtype=np.uint8)
    cluster_to_k: dict[int, int] = {}   # parent → k actually used

    for cl in unique_clusters:
        idx = np.where(top_labels == cl)[0]
        n   = len(idx)
        if n < MIN_PTS:
            print(f"  cluster {cl:2d}: {n} pts — SKIPPED (too small)", flush=True)
            continue
        k = k_for(n)
        cluster_to_k[cl] = k
        print(f"  cluster {cl:2d}: {n:6,} pts → k={k} …", end=" ", flush=True)
        km = MiniBatchKMeans(
            n_clusters=k,
            batch_size=min(4096, n),
            n_init=5,
            random_state=SEED,
        )
        local_labels = km.fit_predict(X[idx]).astype(np.uint8)
        sub_local[idx] = local_labels
        print("done", flush=True)

    print(f"\nSubclustered {len(cluster_to_k)} parent clusters.", flush=True)

    # ── 5. Load chunks: x, y, text per point ─────────────────────────────────
    manifest = json.loads((CHUNKS / "manifest.json").read_text())
    xs = np.empty(N, dtype=np.float32)
    ys = np.empty(N, dtype=np.float32)
    texts: list[str] = [""] * N

    print("\nLoading chunks for centroid + text …", flush=True)
    offset = 0
    for fname in manifest["files"]:
        chunk = json.loads((CHUNKS / fname).read_text())
        n_c   = chunk["n"]
        for j in range(n_c):
            i   = offset + j
            xs[i] = chunk["x"][j]
            ys[i] = chunk["y"][j]
            title = (chunk["title"][j] or "").strip()
            body  = (chunk["panel_body"][j] or "").strip()[:300]
            sub   = chunk["subreddit"][j] or ""
            texts[i] = f"[r/{sub}] {title} {body}".strip()
        offset += n_c
        print(f"  {fname}: {n_c} pts", flush=True)

    # ── 6. Compute centroids + sample texts per subcluster ───────────────────
    work: dict[str, list] = {}   # str(parent_cl) → [{sub, cx, cy, n, sample}]

    for cl, k in cluster_to_k.items():
        entries = []
        for s in range(k):
            mask = (top_labels == cl) & (sub_local == s)
            idx  = np.where(mask)[0]
            if len(idx) == 0:
                continue
            cx  = float(xs[idx].mean())
            cy  = float(ys[idx].mean())
            pool   = [texts[i] for i in idx]
            sample = rng.sample(pool, min(SAMPLE_N, len(pool)))
            entries.append({
                "sub":    s,
                "cx":     round(cx, 3),
                "cy":     round(cy, 3),
                "n":      int(len(idx)),
                "sample": sample,
            })
        work[str(cl)] = entries

    work_path = DATA / "subcluster_work.json"
    work_path.write_text(json.dumps(work, ensure_ascii=False))
    print(f"\nWrote work file → {work_path}  ({work_path.stat().st_size // 1024} KB)", flush=True)

    # ── 7. Write assignments ──────────────────────────────────────────────────
    asgn_path = CHUNKS / "subcluster_assignments.json"
    asgn_path.write_text(json.dumps({
        "n":    N,
        "data": sub_local.tolist(),   # list of uint8 (0..5 or 255)
        "cluster_k": {str(k): v for k, v in cluster_to_k.items()},
    }))
    print(f"Wrote assignments → {asgn_path}  ({asgn_path.stat().st_size // 1024} KB)", flush=True)

    print("\nDone! Next step: read data/subcluster_work.json, name subclusters,")
    print("then run: python name_subclusters.py")


if __name__ == "__main__":
    main()

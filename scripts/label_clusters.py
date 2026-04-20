#!/usr/bin/env python3
"""
Sample ~150 texts per embedding cluster, call Claude to name each one,
compute t-SNE centroids, and write viz/tsne_chunks/cluster_labels.json.

Output JSON format:
{
  "embedding": {
    "0": {"name": "Short cluster name", "cx": 12.3, "cy": -5.6},
    ...
  }
}

Usage:
  python label_clusters.py
  python label_clusters.py --chunks-dir viz/tsne_chunks --sample 150 --out viz/tsne_chunks/cluster_labels.json
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

import anthropic

SAMPLE_PER_CLUSTER = 150
CHUNKS_DIR = Path("viz/tsne_chunks")
OUT_PATH = Path("viz/tsne_chunks/cluster_labels.json")


def load_all_chunks(chunks_dir: Path) -> dict:
    """Load all chunks and return merged arrays."""
    manifest = json.loads((chunks_dir / "manifest.json").read_text())
    all_x, all_y, all_cluster, all_text = [], [], [], []

    print(f"Loading {len(manifest['files'])} chunks…", flush=True)
    for fname in manifest["files"]:
        chunk = json.loads((chunks_dir / fname).read_text())
        n = chunk["n"]
        all_x.extend(chunk["x"])
        all_y.extend(chunk["y"])

        # Get cluster labels — embedding-space clusters
        if "cluster" in chunk:
            all_cluster.extend(chunk["cluster"])
        else:
            all_cluster.extend([-1] * n)

        # Best available text per point
        for j in range(n):
            title = (chunk["title"][j] or "").strip()
            body = (chunk["panel_body"][j] or "").strip()
            sub = chunk["subreddit"][j] or ""
            text = title + ("\n" + body[:400] if body else "") + f"\n[r/{sub}]"
            all_text.append(text.strip())

        print(f"  {fname}: {n} pts  (total so far: {len(all_x)})", flush=True)

    return {
        "x": all_x,
        "y": all_y,
        "cluster": all_cluster,
        "text": all_text,
    }


def group_by_cluster(data: dict) -> dict[int, dict]:
    """Return {cluster_id: {'texts': [...], 'xs': [...], 'ys': [...]}}."""
    groups: dict[int, dict] = {}
    for i, cl in enumerate(data["cluster"]):
        if cl < 0:
            continue
        if cl not in groups:
            groups[cl] = {"texts": [], "xs": [], "ys": []}
        groups[cl]["texts"].append(data["text"][i])
        groups[cl]["xs"].append(data["x"][i])
        groups[cl]["ys"].append(data["y"][i])
    return groups


def compute_centroids(groups: dict[int, dict]) -> dict[int, tuple[float, float]]:
    centroids = {}
    for cl, g in groups.items():
        cx = sum(g["xs"]) / len(g["xs"])
        cy = sum(g["ys"]) / len(g["ys"])
        centroids[cl] = (cx, cy)
    return centroids


def name_clusters_with_claude(
    groups: dict[int, dict],
    sample_n: int,
    client: anthropic.Anthropic,
) -> dict[int, str]:
    """Send all clusters in one prompt; return {cluster_id: name}."""
    cluster_ids = sorted(groups.keys())
    rng = random.Random(42)

    # Build prompt sections
    sections = []
    for cl in cluster_ids:
        texts = groups[cl]["texts"]
        sample = rng.sample(texts, min(sample_n, len(texts)))
        joined = "\n---\n".join(t[:500] for t in sample)
        sections.append(f"=== CLUSTER {cl} ({len(texts)} total points, {len(sample)} shown) ===\n{joined}")

    full_prompt = (
        "Below are text samples from Reddit posts and comments (from r/boston and related MA subreddits) "
        "grouped into embedding clusters. For EACH cluster give a short descriptive name "
        "(2–4 words, title-case, no quotes) that captures its dominant topic or theme.\n\n"
        "Respond ONLY with a JSON object mapping cluster number (as string) to name, like:\n"
        '{"0": "Transit Complaints", "1": "Home Prices", ...}\n\n'
        "No extra text, no markdown fences.\n\n"
        + "\n\n".join(sections)
    )

    print(f"\nSending {len(cluster_ids)} clusters to Claude…", flush=True)
    resp = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": full_prompt}],
    )
    raw = resp.content[0].text.strip()
    print("Raw response:", raw[:200], "…", flush=True)

    names = json.loads(raw)
    return {int(k): v for k, v in names.items()}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--chunks-dir", type=Path, default=CHUNKS_DIR)
    ap.add_argument("--sample", type=int, default=SAMPLE_PER_CLUSTER, help="Texts to sample per cluster")
    ap.add_argument("--out", type=Path, default=OUT_PATH)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    random.seed(args.seed)

    data = load_all_chunks(args.chunks_dir)
    n_labeled = sum(1 for c in data["cluster"] if c >= 0)
    print(f"\nTotal points: {len(data['x'])}, with cluster labels: {n_labeled}", flush=True)

    groups = group_by_cluster(data)
    print(f"Clusters found: {sorted(groups.keys())}", flush=True)

    centroids = compute_centroids(groups)

    client = anthropic.Anthropic()
    names = name_clusters_with_claude(groups, args.sample, client)

    result = {"embedding": {}}
    for cl in sorted(groups.keys()):
        cx, cy = centroids[cl]
        name = names.get(cl, f"Cluster {cl}")
        result["embedding"][str(cl)] = {"name": name, "cx": round(cx, 3), "cy": round(cy, 3)}
        print(f"  cluster {cl:2d}: {name}  (centroid {cx:.1f}, {cy:.1f})", flush=True)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False))
    print(f"\nWrote {args.out}", flush=True)


if __name__ == "__main__":
    main()

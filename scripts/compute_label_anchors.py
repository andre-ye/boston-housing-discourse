"""Compute label anchors that sit inside actually-dense blobs of each cluster and
subcluster — the spherical centroid drifts into empty space when clusters sprawl
across the globe, so we pick the point with the most intra-cluster neighbors
within a small angular radius instead.

Output: viz/tsne_chunks/label_anchors.json
  {
    "clusters":    { "<cl>": { "lat":..., "lon":..., "count":..., "density":..., "method":"density-peak"|"centroid" } },
    "subclusters": { "<cl>_<sub>": { ... } }
  }

Usage: python scripts/compute_label_anchors.py
"""
from __future__ import annotations
import json
import math
import struct
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CHUNKS = ROOT / "viz" / "tsne_chunks"

RADIUS = 0.20      # angular radius (rad) for neighbor-counting window
MIN_POINTS = 120   # below this, just use centroid (too few to find a peak)
SUBSAMPLE = 4000   # cap per-cluster density search for speed


def load_coords() -> np.ndarray:
    buf = (CHUNKS / "sphere_coords.bin").read_bytes()
    arr = np.frombuffer(buf, dtype=np.float32)
    return arr.reshape(-1, 2)  # (N, 2) = (lat, lon)


def load_labels(n: int) -> tuple[np.ndarray, np.ndarray]:
    buf = (CHUNKS / "point_labels.bin").read_bytes()
    a = np.frombuffer(buf, dtype=np.uint8).reshape(n, 3)
    lo, hi, sub = a[:, 0].astype(np.int32), a[:, 1].astype(np.int32), a[:, 2]
    cl = (hi << 8) | lo
    cl = np.where(cl >= 0x8000, cl - 0x10000, cl).astype(np.int16)
    return cl, sub


def to_xyz(latlon: np.ndarray) -> np.ndarray:
    lat, lon = latlon[:, 0], latlon[:, 1]
    cl = np.cos(lat)
    return np.stack([cl * np.cos(lon), np.sin(lat), cl * np.sin(lon)], axis=1)


def centroid(xyz: np.ndarray) -> tuple[float, float]:
    c = xyz.mean(axis=0)
    r = np.linalg.norm(c) or 1.0
    c = c / r
    lat = math.asin(float(c[1]))
    lon = math.atan2(float(c[2]), float(c[0]))
    return lat, lon


def density_peak(xyz: np.ndarray, radius: float) -> tuple[int, int]:
    """Return (best_index_in_input, neighbor_count) of the point with the most
    neighbors within `radius` (great-circle, unit sphere)."""
    n = len(xyz)
    if n > SUBSAMPLE:
        stride = max(1, n // SUBSAMPLE)
        sample_idx = np.arange(0, n, stride)[:SUBSAMPLE]
    else:
        sample_idx = np.arange(n)
    sub = xyz[sample_idx]
    cos_r = math.cos(radius)
    # Dot products (cos of angle) — block to keep memory reasonable.
    best = -1
    best_count = -1
    BS = 256
    for i in range(0, len(sub), BS):
        dots = sub[i:i + BS] @ sub.T
        counts = (dots > cos_r).sum(axis=1)
        local = int(counts.argmax())
        if counts[local] > best_count:
            best_count = int(counts[local])
            best = int(sample_idx[i + local])
    return best, best_count


def secondary_peaks(xyz: np.ndarray, radius: float, k: int, min_sep: float) -> list[tuple[int, int]]:
    """Greedy top-k density peaks with min angular separation `min_sep` between peaks."""
    n = len(xyz)
    stride = max(1, n // SUBSAMPLE)
    sample_idx = np.arange(0, n, stride)[:SUBSAMPLE]
    sub = xyz[sample_idx]
    cos_r = math.cos(radius)
    cos_sep = math.cos(min_sep)
    counts = np.zeros(len(sub), dtype=np.int32)
    BS = 256
    for i in range(0, len(sub), BS):
        dots = sub[i:i + BS] @ sub.T
        counts[i:i + BS] = (dots > cos_r).sum(axis=1)
    order = counts.argsort()[::-1]
    picked: list[tuple[int, int]] = []
    picked_vecs: list[np.ndarray] = []
    for local in order:
        v = sub[local]
        if any(float(v @ pv) > cos_sep for pv in picked_vecs):
            continue
        picked.append((int(sample_idx[local]), int(counts[local])))
        picked_vecs.append(v)
        if len(picked) >= k:
            break
    return picked


def anchor_for(xyz_sub: np.ndarray, radius: float) -> dict:
    n = len(xyz_sub)
    if n == 0:
        return {"lat": 0.0, "lon": 0.0, "count": 0, "density": 0.0, "method": "empty"}
    cen_lat, cen_lon = centroid(xyz_sub)
    if n < MIN_POINTS:
        return {"lat": cen_lat, "lon": cen_lon, "count": n, "density": 1.0, "method": "centroid"}
    best_i, best_count = density_peak(xyz_sub, radius)
    v = xyz_sub[best_i]
    lat = math.asin(float(v[1]))
    lon = math.atan2(float(v[2]), float(v[0]))
    # sample size used for density
    sample_n = min(n, SUBSAMPLE)
    density = best_count / sample_n
    # Secondary peaks for sprawly clusters (separated by >1 rad ~ 57°)
    peaks = []
    if density < 0.30:
        sp = secondary_peaks(xyz_sub, radius, k=3, min_sep=1.0)
        for idx, cnt in sp:
            pv = xyz_sub[idx]
            peaks.append({
                "lat": math.asin(float(pv[1])),
                "lon": math.atan2(float(pv[2]), float(pv[0])),
                "density": cnt / sample_n,
            })
    out = {
        "lat": lat, "lon": lon, "count": n,
        "density": round(density, 3),
        "method": "density-peak",
        "fallback_lat": cen_lat, "fallback_lon": cen_lon,
    }
    if peaks:
        out["peaks"] = peaks
    return out


def main():
    latlon = load_coords()
    n = len(latlon)
    cl, sub = load_labels(n)
    xyz = to_xyz(latlon)

    clusters = sorted({int(c) for c in cl if c >= 0})
    out_clusters: dict[str, dict] = {}
    for c in clusters:
        mask = (cl == c)
        xyz_c = xyz[mask]
        out_clusters[str(c)] = anchor_for(xyz_c, RADIUS)

    out_subs: dict[str, dict] = {}
    for c in clusters:
        mask_c = (cl == c)
        if not mask_c.any():
            continue
        sub_c = sub[mask_c]
        xyz_c = xyz[mask_c]
        uniq = sorted({int(s) for s in sub_c})
        for s in uniq:
            m = (sub_c == s)
            xyz_s = xyz_c[m]
            out_subs[f"{c}_{s}"] = anchor_for(xyz_s, RADIUS * 0.6)

    out_path = CHUNKS / "label_anchors.json"
    payload = {
        "radius_rad": RADIUS,
        "clusters": out_clusters,
        "subclusters": out_subs,
    }
    out_path.write_text(json.dumps(payload))
    print(f"Wrote {out_path} — {len(out_clusters)} clusters, {len(out_subs)} subs.")
    # Print top offenders where centroid and density peak disagree significantly
    big = []
    for k, v in out_clusters.items():
        if "fallback_lat" not in v:
            continue
        fv = np.array([
            math.cos(v["fallback_lat"]) * math.cos(v["fallback_lon"]),
            math.sin(v["fallback_lat"]),
            math.cos(v["fallback_lat"]) * math.sin(v["fallback_lon"]),
        ])
        pv = np.array([
            math.cos(v["lat"]) * math.cos(v["lon"]),
            math.sin(v["lat"]),
            math.cos(v["lat"]) * math.sin(v["lon"]),
        ])
        d = math.acos(max(-1, min(1, float(fv @ pv))))
        if d > 0.2:
            big.append((d, k, v["count"], v["density"]))
    big.sort(reverse=True)
    print("\nClusters whose density-peak moved >0.2 rad from centroid:")
    for d, k, n_, dens in big[:15]:
        print(f"  cl {k:>3}  moved {d:.2f} rad  (n={n_}, density={dens})")


if __name__ == "__main__":
    main()

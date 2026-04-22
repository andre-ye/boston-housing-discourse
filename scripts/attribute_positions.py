"""Attribute each point in each sub-cluster to one of the LLM-generated
*positions* for that sub (a position = a short, statement-like stance),
or leave it as "other" if no position fits. Also computes a density-peak
anchor per position so the globe can label it.

Input:  viz/tsne_chunks/positions.json, subcluster_labels.json,
        point_labels.bin, sphere_coords.bin, and the chunk files.
Output:
  viz/tsne_chunks/position_assignments.bin   (uint8 per point = position idx,
                                              255 = unassigned/other)
  viz/tsne_chunks/position_anchors.json      ({gid: {positions: [{idx, lat,
                                              lon, count, density, name}]}})

Matching: per-point text (title + body prefix) scored against the position's
keywords + name. Keywords come as phrases — multi-word hits are worth more
than single-word hits. Only points whose best score passes a floor are
attributed; everyone else becomes "other". This guards against forced
labelling of posts that simply don't discuss the position.
"""
from __future__ import annotations
import json, math, re, struct
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CHUNKS = ROOT / "viz" / "tsne_chunks"

WORD = re.compile(r"[A-Za-z][A-Za-z']+")
STOPWORDS = set("a an the and or but in on at of to for is are be have has with as by from that this those these it its".split())

PHRASE_BOOST = 4.0
KEYWORD_TOKEN_BOOST = 1.5
NAME_TOKEN_BOOST = 1.0
MIN_ATTR_SCORE = 1.0         # below this, the point is "other"
MAX_POSITIONS_PER_SUB = 8    # truncate — too many positions = noisy labels

DENSITY_RADIUS = 0.12        # for density peak within a position
SUBSAMPLE = 1500


def tokens_set(s: str) -> set[str]:
    return {w.lower() for w in WORD.findall(s or "") if len(w) >= 3 and w.lower() not in STOPWORDS}


def prepare_query(pos: dict) -> dict:
    kws = pos.get("keywords") or []
    name = pos.get("name") or ""
    # Keep phrases (multi-word keywords) distinct — they're the strongest signal.
    phrases = [k.lower() for k in kws if k and " " in k]
    singles = set()
    for k in kws:
        for t in tokens_set(k):
            singles.add(t)
    for t in tokens_set(name):
        singles.add(t)
    return {"phrases": phrases, "singles": singles, "name_tokens": tokens_set(name)}


def score(q: dict, text: str) -> float:
    if not text:
        return 0.0
    low = text.lower()
    toks = tokens_set(text)
    s = 0.0
    for p in q["phrases"]:
        if p in low:
            s += PHRASE_BOOST * (1 + p.count(" "))
    for t in q["singles"]:
        if t in toks:
            s += KEYWORD_TOKEN_BOOST
    for t in q["name_tokens"]:
        if t in toks:
            s += NAME_TOKEN_BOOST
    return s


def load_labels(n: int):
    buf = (CHUNKS / "point_labels.bin").read_bytes()
    a = np.frombuffer(buf, dtype=np.uint8).reshape(n, 3)
    lo, hi = a[:, 0].astype(np.int32), a[:, 1].astype(np.int32)
    cl = (hi << 8) | lo
    cl = np.where(cl >= 0x8000, cl - 0x10000, cl).astype(np.int16)
    return cl, a[:, 2]


def latlon_to_xyz(latlon: np.ndarray) -> np.ndarray:
    lat, lon = latlon[:, 0], latlon[:, 1]
    cl = np.cos(lat)
    return np.stack([cl * np.cos(lon), np.sin(lat), cl * np.sin(lon)], axis=1)


def density_peak(xyz: np.ndarray, radius: float) -> tuple[int, int]:
    n = len(xyz)
    if n == 0:
        return -1, 0
    if n > SUBSAMPLE:
        stride = max(1, n // SUBSAMPLE)
        idx = np.arange(0, n, stride)[:SUBSAMPLE]
    else:
        idx = np.arange(n)
    sub = xyz[idx]
    cos_r = math.cos(radius)
    best = -1
    best_count = -1
    BS = 256
    for i in range(0, len(sub), BS):
        dots = sub[i:i + BS] @ sub.T
        counts = (dots > cos_r).sum(axis=1)
        local = int(counts.argmax())
        if counts[local] > best_count:
            best_count = int(counts[local])
            best = int(idx[i + local])
    return best, best_count


def main():
    pos_doc = json.loads((CHUNKS / "positions.json").read_text())["by_gid"]
    sub_meta = json.loads((CHUNKS / "subcluster_labels.json").read_text())

    # Build gid → (cl, sub_local)
    gid_map = {}
    gid = 0
    for cl_str in sorted(sub_meta.keys(), key=int):
        for e in sub_meta[cl_str]:
            gid_map[gid] = (int(cl_str), e["sub"], e.get("name"))
            gid += 1

    # Load point labels + coords
    manifest = json.loads((CHUNKS / "manifest.json").read_text())
    coords = np.frombuffer((CHUNKS / "sphere_coords.bin").read_bytes(),
                           dtype=np.float32).reshape(-1, 2)
    n = len(coords)
    cl_arr, sub_arr = load_labels(n)
    xyz = latlon_to_xyz(coords)

    assignments = np.full(n, 255, dtype=np.uint8)

    # For each (cl, sub), prepare position queries, then attribute points.
    position_anchors = {}
    total_assigned = 0
    for g, (cl, sub, _sub_name) in gid_map.items():
        doc = pos_doc.get(str(g))
        if not doc:
            continue
        positions = (doc.get("positions") or [])[:MAX_POSITIONS_PER_SUB]
        if not positions:
            continue
        queries = [prepare_query(p) for p in positions]

        # Which points are in this sub?
        mask = (cl_arr == cl) & (sub_arr == sub)
        idxs = np.where(mask)[0]
        if len(idxs) == 0:
            continue

        # Fetch titles + bodies for these points from chunks (batched).
        cs = manifest["chunkSize"]
        by_chunk: dict[int, list[int]] = {}
        for gi in idxs:
            by_chunk.setdefault(int(gi) // cs, []).append(int(gi))
        pts_by_pos: list[list[int]] = [[] for _ in positions]
        unassigned_count = 0
        for ci, gis in by_chunk.items():
            ch = json.loads((CHUNKS / manifest["files"][ci]).read_text())
            off = ch["offset"]
            for gi in gis:
                j = gi - off
                title = ch["title"][j] or ""
                body = (ch.get("panel_body") or [""] * ch["n"])[j] or \
                       (ch.get("hover_body") or [""] * ch["n"])[j] or ""
                text = f"{title}\n{body[:600]}"
                # Score against each position
                best_i, best_s = -1, -1.0
                for pi, q in enumerate(queries):
                    s = score(q, text)
                    if s > best_s:
                        best_s = s; best_i = pi
                if best_s >= MIN_ATTR_SCORE and best_i >= 0:
                    assignments[gi] = best_i
                    pts_by_pos[best_i].append(gi)
                    total_assigned += 1
                else:
                    unassigned_count += 1

        # Density-peak per position
        per_pos_out = []
        for pi, pos in enumerate(positions):
            gidxs = pts_by_pos[pi]
            if len(gidxs) == 0:
                per_pos_out.append({
                    "name": pos["name"], "count": 0, "lat": None, "lon": None,
                    "density": 0.0
                })
                continue
            sub_xyz = xyz[gidxs]
            best_local, cnt = density_peak(sub_xyz, DENSITY_RADIUS)
            if best_local < 0:
                per_pos_out.append({
                    "name": pos["name"], "count": len(gidxs), "lat": None, "lon": None,
                    "density": 0.0
                })
                continue
            gi = gidxs[best_local]
            lat = float(coords[gi, 0]); lon = float(coords[gi, 1])
            density = cnt / min(len(gidxs), SUBSAMPLE)
            per_pos_out.append({
                "name": pos["name"],
                "description": pos.get("description", ""),
                "keywords": pos.get("keywords", []),
                "count": len(gidxs),
                "lat": lat, "lon": lon,
                "idx": int(gi),
                "density": round(density, 3),
            })
        position_anchors[str(g)] = {
            "cl": cl, "sub": sub,
            "sub_name": doc.get("sub_name"),
            "cluster_name": doc.get("cluster_name"),
            "total_in_sub": int(len(idxs)),
            "unassigned": int(unassigned_count),
            "positions": per_pos_out,
        }

        if g % 20 == 0:
            print(f"  gid {g:>3}: attributed {sum(len(l) for l in pts_by_pos):>4}/{len(idxs):>4} points")

    # Save
    (CHUNKS / "position_assignments.bin").write_bytes(assignments.tobytes())
    (CHUNKS / "position_anchors.json").write_text(json.dumps(position_anchors))
    print(f"\nTotal points attributed: {total_assigned:,} / {n:,}  "
          f"({100*total_assigned/n:.1f}%)")
    print(f"Position anchors written: {len(position_anchors)} subs")


if __name__ == "__main__":
    main()

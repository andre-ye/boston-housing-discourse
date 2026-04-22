#!/usr/bin/env python3
"""Merge the per-cluster Haiku position files into the three outputs the
viewer consumes:

  viz/tsne_chunks/positions.json
    { "by_gid": { "<gid>": { sub_name, cluster_name, cl, positions: [
        {name, description, keywords, example_sample_indices}, ...
      ] }, ... } }

  viz/tsne_chunks/position_assignments.bin
    uint8 per point — position index within the sub (255 = unassigned).

  viz/tsne_chunks/position_anchors.json
    { "<gid>": { sub_name, cluster_name, cl, positions: [
        {idx, lat, lon, count, density, name}, ...
      ] } }

Gid ordering matches nav.js subGidMap: scan clusters ascending, subs
ascending within each cluster.
"""
from __future__ import annotations
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CHUNKS = ROOT / "viz" / "tsne_chunks"


def spherical_mean(lat_lon: np.ndarray) -> tuple[float, float, float]:
    """Return (lat, lon, |mean|) of points given as Nx2 (lat, lon) radians."""
    if lat_lon.shape[0] == 0:
        return (0.0, 0.0, 0.0)
    cos_lat = np.cos(lat_lon[:, 0])
    x = cos_lat * np.cos(lat_lon[:, 1])
    y = np.sin(lat_lon[:, 0])
    z = cos_lat * np.sin(lat_lon[:, 1])
    mx, my, mz = float(x.mean()), float(y.mean()), float(z.mean())
    r = (mx * mx + my * my + mz * mz) ** 0.5
    if r < 1e-9:
        return (float(lat_lon[0, 0]), float(lat_lon[0, 1]), 1.0)
    return (
        float(np.arcsin(max(-1.0, min(1.0, my / r)))),
        float(np.arctan2(mz / r, mx / r)),
        r,
    )


def main() -> None:
    # Load point-level metadata.
    buf = (CHUNKS / "point_labels.bin").read_bytes()
    N = len(buf) // 3
    cluster = np.empty(N, dtype=np.int16)
    sub_local = np.empty(N, dtype=np.uint8)
    for i in range(N):
        lo = buf[3 * i]; hi = buf[3 * i + 1]
        v = (hi << 8) | lo
        if v & 0x8000:
            v -= 0x10000
        cluster[i] = v
        sub_local[i] = buf[3 * i + 2]
    coords = np.frombuffer(
        (CHUNKS / "sphere_coords.bin").read_bytes(), dtype=np.float32
    ).reshape(-1, 2)

    cluster_meta = json.loads((CHUNKS / "cluster_labels.json").read_text())
    if "embedding" in cluster_meta:
        cluster_meta = cluster_meta["embedding"]
    sub_meta = json.loads((CHUNKS / "subcluster_labels.json").read_text())

    # Enumerate (cl, sub_local) in the same order nav.js uses — this defines
    # the gid assigned to each subcluster.
    group_order: list[tuple[int, int, str]] = []
    for cl_str in sorted(sub_meta.keys(), key=lambda s: int(s)):
        cl = int(cl_str)
        for s in sorted(sub_meta[cl_str], key=lambda d: d["sub"]):
            group_order.append((cl, int(s["sub"]), s["name"]))

    assignments = np.full(N, 255, dtype=np.uint8)
    positions_doc: dict[str, dict] = {}
    anchors_doc: dict[str, dict] = {}

    missing_clusters: list[int] = []
    total_assigned = 0

    for gid, (cl, sub_loc, sub_name) in enumerate(group_order):
        pos_path = DATA / f"cluster_{cl}_positions.json"
        if not pos_path.exists():
            if cl not in missing_clusters:
                missing_clusters.append(cl)
            continue
        try:
            doc = json.loads(pos_path.read_text())
        except Exception as exc:
            print(f"skip cl={cl} gid={gid}: bad JSON ({exc})", file=sys.stderr)
            continue
        # Different agents used different top-level keys for the sub list.
        subs = doc.get("subs") or doc.get("subtopics") or []
        # A few agents wrote top-level "positions" as a DICT keyed by
        # sub_N / sub_loc-str whose values ARE the sub documents.
        if not subs and isinstance(doc.get("positions"), dict):
            sd = doc["positions"]
            reconstructed = []
            for k, v in sd.items():
                if not isinstance(v, dict): continue
                rec = dict(v)
                if "sub" not in rec:
                    m = re.search(r"(\d+)", str(k))
                    if m: rec["sub"] = int(m.group(1))
                reconstructed.append(rec)
            subs = reconstructed
        entry = next((s for s in subs if int(s.get("sub", -1)) == sub_loc), None)
        if not entry:
            continue

        positions_raw = entry.get("positions", [])
        # Some agents used singular 'assignment' / 'posts' at the sub level.
        _raw = None
        for k in ("assignments", "assignment", "assigned", "post_assignments"):
            v = entry.get(k)
            if isinstance(v, dict) and v:
                _raw = v
                break
        raw_assign: dict = {}
        if _raw:
            # Detect INVERTED schema: {"<pos_idx>": [<pid>, ...]} rather than
            # {"<pid>": <pos_idx>}. A single value that's a list of ints
            # is the giveaway.
            sample_val = next(iter(_raw.values()))
            if isinstance(sample_val, list):
                for k, v in _raw.items():
                    try:
                        pos_idx = int(k)
                    except (ValueError, TypeError):
                        continue
                    if not isinstance(v, list): continue
                    for pid in v:
                        if isinstance(pid, int):
                            raw_assign[str(pid)] = pos_idx
            else:
                raw_assign = dict(_raw)
        # Some agents wrote a TOP-LEVEL `assignments` dict keyed by post-id.
        # The value is a position index within whichever sub the point belongs
        # to — filter by sub here.
        top_asg = doc.get("assignments")
        if isinstance(top_asg, dict):
            for k, v in top_asg.items():
                try:
                    pid = int(k)
                except (ValueError, TypeError):
                    continue
                if 0 <= pid < N and cluster[pid] == cl and sub_local[pid] == sub_loc:
                    raw_assign.setdefault(str(pid), v)
        # Various agents serialized assignments as a list under
        # `assigned` / `post_assignments`:
        #   [[pid, pos_idx], ...]
        #   [{i, p} | {i, pos}]
        #   [{p: <idx>, post_ids: [pid, ...]}]   (cl=3)
        for k in ("assigned", "post_assignments"):
            v = entry.get(k)
            if not isinstance(v, list):
                continue
            for rec in v:
                if isinstance(rec, list) and len(rec) == 2:
                    raw_assign[str(rec[0])] = rec[1]
                elif isinstance(rec, dict):
                    if "post_ids" in rec and ("p" in rec or "pos" in rec or "idx" in rec):
                        pos_idx = rec.get("p") or rec.get("pos") or rec.get("idx")
                        for pid in rec.get("post_ids") or []:
                            raw_assign[str(pid)] = pos_idx
                        continue
                    pid = rec.get("i") or rec.get("id") or rec.get("idx")
                    pval = rec.get("p") or rec.get("pos") or rec.get("position") or rec.get("idx")
                    if pid is not None and pval is not None:
                        raw_assign[str(pid)] = pval

        cl_name = cluster_meta.get(str(cl), {}).get("name", f"Cluster {cl}")

        # Normalize positions into a LIST of dicts and build a
        # string-key → position-index lookup (for string-keyed assignments).
        positions: list[dict] = []
        string_key_to_idx: dict[str, int] = {}
        # "Inline members per position": a list of post-ids for each position,
        # parallel to `positions`, harvested from whichever field the agent
        # used (value of a dict, `sampled`, `posts`, etc.).
        inline_members_per_pos: list[list] = []
        if isinstance(positions_raw, dict):
            # dict of positions: key is the canonical string id; the VALUE
            # can itself be a list of post-ids (shorthand schema).
            for p_idx, (skey, pdata) in enumerate(positions_raw.items()):
                if isinstance(pdata, list):
                    # {"Name": [pid, pid, ...]}
                    positions.append({"name": str(skey)})
                    string_key_to_idx[str(skey)] = p_idx
                    inline_members_per_pos.append(list(pdata))
                    continue
                if not isinstance(pdata, dict):
                    pdata = {"name": str(pdata)}
                positions.append(pdata)
                string_key_to_idx[str(skey)] = p_idx
                for alias in (pdata.get("name"), pdata.get("p"), pdata.get("id"), pdata.get("position")):
                    if alias is not None:
                        string_key_to_idx[str(alias)] = p_idx
                # Harvest inline members from whichever field the agent used.
                members = []
                for f in ("posts", "post_ids", "assignments", "members", "idxs", "sampled"):
                    v = pdata.get(f)
                    if isinstance(v, list):
                        members.extend(v)
                inline_members_per_pos.append(members)
        elif isinstance(positions_raw, list):
            for p_idx, p in enumerate(positions_raw):
                if not isinstance(p, dict):
                    positions.append({"name": str(p) if p is not None else f"Position {p_idx}"})
                    inline_members_per_pos.append([])
                    continue
                positions.append(p)
                for alias in (p.get("name"), p.get("p"), p.get("id"), p.get("position"),
                              p.get("desc"), p.get("description")):
                    if alias is None:
                        continue
                    s = str(alias)
                    if s and s not in string_key_to_idx:
                        string_key_to_idx[s] = p_idx
                # Look at EVERY plausible inline-members field
                members = []
                for f in ("posts", "post_ids", "assignments", "members", "idxs", "sampled"):
                    v = p.get(f)
                    if isinstance(v, list):
                        members.extend(v)
                inline_members_per_pos.append(members)

        # Build pos_docs for the output positions.json, uniformly.
        pos_docs = []
        for p_idx, p in enumerate(positions):
            if not isinstance(p, dict):
                pos_docs.append({"name": str(p), "description": "",
                                 "keywords": [], "example_sample_indices": []})
                continue
            pos_docs.append({
                "name": p.get("name") or p.get("title") or p.get("p") or p.get("position") or f"Position {p_idx}",
                "description": p.get("description") or p.get("desc") or "",
                "keywords": p.get("keywords", []),
                "example_sample_indices": p.get("example_sample_indices", []),
            })
            for pid in inline_members_per_pos[p_idx] or []:
                raw_assign[str(pid)] = p_idx

        # Inline posts ON the SUB (e.g. [{i: ..., position: "name"}, ...] or
        # [{i, idx}, ...] or [{i, pos: [idx]}]).
        sub_posts = entry.get("posts")
        if isinstance(sub_posts, list):
            for rec in sub_posts:
                if not isinstance(rec, dict):
                    continue
                pid = rec.get("i") or rec.get("idx") or rec.get("id")
                pval = rec.get("position") or rec.get("p") or rec.get("pos") or rec.get("idx")
                if pid is None or pval is None:
                    continue
                # pos might be a single-element list
                if isinstance(pval, list):
                    pval = pval[0] if pval else None
                if pval is None:
                    continue
                raw_assign[str(pid)] = pval

        positions_doc[str(gid)] = {
            "sub_name": sub_name,
            "cluster_name": cl_name,
            "cl": cl,
            "positions": pos_docs,
        }

        # Write per-point assignments for this sub. Handle both int and
        # string values (string → look up via string_key_to_idx).
        for k, v in raw_assign.items():
            try:
                pid = int(k)
            except (ValueError, TypeError):
                continue
            if pid < 0 or pid >= N:
                continue
            idx = None
            if isinstance(v, int):
                idx = v
            elif isinstance(v, str):
                idx = string_key_to_idx.get(v)
            if idx is None or idx < 0 or idx >= len(positions):
                continue
            if cluster[pid] == cl and sub_local[pid] == sub_loc:
                assignments[pid] = idx
                total_assigned += 1

        # Per-position anchors from the points we just assigned.
        anchor_records = []
        for p_idx, p in enumerate(pos_docs):
            mask = (cluster == cl) & (sub_local == sub_loc) & (assignments == p_idx)
            n = int(mask.sum())
            if n > 0:
                lat, lon, density = spherical_mean(coords[mask])
                anchor_records.append({
                    "idx": p_idx, "lat": lat, "lon": lon,
                    "count": n, "density": density, "name": p["name"],
                })
            else:
                anchor_records.append({
                    "idx": p_idx, "lat": None, "lon": None,
                    "count": 0, "density": 0.0, "name": p["name"],
                })
        anchors_doc[str(gid)] = {
            "cl": cl, "sub_name": sub_name, "cluster_name": cl_name,
            "positions": anchor_records,
        }

    # Coverage report (sampled-only pass).
    total_in_subs = sum(1 for i in range(N) if cluster[i] >= 0 and sub_local[i] != 255)
    print(f"[{time.strftime('%H:%M:%S')}] sampled pass  "
          f"{len(positions_doc)} gids, "
          f"{total_assigned:,} / {total_in_subs:,} points assigned "
          f"({100*total_assigned/max(1,total_in_subs):.1f}%)", flush=True)

    # Extend assignments: for every unassigned point, inherit the position
    # of its nearest labeled sibling (same cl + sub) in sphere space.
    # Sphere-space proximity is the same metric that drove the cluster and
    # sub assignments, so close points ~ share stance.
    print(f"[{time.strftime('%H:%M:%S')}] extending via nearest-sibling…", flush=True)
    lat = coords[:, 0].astype(np.float32)
    lon = coords[:, 1].astype(np.float32)
    cos_lat = np.cos(lat); sin_lat = np.sin(lat)
    cos_lon = np.cos(lon); sin_lon = np.sin(lon)
    xyz = np.stack([cos_lat * cos_lon, sin_lat, cos_lat * sin_lon], axis=1).astype(np.float32)

    # Build a per-(cl, sub) index of labeled indices.
    labeled_mask = assignments != 255
    extended_count = 0
    for cl_str in sub_meta.keys():
        cl = int(cl_str)
        for s in sub_meta[cl_str]:
            sub_loc = int(s["sub"])
            sub_mask = (cluster == cl) & (sub_local == sub_loc)
            members = np.where(sub_mask)[0]
            if len(members) == 0:
                continue
            labeled = members[labeled_mask[members]]
            unlabeled = members[~labeled_mask[members]]
            if len(labeled) == 0 or len(unlabeled) == 0:
                continue
            L = xyz[labeled]
            U = xyz[unlabeled]
            # Cosine similarity == dot-product on unit vectors. Nearest =
            # argmax of U @ L.T. Batched to keep memory down.
            BATCH = 4096
            for off in range(0, len(unlabeled), BATCH):
                blk = U[off:off + BATCH]
                sims = blk @ L.T
                best = sims.argmax(axis=1)
                for k, bi in enumerate(best):
                    src = labeled[int(bi)]
                    assignments[unlabeled[off + k]] = assignments[src]
                    extended_count += 1
    total_assigned += extended_count
    print(f"[{time.strftime('%H:%M:%S')}] extended {extended_count:,} points; "
          f"{total_assigned:,} / {total_in_subs:,} now assigned "
          f"({100*total_assigned/max(1,total_in_subs):.1f}%)", flush=True)

    # Recompute anchors with the extended assignments so counts reflect
    # the full population, not just the sampled 100/sub.
    for gid, (cl, sub_loc, sub_name) in enumerate(group_order):
        if str(gid) not in anchors_doc:
            continue
        cl_name = cluster_meta.get(str(cl), {}).get("name", f"Cluster {cl}")
        sub_mask = (cluster == cl) & (sub_local == sub_loc)
        rec = anchors_doc[str(gid)]
        for entry in rec["positions"]:
            p_idx = entry["idx"]
            mask = sub_mask & (assignments == p_idx)
            n = int(mask.sum())
            if n > 0:
                a_lat, a_lon, density = spherical_mean(coords[mask])
                entry["lat"] = a_lat
                entry["lon"] = a_lon
                entry["count"] = n
                entry["density"] = density
            else:
                entry["count"] = 0
    if missing_clusters:
        print(f"  missing position files for clusters: "
              f"{sorted(missing_clusters)}", flush=True)

    (CHUNKS / "positions.json").write_text(json.dumps({"by_gid": positions_doc}))
    (CHUNKS / "position_anchors.json").write_text(json.dumps(anchors_doc))
    (CHUNKS / "position_assignments.bin").write_bytes(assignments.tobytes())
    print(f"  wrote positions.json / position_anchors.json / position_assignments.bin")


if __name__ == "__main__":
    main()

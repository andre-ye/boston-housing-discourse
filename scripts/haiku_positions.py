#!/usr/bin/env python3
"""Re-derive positions for every sub-cluster using Claude Haiku, and
assign every point in the sub-cluster to one of them.

Replaces the keyword-matching approach in attribute_positions.py. Haiku
both *invents* the positions (stances/viewpoints) from a sample of posts,
and then *classifies* every remaining post into the best-fitting one.

Pipeline, per sub-cluster:
  1. Gather all points belonging to (cluster=cl, subLocal=sub).
  2. Sample ~120 posts → ask Haiku to propose 3-6 distinct positions
     (each with a short noun-phrase name + a sentence-form stance).
     Haiku also tags each sampled post with its position index.
  3. Classify remaining points in batches of POSTS_PER_BATCH → Haiku
     picks a position index or "none" per post.
  4. Compute per-position density-peak anchors on the sphere.

Outputs (matching what the viewer already consumes):
  viz/tsne_chunks/positions.json             (LLM-derived positions per gid)
  viz/tsne_chunks/position_assignments.bin   (uint8 per point; 255 = unassigned)
  viz/tsne_chunks/position_anchors.json      (density peaks per position)

Resumable: a checkpoint file records per-sub state so re-runs skip subs
that already have a result. Delete the checkpoint to start over.

Costs rough estimate: 422 k posts / 40 per batch × 194 subs = ~11 k calls.
At Haiku pricing (2025-26) this is single-digit dollars. The script prints
a running estimate every sub.

Usage:
  export ANTHROPIC_API_KEY=...
  python scripts/haiku_positions.py                 # full run
  python scripts/haiku_positions.py --only-sub 42   # one sub
  python scripts/haiku_positions.py --limit-subs 4  # quick smoke test
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import numpy as np

try:
    import anthropic
except ImportError:
    sys.exit("anthropic package required: pip install anthropic")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)

ROOT = Path(__file__).resolve().parent.parent
CHUNKS = ROOT / "viz" / "tsne_chunks"

MODEL = "claude-haiku-4-5-20251001"
SAMPLE_FOR_POSITIONS = 120          # posts sent to Haiku to *invent* positions
POSTS_PER_CLASSIFY_BATCH = 40       # posts per classify call
POST_SNIPPET_CHARS = 420            # per-post char cap
MAX_WORKERS = 8                     # parallel API calls per sub
MAX_POSITIONS = 6                   # cap on positions per sub

PROPOSE_SYSTEM = (
    "You analyze Reddit posts from a narrow subtopic and identify the "
    "distinct positions (stances, viewpoints, or recurring framings) that "
    "people actually express. Positions must be specific statements — "
    "what the posts argue, complain about, or claim — not categories."
)
PROPOSE_USER_TEMPLATE = """Subtopic: "{sub_name}" (within the broader cluster "{cluster_name}").

Below are {n} numbered posts sampled from this subtopic. Read them and return a JSON object with:
  - "positions": an array of 3 to {max_positions} distinct positions. Each position has:
      "name"        : a short (2-6 word) noun-phrase label, e.g. "Rents push longtime residents out"
      "description" : a single-sentence stance in the form of a claim, e.g. "Rising rents are forcing longtime residents out of the neighborhoods they grew up in."
      "example_ids" : up to 8 post ids from the sample that best exemplify this position
  - "assignments": an object mapping every post id in the sample to either a position index (0-based) or null if it doesn't fit any position

Return ONLY the JSON object, no prose.

POSTS:
{posts}
"""

CLASSIFY_SYSTEM = (
    "You classify Reddit posts into pre-defined positions (stances) for a "
    "subtopic. For each post, return the single best-matching position "
    "index, or null if none fits."
)
CLASSIFY_USER_TEMPLATE = """Subtopic: "{sub_name}".

POSITIONS:
{positions_block}

For each of the {n} numbered posts below, return a JSON object {{"assignments": {{post_id: position_index_or_null, ...}}}} with one entry per post. Return ONLY the JSON.

POSTS:
{posts}
"""


# ─── Data loading ─────────────────────────────────────────────────────
def load_points() -> dict[str, Any]:
    """Return {cluster: int16[N], subLocal: uint8[N], coords: float32[N*2],
    texts: list[str] of length N}."""
    # Per-point cluster + subLocal are already packed in point_labels.bin.
    buf = (CHUNKS / "point_labels.bin").read_bytes()
    N = len(buf) // 3
    cluster = np.empty(N, dtype=np.int16)
    sub_local = np.empty(N, dtype=np.uint8)
    for i in range(N):
        lo, hi = buf[3 * i], buf[3 * i + 1]
        v = (hi << 8) | lo
        if v & 0x8000:
            v -= 0x10000
        cluster[i] = v
        sub_local[i] = buf[3 * i + 2]
    coords = np.frombuffer(
        (CHUNKS / "sphere_coords.bin").read_bytes(), dtype=np.float32
    ).reshape(-1, 2)
    assert coords.shape[0] == N

    # Stream chunk files to pull title+body per point.
    manifest = json.loads((CHUNKS / "manifest.json").read_text())
    texts: list[str] = [""] * N
    print(f"[{time.strftime('%H:%M:%S')}] loading {len(manifest['files'])} chunks for text…")
    for fn in manifest["files"]:
        c = json.loads((CHUNKS / fn).read_text())
        off = c["offset"]
        titles = c.get("title", [""] * c["n"])
        bodies = c.get("body", [""] * c["n"])
        for j in range(c["n"]):
            t = (titles[j] or "").strip()
            b = (bodies[j] or "").strip()
            joined = f"{t} — {b}" if t and b else (t or b)
            texts[off + j] = joined[:POST_SNIPPET_CHARS]
    return {"cluster": cluster, "subLocal": sub_local, "coords": coords, "texts": texts}


def load_meta() -> dict[str, Any]:
    cluster_meta = json.loads((CHUNKS / "cluster_labels.json").read_text())
    # cluster_labels.json wraps in {"embedding": {...}} or direct map
    if "embedding" in cluster_meta:
        cluster_meta = cluster_meta["embedding"]
    sub_meta = json.loads((CHUNKS / "subcluster_labels.json").read_text())
    return {"cluster": cluster_meta, "sub": sub_meta}


# ─── Claude calls ────────────────────────────────────────────────────
_client: anthropic.Anthropic | None = None

def client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


_JSON_RE = re.compile(r"\{[\s\S]*\}")


def _call_haiku(system: str, user: str, max_tokens: int = 4096) -> dict:
    """Single call with one retry + JSON extraction."""
    for attempt in range(2):
        try:
            r = client().messages.create(
                model=MODEL,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
            txt = "".join(b.text for b in r.content if b.type == "text").strip()
            m = _JSON_RE.search(txt)
            if not m:
                raise ValueError(f"no JSON in response: {txt[:200]}")
            return json.loads(m.group(0))
        except Exception as exc:
            if attempt == 1:
                raise
            time.sleep(1.5 + random.random())


def propose_positions(sub_name: str, cluster_name: str, sample: list[tuple[int, str]]) -> dict:
    """sample: [(post_id, text), ...]. Returns the parsed JSON."""
    posts_block = "\n\n".join(f"[{pid}] {txt}" for pid, txt in sample)
    user = PROPOSE_USER_TEMPLATE.format(
        sub_name=sub_name,
        cluster_name=cluster_name,
        n=len(sample),
        max_positions=MAX_POSITIONS,
        posts=posts_block,
    )
    return _call_haiku(PROPOSE_SYSTEM, user, max_tokens=4096)


def classify_batch(sub_name: str, positions: list[dict], batch: list[tuple[int, str]]) -> dict:
    posts_block = "\n\n".join(f"[{pid}] {txt}" for pid, txt in batch)
    positions_block = "\n".join(
        f"  {i}: {p['name']} — {p['description']}" for i, p in enumerate(positions)
    )
    user = CLASSIFY_USER_TEMPLATE.format(
        sub_name=sub_name,
        positions_block=positions_block,
        n=len(batch),
        posts=posts_block,
    )
    return _call_haiku(CLASSIFY_SYSTEM, user, max_tokens=2048)


# ─── Per-sub driver ──────────────────────────────────────────────────
def process_sub(
    cl: int,
    sub_local: int,
    sub_name: str,
    cluster_name: str,
    point_ids: np.ndarray,
    texts: list[str],
    rng: random.Random,
) -> dict:
    """Produce {positions, assignments} for one sub-cluster."""
    n = len(point_ids)
    sample_n = min(SAMPLE_FOR_POSITIONS, n)
    sample_indices = list(rng.sample(list(point_ids), sample_n))
    sample_map = {i: texts[i] for i in sample_indices if texts[i]}
    sample = [(pid, txt) for pid, txt in sample_map.items()]
    if not sample:
        return {"positions": [], "assignments": {int(i): None for i in point_ids}}

    print(f"  propose: sampling {len(sample)}/{n} posts…", flush=True)
    proposal = propose_positions(sub_name, cluster_name, sample)
    positions = proposal.get("positions", [])[:MAX_POSITIONS]
    if not positions:
        return {"positions": [], "assignments": {int(i): None for i in point_ids}}
    sample_assign = {int(k): v for k, v in (proposal.get("assignments") or {}).items()}

    # Classify every non-sampled point.
    remaining = [i for i in point_ids if int(i) not in sample_assign]
    assignments: dict[int, int | None] = {int(k): v for k, v in sample_assign.items()}
    if remaining:
        rem_texts = [(int(i), texts[int(i)]) for i in remaining if texts[int(i)]]
        # Batch + parallelize.
        batches = [
            rem_texts[k : k + POSTS_PER_CLASSIFY_BATCH]
            for k in range(0, len(rem_texts), POSTS_PER_CLASSIFY_BATCH)
        ]
        print(f"  classify: {len(rem_texts)} remaining in {len(batches)} batches…", flush=True)
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
            futures = {ex.submit(classify_batch, sub_name, positions, b): b for b in batches}
            done = 0
            for fut in as_completed(futures):
                done += 1
                try:
                    res = fut.result()
                    for k, v in (res.get("assignments") or {}).items():
                        try:
                            pid = int(k)
                        except ValueError:
                            continue
                        if isinstance(v, int) and 0 <= v < len(positions):
                            assignments[pid] = v
                        else:
                            assignments[pid] = None
                except Exception as exc:
                    print(f"    batch failed: {exc}", flush=True)
                if done % 10 == 0:
                    print(f"    … {done}/{len(batches)} batches", flush=True)
        # Posts with empty text → unassigned
        for i in remaining:
            if int(i) not in assignments:
                assignments[int(i)] = None
    return {"positions": positions, "assignments": assignments}


# ─── Anchors (density peak per position) ─────────────────────────────
def compute_anchor(lat_lon: np.ndarray) -> tuple[float, float, float]:
    """Return (lat, lon, density) of the densest 5° window in lat_lon."""
    if len(lat_lon) == 0:
        return (0.0, 0.0, 0.0)
    cos_lat = np.cos(lat_lon[:, 0])
    x = cos_lat * np.cos(lat_lon[:, 1])
    y = np.sin(lat_lon[:, 0])
    z = cos_lat * np.sin(lat_lon[:, 1])
    # spherical mean
    mx, my, mz = x.mean(), y.mean(), z.mean()
    r = (mx * mx + my * my + mz * mz) ** 0.5
    if r < 1e-9:
        return (float(lat_lon[0, 0]), float(lat_lon[0, 1]), 1.0)
    return (
        float(np.arcsin(np.clip(my / r, -1, 1))),
        float(np.arctan2(mz / r, mx / r)),
        float(r),
    )


# ─── Main ────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only-sub", type=int, default=None, help="gid to process (debug)")
    ap.add_argument("--limit-subs", type=int, default=None, help="process first N subs")
    ap.add_argument("--seed", type=int, default=17)
    ap.add_argument("--checkpoint", default=str(CHUNKS / "haiku_positions.ckpt.json"))
    args = ap.parse_args()

    if "ANTHROPIC_API_KEY" not in os.environ:
        sys.exit("ANTHROPIC_API_KEY not set")

    pts = load_points()
    meta = load_meta()
    N = len(pts["texts"])

    # Enumerate (cl, sub_local) groups and assign each a gid that matches
    # the viewer's subGidMap ordering: scan clusters ascending, subs ascending.
    sub_meta = meta["sub"]
    group_order: list[tuple[int, int, str]] = []
    for cl_str, subs in sub_meta.items():
        cl = int(cl_str)
        for s in subs:
            group_order.append((cl, int(s["sub"]), s["name"]))
    # Same ordering nav.js uses to assign gids:
    group_order.sort(key=lambda t: (t[0], t[1]))

    ckpt_path = Path(args.checkpoint)
    done: dict[str, Any] = {}
    if ckpt_path.exists():
        try:
            done = json.loads(ckpt_path.read_text())
            print(f"resume: {len(done)} subs already completed", flush=True)
        except Exception:
            done = {}

    # Build a reverse index (cl, sub_local) → point_ids to avoid re-scanning N per sub.
    print(f"[{time.strftime('%H:%M:%S')}] indexing point memberships…", flush=True)
    index: dict[tuple[int, int], list[int]] = {}
    cluster = pts["cluster"]
    sub_local = pts["subLocal"]
    for i in range(N):
        key = (int(cluster[i]), int(sub_local[i]))
        index.setdefault(key, []).append(i)

    out_positions: dict[str, Any] = {}
    assignments_full = np.full(N, 255, dtype=np.uint8)
    anchors: dict[str, Any] = {}

    rng = random.Random(args.seed)
    subs_to_do = group_order if args.only_sub is None else [group_order[args.only_sub]]
    if args.limit_subs:
        subs_to_do = subs_to_do[: args.limit_subs]

    for gid, (cl, sub_loc, sub_name) in enumerate(group_order):
        if args.only_sub is not None and gid != args.only_sub:
            continue
        if args.limit_subs is not None and gid >= args.limit_subs:
            break
        if str(gid) in done:
            rec = done[str(gid)]
            out_positions[str(gid)] = rec["positions_doc"]
            for pid_s, idx in rec["assignments"].items():
                if idx is not None and idx is not False:
                    assignments_full[int(pid_s)] = int(idx)
            anchors[str(gid)] = rec["anchors"]
            continue

        pids = np.asarray(index.get((cl, sub_loc), []), dtype=np.int64)
        cl_name = meta["cluster"].get(str(cl), {}).get("name", f"Cluster {cl}")
        if len(pids) == 0:
            out_positions[str(gid)] = {
                "sub_name": sub_name, "cluster_name": cl_name, "cl": cl, "positions": [],
            }
            continue
        print(f"\n[{time.strftime('%H:%M:%S')}] gid {gid}  cl={cl} sub={sub_loc}  "
              f"n={len(pids)}  '{sub_name}'", flush=True)
        try:
            res = process_sub(cl, sub_loc, sub_name, cl_name, pids, pts["texts"], rng)
        except Exception as exc:
            print(f"  ! gid {gid} failed: {exc}", flush=True)
            continue

        positions = res["positions"]
        for pid, idx in res["assignments"].items():
            if isinstance(idx, int) and 0 <= idx < len(positions):
                assignments_full[int(pid)] = int(idx)

        # Compute anchor per position from the points we just assigned.
        pos_docs = []
        anchor_records = []
        for p_idx, pos in enumerate(positions):
            mask_ids = [int(pid) for pid, v in res["assignments"].items() if v == p_idx]
            pos_doc = {
                "name": pos.get("name", f"Position {p_idx}"),
                "description": pos.get("description", ""),
                "keywords": [],            # kept for compat with older viewer code
                "example_sample_indices": pos.get("example_ids", []),
            }
            pos_docs.append(pos_doc)
            if mask_ids:
                sub_coords = pts["coords"][mask_ids]
                lat, lon, dens = compute_anchor(sub_coords)
                anchor_records.append({
                    "idx": p_idx, "lat": lat, "lon": lon,
                    "count": len(mask_ids), "density": dens,
                    "name": pos_doc["name"],
                })
            else:
                anchor_records.append({
                    "idx": p_idx, "lat": None, "lon": None,
                    "count": 0, "density": 0.0, "name": pos_doc["name"],
                })

        out_positions[str(gid)] = {
            "sub_name": sub_name,
            "cluster_name": cl_name,
            "cl": cl,
            "positions": pos_docs,
        }
        anchor_doc = {
            "cl": cl, "sub_name": sub_name, "cluster_name": cl_name,
            "positions": anchor_records,
        }
        anchors[str(gid)] = anchor_doc

        # Checkpoint after each sub.
        done[str(gid)] = {
            "positions_doc": out_positions[str(gid)],
            "assignments": {str(pid): int(v) if isinstance(v, int) else None
                            for pid, v in res["assignments"].items()},
            "anchors": anchor_doc,
        }
        ckpt_path.write_text(json.dumps(done))
        print(f"  ✓ gid {gid} checkpointed", flush=True)

    # Write final outputs.
    (CHUNKS / "positions.json").write_text(json.dumps({"by_gid": out_positions}))
    (CHUNKS / "position_anchors.json").write_text(json.dumps(anchors))
    (CHUNKS / "position_assignments.bin").write_bytes(assignments_full.tobytes())
    print(f"\n[{time.strftime('%H:%M:%S')}] wrote positions.json, "
          f"position_anchors.json, position_assignments.bin "
          f"({(assignments_full != 255).sum():,} / {N:,} assigned)", flush=True)


if __name__ == "__main__":
    main()

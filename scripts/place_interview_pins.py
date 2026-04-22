"""Pin each street-interview subject on the globe.

Two-stage matching:
  1. Score each subcluster's name + description against the interview's themes /
     role / quote. Pick the top subcluster (this guarantees the pin lands inside
     a topic-coherent blob, not on a lone word-match point).
  2. Within that subcluster, pick the single point whose title+body scores best
     against the same query — that's where the pin is placed.

Output: viz/interviews/pin_placements.json
"""
from __future__ import annotations
import json
import math
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHUNKS = ROOT / "viz" / "tsne_chunks"
INTERVIEWS = ROOT / "viz" / "interviews"

WORD = re.compile(r"[A-Za-z][A-Za-z']+")
STOPWORDS = set("""
a an the and or but if then of to for at by on in is are was were be been being with
as from into out up down i me my we our you your he she it its they them their this that
these those there here have has had do does did not no yes so just very really more most
some any all one two three very also too either neither than about over under after before
because because s t m d ll ve re don didn can could would should might must may shall will
what which who whom whose where when why how get got let us let's lets go went going say said
thing things stuff such etc each own same other another few many much little lot lots
""".split())

THEME_BOOST = 4.0
PHRASE_BOOST = 3.0
ROLE_BOOST = 2.0
TOKEN_BOOST = 1.0
LEN_PENALTY = 0.1  # discourage matching very short texts that happen to share a word

# Clusters to prefer / avoid for known non-Boston interviewees.
REGION_FILTER = {
    "P15": "exclude_boston_specific",   # SF
    "P17": "exclude_boston_specific",   # Philadelphia
}


def tokens(s: str) -> list[str]:
    return [w.lower() for w in WORD.findall(s or "") if len(w) >= 3 and w.lower() not in STOPWORDS]


def phrases(s: str) -> list[str]:
    """Return the input as lowercase short phrases (2-4 tokens)."""
    toks = [w.lower() for w in WORD.findall(s or "")]
    out = []
    for n in (2, 3, 4):
        for i in range(len(toks) - n + 1):
            chunk = toks[i:i + n]
            if all(t in STOPWORDS for t in chunk):
                continue
            out.append(" ".join(chunk))
    return out


def build_query(iv: dict) -> dict:
    """Assemble a scoring query from an interview entry."""
    role_text = iv.get("role") or ""
    theme_text = " ".join(iv.get("themes") or [])
    quote = iv.get("quote") or ""
    change = iv.get("change") or ""
    lives = iv.get("lives") or ""
    would_live = iv.get("would_live") or ""
    work = iv.get("work") or ""
    commute = iv.get("commute") or ""
    notes = iv.get("notes") or ""

    # Theme tokens get heavy weight.
    theme_tokens = Counter()
    for th in iv.get("themes") or []:
        for t in tokens(th):
            theme_tokens[t] += 1
    theme_phrases = set()
    for th in iv.get("themes") or []:
        for p in phrases(th):
            theme_phrases.add(p)

    # Role tokens: moderate weight.
    role_tokens = Counter(tokens(role_text))

    # Body tokens (everything): light weight.
    body = " ".join([quote, change, lives, would_live, work, commute, notes])
    body_tokens = Counter(tokens(body))
    body_phrases = set(phrases(quote + " " + change + " " + commute + " " + work))

    return {
        "theme_tokens": theme_tokens,
        "theme_phrases": theme_phrases,
        "role_tokens": role_tokens,
        "body_tokens": body_tokens,
        "body_phrases": body_phrases,
    }


def score_point(q: dict, title: str, body: str, subreddit: str) -> float:
    text = f"{title} {body} {subreddit}".lower()
    if not text.strip():
        return -1.0
    toks = set(WORD.findall(text))
    toks_lower = {t.lower() for t in toks}
    score = 0.0
    for t, w in q["theme_tokens"].items():
        if t in toks_lower:
            score += THEME_BOOST * math.sqrt(w)
    for t, w in q["role_tokens"].items():
        if t in toks_lower:
            score += ROLE_BOOST * math.sqrt(w)
    for t, w in q["body_tokens"].items():
        if t in toks_lower:
            score += TOKEN_BOOST * math.sqrt(w)
    for p in q["theme_phrases"]:
        if p in text:
            score += PHRASE_BOOST * (1 + p.count(" "))
    for p in q["body_phrases"]:
        if p in text:
            score += PHRASE_BOOST
    # normalize by log(len) so we don't over-reward long bodies
    length = max(50, len(text))
    score -= LEN_PENALTY * math.log(length / 200 + 1)
    return score


def score_label(q: dict, text: str) -> float:
    """Lightweight score for cluster/subcluster *names* — no length penalty."""
    if not text:
        return 0.0
    lower = text.lower()
    toks = {t.lower() for t in WORD.findall(text)}
    s = 0.0
    for t, w in q["theme_tokens"].items():
        if t in toks:
            s += THEME_BOOST * math.sqrt(w)
    for t, w in q["role_tokens"].items():
        if t in toks:
            s += ROLE_BOOST * math.sqrt(w)
    for t, w in q["body_tokens"].items():
        if t in toks:
            s += 0.5 * TOKEN_BOOST * math.sqrt(w)
    for p in q["theme_phrases"]:
        if p in lower:
            s += PHRASE_BOOST * 1.5 * (1 + p.count(" "))
    return s


MANUAL_OVERRIDES = {
    # Interviewees whose keyword match is poor because the relevant Boston
    # cluster uses different words than their transcript. Map to (cluster, sub)
    # and let stage-2 choose the best point inside.
    "P3": (38, None),    # car/parking/self-driving car → parking
    "P14": (48, None),   # UMass Amherst student — commuter rail navigation
    "P15": None,         # non-Boston; keep algo choice
    "P17": None,         # non-Boston; keep algo choice
}


def main():
    ivs = json.loads((INTERVIEWS / "interviews.json").read_text())["interviews"]
    queries = {iv["id"]: build_query(iv) for iv in ivs}

    manifest = json.loads((CHUNKS / "manifest.json").read_text())
    chunk_files = manifest["files"]

    # Load labels + coords up front; we'll filter candidates by cluster/sub.
    import numpy as np
    coords = np.frombuffer((CHUNKS / "sphere_coords.bin").read_bytes(), dtype=np.float32).reshape(-1, 2)
    labels_arr = np.frombuffer((CHUNKS / "point_labels.bin").read_bytes(), dtype=np.uint8).reshape(-1, 3)
    lo, hi = labels_arr[:, 0].astype(np.int32), labels_arr[:, 1].astype(np.int32)
    cluster_arr = (hi << 8) | lo
    cluster_arr = np.where(cluster_arr >= 0x8000, cluster_arr - 0x10000, cluster_arr).astype(np.int16)
    sub_arr = labels_arr[:, 2].astype(np.int32)

    # ── Stage 1: pick target (cluster, sub) from cluster/sub NAMES ──
    cluster_meta = json.loads((CHUNKS / "cluster_labels.json").read_text())
    cluster_meta = cluster_meta.get("embedding", cluster_meta)
    sub_meta = json.loads((CHUNKS / "subcluster_labels.json").read_text())

    # Score every (cluster, sub) for every interviewee; then place iteratively
    # with a diversity penalty so 7 people don't all pile onto the same sub.
    per_iv_scores: dict[str, list[tuple[float, int, int | None]]] = {}
    for iv in ivs:
        iv_id = iv["id"]
        q = queries[iv_id]
        ranked: list[tuple[float, int, int | None]] = []
        for cl_str, cl_m in cluster_meta.items():
            try:
                cl = int(cl_str)
            except ValueError:
                continue
            cluster_name = cl_m.get("name", "")
            cluster_desc = cl_m.get("description", "") or cl_m.get("summary", "")
            base = score_label(q, cluster_name + " " + cluster_desc)
            for sm in sub_meta.get(cl_str, []):
                sname = sm.get("name", "")
                sdesc = sm.get("description", "") or ""
                skw = " ".join(sm.get("keywords", []) or [])
                s = base + score_label(q, sname + " " + sdesc + " " + skw) * 2.0
                if s > 0:
                    ranked.append((s, cl, sm.get("sub")))
        ranked.sort(reverse=True)
        per_iv_scores[iv_id] = ranked

    # Iterative placement with a stiff penalty per reuse of the same sub.
    iv_targets: dict[str, tuple[int, int | None]] = {}
    sub_take_count: dict[tuple[int, int | None], int] = {}
    # Place interviewees in order of their top-1 score (strongest claims win).
    iv_order = sorted(ivs, key=lambda iv: -(per_iv_scores[iv["id"]][0][0] if per_iv_scores[iv["id"]] else 0))
    for iv in iv_order:
        iv_id = iv["id"]
        if iv_id in MANUAL_OVERRIDES and MANUAL_OVERRIDES[iv_id] is not None:
            iv_targets[iv_id] = MANUAL_OVERRIDES[iv_id]
            sub_take_count[MANUAL_OVERRIDES[iv_id]] = sub_take_count.get(MANUAL_OVERRIDES[iv_id], 0) + 1
            continue
        best = None
        best_adj = -1e9
        for s, cl, sub in per_iv_scores[iv_id][:30]:
            used = sub_take_count.get((cl, sub), 0)
            adj = s - 0.35 * s * used   # each reuse cuts effective score by 35%
            if adj > best_adj:
                best_adj = adj
                best = (cl, sub)
        if best is None:
            best = (0, None)
        iv_targets[iv_id] = best
        sub_take_count[best] = sub_take_count.get(best, 0) + 1

    print("Stage 1 — cluster/sub targets:")
    for iv in ivs:
        cl, sub = iv_targets[iv["id"]]
        cname = cluster_meta.get(str(cl), {}).get("name", "?")
        sname = "—"
        for sm in sub_meta.get(str(cl), []):
            if sm.get("sub") == sub:
                sname = sm.get("name", "?")
                break
        print(f"  {iv['id']:>4} → cl {cl:>2} ({cname[:30]:30}) / sub {sub}  ({sname})")

    # ── Stage 2: within the target (cl[, sub]), pick highest-scoring point ──
    best = {iv["id"]: {"score": -1e9, "idx": -1} for iv in ivs}
    top_k_per_iv: dict[str, list[dict]] = {iv["id"]: [] for iv in ivs}

    for fi, fname in enumerate(chunk_files):
        ch = json.loads((CHUNKS / fname).read_text())
        n = ch["n"]
        off = ch["offset"]
        title = ch["title"]
        panel_body = ch.get("panel_body") or [""] * n
        hover_body = ch.get("hover_body") or [""] * n
        subreddit = ch["subreddit"]
        bodies = [(panel_body[j] or hover_body[j] or "")[:800] for j in range(n)]
        for iv in ivs:
            iv_id = iv["id"]
            tcl, tsub = iv_targets[iv_id]
            q = queries[iv_id]
            top = top_k_per_iv[iv_id]
            for j in range(n):
                gi = off + j
                if int(cluster_arr[gi]) != int(tcl):
                    continue
                if tsub is not None and int(sub_arr[gi]) != int(tsub):
                    continue
                s = score_point(q, title[j] or "", bodies[j], subreddit[j] or "")
                if s > best[iv_id]["score"]:
                    best[iv_id] = {"score": s, "idx": gi}
                if len(top) < 5 or s > top[-1]["score"]:
                    top.append({"score": s, "idx": gi, "title": title[j] or "", "subreddit": subreddit[j] or ""})
                    top.sort(key=lambda r: r["score"], reverse=True)
                    del top[5:]
        print(f"  scored chunk {fi+1}/{len(chunk_files)}")

    placements = []
    for iv in ivs:
        iv_id = iv["id"]
        b = best[iv_id]
        cl, sub = iv_targets[iv_id]
        if b["idx"] < 0:
            # No points matched (shouldn't happen); fall back to cluster-only.
            mask_idx = np.where(cluster_arr == int(cl))[0]
            if len(mask_idx) == 0:
                continue
            b["idx"] = int(mask_idx[0])
        lat, lon = float(coords[b["idx"], 0]), float(coords[b["idx"], 1])
        placements.append({
            "id": iv_id,
            "role": iv.get("role"),
            "idx": int(b["idx"]),
            "lat": lat,
            "lon": lon,
            "cluster": int(cluster_arr[b["idx"]]),
            "sub": int(sub_arr[b["idx"]]),
            "target_cluster": int(cl),
            "target_sub": None if sub is None else int(sub),
            "score": round(b["score"], 2),
            "alternates": [
                {"idx": t["idx"], "score": round(t["score"], 2), "title": t["title"][:80], "subreddit": t["subreddit"]}
                for t in top_k_per_iv[iv_id][:5]
            ],
        })

    out = INTERVIEWS / "pin_placements.json"
    out.write_text(json.dumps({"placements": placements}, indent=2))
    print(f"\nWrote {out}")
    for p in placements:
        cname = cluster_meta.get(str(p["target_cluster"]), {}).get("name", "?")
        print(f"  {p['id']:>4}  cl {p['cluster']:>2}/{p['target_cluster']:>2} sub {p['sub']:>3}  ({cname[:32]:32})  alt: {p['alternates'][0]['title'][:50] if p['alternates'] else ''}")


if __name__ == "__main__":
    main()

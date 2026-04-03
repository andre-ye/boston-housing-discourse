#!/usr/bin/env python3
"""
One-off: align parquet, embeddings .npz, cluster .npz, and viz/tsne_payload.json to the
current config.yaml keyword_regex (same rules as filter_parquet_by_keywords.py).

Row order after filtering: same as filtered parquet (stable). Embeddings / t-SNE / cluster
arrays are reordered to match.

Backs up originals before overwrite (timestamped directory under data/).

Usage:
  .venv/bin/python filter_corpus_keyword_alignment.py --dry-run
  .venv/bin/python filter_corpus_keyword_alignment.py
  .venv/bin/python filter_corpus_keyword_alignment.py --no-chunks   # skip re-running chunk_tsne_payload.py
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from tqdm import tqdm

from config_util import load_config


def keyword_mask(df: pd.DataFrame, pattern: re.Pattern) -> pd.Series:
    is_sub = df["type"].astype(str).str.lower().eq("submission")
    sub_blob = df["title"].fillna("").astype(str) + "\n" + df["body"].fillna("").astype(str)
    com_blob = df["body"].fillna("").astype(str)
    combined = sub_blob.where(is_sub, com_blob)
    texts = combined.tolist()
    ok = [bool(pattern.search(t)) if isinstance(t, str) else False for t in tqdm(texts, desc="keyword match", unit="rows")]
    return pd.Series(ok, index=df.index, dtype=bool)


def backup_file(src: Path, backup_root: Path) -> Path:
    backup_root.mkdir(parents=True, exist_ok=True)
    dst = backup_root / src.name
    if src.is_file():
        shutil.copy2(src, dst)
    elif src.is_dir():
        shutil.copytree(src, dst, dirs_exist_ok=True)
    return dst


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", type=Path, default=Path("config.yaml"))
    ap.add_argument("--parquet", type=Path, default=Path("data/reddit_boston_housing.parquet"))
    ap.add_argument("--npz", type=Path, default=Path("data/embeddings_bge_large_en_v1_5.npz"))
    ap.add_argument("--clusters", type=Path, default=Path("data/clusters_k50.npz"))
    ap.add_argument("--payload", type=Path, default=Path("viz/tsne_payload.json"))
    ap.add_argument("--chunks-out", type=Path, default=Path("viz/tsne_chunks"))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-backup", action="store_true", help="Do not copy originals to data/backup_…")
    ap.add_argument("--no-chunks", action="store_true", help="Do not regenerate viz/tsne_chunks for D3 viewer")
    args = ap.parse_args()

    cfg = load_config(args.config)
    kw = (cfg.get("keyword_regex") or "").strip()
    if not kw:
        raise SystemExit("keyword_regex is empty")
    pattern = re.compile(kw, re.I | re.S)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_root = Path("data") / f"backup_keyword_filter_{stamp}"

    print(f"Loading {args.parquet} …", flush=True)
    df = pd.read_parquet(args.parquet)
    n0 = len(df)
    mask = keyword_mask(df, pattern)
    df_out = df.loc[mask].reset_index(drop=True)
    n_keep = len(df_out)
    print(f"parquet: {n0:,} -> {n_keep:,} (drop {n0 - n_keep:,})", flush=True)

    if n_keep == 0:
        raise SystemExit("no rows left after filter; abort")

    ids_ordered = df_out["id"].astype(str).tolist()

    print(f"Loading {args.npz} …", flush=True)
    z = np.load(args.npz, allow_pickle=True)
    npz_ids = np.asarray(z["ids"], dtype=str)
    emb = np.asarray(z["embeddings"], dtype=np.float32)
    if len(npz_ids) != len(emb):
        raise SystemExit(f"npz len(ids) != len(embeddings)")
    id_to_row = {str(npz_ids[i]): i for i in range(len(npz_ids))}
    missing = [i for i in ids_ordered if i not in id_to_row]
    if missing:
        raise SystemExit(f"{len(missing)} parquet ids missing from npz (e.g. {missing[:3]!r})")
    keep_idx = [id_to_row[i] for i in ids_ordered]
    if len(set(keep_idx)) != len(keep_idx):
        raise SystemExit("duplicate indices in npz for ordered ids")

    emb_out = emb[keep_idx]
    ts = None
    if "created_ts" in z.files:
        ts = np.asarray(z["created_ts"], dtype=np.float64)[keep_idx]
    extra_npz = {}
    for k in ("model", "device"):
        if k in z.files:
            extra_npz[k] = z[k]

    cz = None
    if args.clusters.exists():
        cz = np.load(args.clusters, allow_pickle=True)
        c_ids = np.asarray(cz["ids"], dtype=str)
        c_map = {str(c_ids[i]): i for i in range(len(c_ids))}
        miss_c = [i for i in ids_ordered if i not in c_map]
        if miss_c:
            raise SystemExit(f"{len(miss_c)} filtered ids missing from clusters (e.g. {miss_c[:3]!r})")

    P = None
    if args.payload.exists():
        print(f"Loading {args.payload} …", flush=True)
        with open(args.payload, encoding="utf-8") as f:
            P = json.load(f)
        px = P.get("x")
        if not isinstance(px, list) or len(px) != len(npz_ids):
            raise SystemExit(
                f"tsne_payload x length {len(px) if px else 0} != npz rows {len(npz_ids)}; "
                "regenerate payload with build_interactive_tsne_viewer.py first"
            )
        print(f"tsne_payload: {len(px):,} points (aligned with npz)", flush=True)

    if args.dry_run:
        print("dry-run: not writing files", flush=True)
        return

    if not args.no_backup:
        print(f"Backup -> {backup_root}/", flush=True)
        for p in (args.parquet, args.npz, args.clusters, args.payload):
            if p.exists():
                backup_file(p, backup_root)
        if args.chunks_out.exists() and args.chunks_out.is_dir():
            backup_file(args.chunks_out, backup_root)

    df_out.to_parquet(args.parquet, index=False)
    print(f"Wrote {args.parquet} ({n_keep:,} rows)", flush=True)

    save_kw = dict(ids=np.array(ids_ordered, dtype=str), embeddings=emb_out)
    if ts is not None:
        save_kw["created_ts"] = ts
    save_kw.update(extra_npz)
    args.npz.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.npz, **save_kw)
    print(f"Wrote {args.npz} {emb_out.shape}", flush=True)

    if cz is not None:
        c_ids = np.asarray(cz["ids"], dtype=str)
        labels = np.asarray(cz["labels"])
        if len(c_ids) != len(npz_ids):
            print(
                f"warning: clusters len {len(c_ids)} != embeddings len {len(npz_ids)}; "
                "rebuilding cluster slice by id only",
                flush=True,
            )
        c_map = {str(c_ids[i]): i for i in range(len(c_ids))}
        lab_out = np.array([labels[c_map[i]] for i in ids_ordered], dtype=np.int32)
        extra_c = {k: cz[k] for k in cz.files if k not in ("ids", "labels")}
        np.savez_compressed(
            args.clusters,
            ids=np.array(ids_ordered, dtype=str),
            labels=lab_out,
            **extra_c,
        )
        print(f"Wrote {args.clusters} labels {lab_out.shape}", flush=True)

    if P is not None:
        months_global = P.get("months")
        for k in list(P.keys()):
            if k == "months":
                continue
            v = P[k]
            if isinstance(v, list) and len(v) == len(npz_ids):
                P[k] = [v[i] for i in keep_idx]
        if months_global is not None:
            P["months"] = months_global
        args.payload.parent.mkdir(parents=True, exist_ok=True)
        with open(args.payload, "w", encoding="utf-8") as f:
            json.dump(P, f, ensure_ascii=True)
        print(f"Wrote {args.payload} ({len(P['x']):,} points)", flush=True)

    if not args.no_chunks and P is not None:
        chunk_py = Path(__file__).resolve().parent / "chunk_tsne_payload.py"
        if chunk_py.is_file():
            print("Regenerating tsne_chunks …", flush=True)
            rc = subprocess.run(
                [sys.executable, str(chunk_py), "--in", str(args.payload), "--out", str(args.chunks_out)],
                check=False,
            )
            if rc.returncode != 0:
                print("warning: chunk_tsne_payload.py failed; rerun manually", flush=True)
        else:
            print("warning: chunk_tsne_payload.py not found; skip chunks", flush=True)

    print("Done. Plotly/D3 viewers use the updated payload; re-open HTML if needed.", flush=True)


if __name__ == "__main__":
    main()

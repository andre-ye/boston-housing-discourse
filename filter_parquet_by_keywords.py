#!/usr/bin/env python3
"""
Retroactively keep only Parquet rows whose text matches config.yaml keyword_regex,
using the same rules as ingest_reddit_dump.py / collect_reddit.py:

  - submission: match against (title + "\\n" + body)
  - comment: match against body only

Example:
  .venv/bin/python filter_parquet_by_keywords.py --dry-run
  .venv/bin/python filter_parquet_by_keywords.py
"""

from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path

import pandas as pd
from tqdm import tqdm

from config_util import load_config


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--in", dest="inp", type=Path, default=Path("data/reddit_boston_housing.parquet"))
    ap.add_argument("--out", type=Path, default=None, help="Default: same as --in (replace in place).")
    ap.add_argument("--config", type=Path, default=Path("config.yaml"))
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Print counts only; do not write.",
    )
    ap.add_argument(
        "--no-backup",
        action="store_true",
        help="When writing, do not create a .bak copy of the input file.",
    )
    args = ap.parse_args()

    out_path = args.out or args.inp

    cfg = load_config(args.config)
    kw = (cfg.get("keyword_regex") or "").strip()
    if not kw:
        raise SystemExit("config keyword_regex is empty")

    pattern = re.compile(kw, re.I | re.S)

    df = pd.read_parquet(args.inp)
    n_in = len(df)

    is_sub = df["type"].astype(str).str.lower().eq("submission")
    sub_blob = df["title"].fillna("").astype(str) + "\n" + df["body"].fillna("").astype(str)
    com_blob = df["body"].fillna("").astype(str)
    combined = sub_blob.where(is_sub, com_blob)

    texts = combined.tolist()
    mask = [bool(pattern.search(t)) if isinstance(t, str) else False for t in tqdm(texts, desc="keyword match", unit="rows")]
    mask = pd.Series(mask, index=df.index, dtype=bool)
    n_keep = int(mask.sum())
    n_drop = n_in - n_keep

    print(f"keyword_regex from {args.config}")
    print(f"  rows in:   {n_in:,}")
    print(f"  match:     {n_keep:,}")
    print(f"  drop:      {n_drop:,}")

    if args.dry_run:
        print("dry-run: no file written")
        return

    out_df = df.loc[mask].reset_index(drop=True)

    if out_path == args.inp and not args.no_backup:
        bak = args.inp.with_suffix(args.inp.suffix + ".bak")
        shutil.copy2(args.inp, bak)
        print(f"backup: {bak}")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_df.to_parquet(out_path, index=False)
    print(f"wrote {len(out_df):,} rows -> {out_path.resolve()}")


if __name__ == "__main__":
    main()

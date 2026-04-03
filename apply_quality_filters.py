#!/usr/bin/env python3
"""Filter Parquet: drop r/Brighton rows; drop comments shorter than config min_chars_comment."""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from config_util import load_config
from quality_filters import apply_quality_filters


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--in", dest="inp", type=Path, default=Path("data/reddit_boston_housing.parquet"))
    ap.add_argument("--out", type=Path, default=Path("data/reddit_boston_housing.parquet"))
    ap.add_argument("--config", type=Path, default=Path("config.yaml"))
    ap.add_argument(
        "--min-chars-comment",
        type=int,
        default=None,
        help="Override config min_chars_comment (default: read from config.yaml).",
    )
    ap.add_argument("--keep-brighton", action="store_true", help="Do not drop r/Brighton.")
    args = ap.parse_args()

    cfg = load_config(args.config)
    min_cc = args.min_chars_comment
    if min_cc is None:
        min_cc = int(cfg.get("min_chars_comment") or 0)

    drop_subs: tuple[str, ...] = () if args.keep_brighton else ("brighton",)

    df = pd.read_parquet(args.inp)
    out, counts = apply_quality_filters(
        df,
        drop_subreddits=drop_subs,
        min_comment_chars=min_cc if min_cc > 0 else None,
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(args.out, index=False)

    print(f"min_chars_comment={min_cc} (from {'--min-chars-comment' if args.min_chars_comment is not None else args.config})")
    print(f"Read {counts['input_rows']:,} rows from {args.inp}")
    for k, v in counts.items():
        if k == "input_rows":
            continue
        print(f"  {k}: {v:,}")
    print(f"Wrote {counts['output_rows']:,} rows -> {args.out}")


if __name__ == "__main__":
    main()

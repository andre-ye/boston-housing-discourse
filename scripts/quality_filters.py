"""
Parquet row filters: geography (drop r/Brighton) and comment length vs config min_chars_comment.
"""

from __future__ import annotations

from typing import Iterable

import pandas as pd


def mask_subreddit_allowlist(df: pd.DataFrame, drop: Iterable[str]) -> pd.Series:
    s = df["subreddit"].str.lower()
    drop_l = {x.strip().lower() for x in drop if x and str(x).strip()}
    return ~s.isin(drop_l)


def mask_comment_min_chars(df: pd.DataFrame, min_chars: int) -> pd.Series:
    """Keep submissions always; drop comments whose stripped body is shorter than min_chars."""
    if min_chars <= 0:
        return pd.Series(True, index=df.index)
    is_com = df["type"].str.lower() == "comment"
    length = df["body"].fillna("").str.strip().str.len()
    return ~is_com | (length >= min_chars)


def apply_quality_filters(
    df: pd.DataFrame,
    *,
    drop_subreddits: Iterable[str] = ("brighton",),
    min_comment_chars: int | None = None,
) -> tuple[pd.DataFrame, dict[str, int]]:
    """Drop listed subreddits and comments under min_comment_chars (strip, Unicode)."""
    original = len(df)
    counts: dict[str, int] = {"input_rows": original}

    m = pd.Series(True, index=df.index)
    if drop_subreddits:
        step = mask_subreddit_allowlist(df, drop_subreddits)
        counts["dropped_subreddits"] = int((m & ~step).sum())
        m &= step
    if min_comment_chars is not None and min_comment_chars > 0:
        step = mask_comment_min_chars(df, min_comment_chars)
        counts["dropped_short_comments"] = int((m & ~step).sum())
        m &= step

    out = df.loc[m].reset_index(drop=True)
    counts["output_rows"] = len(out)
    counts["dropped_total"] = original - len(out)
    return out, counts

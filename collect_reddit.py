#!/usr/bin/env python3
"""
Collect Reddit submissions + top-level comments via the official API (PRAW).

Limits (important):
- Reddit search is incomplete; use many queries and subreddits, or ingest third-party archives for deep history.
- Listing endpoints cap around ~1000 "new" items; search returns a bounded set per query.
- Re-run this script on a schedule to accumulate "future" (newer) posts.

For bulk historical JSONL (torrent / dump), use ingest_reddit_dump.py into the same Parquet path.
"""

from __future__ import annotations

import argparse
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import praw
from dotenv import load_dotenv
from tqdm import tqdm

from config_util import load_config


def reddit_client() -> praw.Reddit:
    load_dotenv()
    return praw.Reddit(
        client_id=os.environ["REDDIT_CLIENT_ID"],
        client_secret=os.environ["REDDIT_CLIENT_SECRET"],
        user_agent=os.environ["REDDIT_USER_AGENT"],
        username=os.environ.get("REDDIT_USERNAME") or None,
        password=os.environ.get("REDDIT_PASSWORD") or None,
    )


def utc_dt(ts: float) -> datetime:
    return datetime.fromtimestamp(ts, tz=timezone.utc)


def collect(
    reddit: praw.Reddit,
    cfg: dict,
    dedupe: bool,
    out_path: Path,
    merge_existing: bool,
) -> None:
    subreddits = cfg["subreddits"]
    queries = cfg["search_queries"]
    time_filter = cfg.get("time_filter", "all")
    max_subs = int(cfg.get("max_submissions_per_query", 250))
    max_comments = int(cfg.get("max_top_level_comments_per_submission", 50))
    replace_more = int(cfg.get("replace_more_limit", 0))
    kw = cfg.get("keyword_regex") or ""
    pattern = re.compile(kw, re.I | re.S) if kw else None
    min_sub = int(cfg.get("min_chars_submission") or 0)
    min_com = int(cfg.get("min_chars_comment") or 0)

    rows: list[dict] = []
    seen_ids: set[str] = set()

    for sub in subreddits:
        subreddit = reddit.subreddit(sub)
        for q in tqdm(queries, desc=f"r/{sub}"):
            try:
                it = subreddit.search(q, sort="new", time_filter=time_filter, limit=max_subs)
            except Exception as e:
                tqdm.write(f"search failed r/{sub} q={q!r}: {e}")
                continue
            for s in it:
                if dedupe and s.id in seen_ids:
                    continue
                seen_ids.add(s.id)
                text = f"{s.title or ''}\n{s.selftext or ''}".strip()
                if min_sub > 0 and len(text) < min_sub:
                    continue
                if pattern and not pattern.search(text):
                    continue
                created = utc_dt(s.created_utc)
                rows.append(
                    {
                        "id": f"t3_{s.id}",
                        "type": "submission",
                        "subreddit": sub,
                        "created_utc": created.isoformat(),
                        "created_ts": s.created_utc,
                        "score": s.score,
                        "title": s.title,
                        "body": s.selftext or "",
                        "permalink": f"https://reddit.com{s.permalink}",
                        "search_query": q,
                    }
                )
                s.comments.replace_more(limit=replace_more)
                top = list(s.comments)[:max_comments]
                for c in top:
                    if not getattr(c, "body", None):
                        continue
                    if dedupe and c.id in seen_ids:
                        continue
                    seen_ids.add(c.id)
                    ctext = c.body
                    if min_com > 0 and len(ctext.strip()) < min_com:
                        continue
                    if pattern and not pattern.search(ctext):
                        continue
                    rows.append(
                        {
                            "id": f"t1_{c.id}",
                            "type": "comment",
                            "subreddit": sub,
                            "created_utc": utc_dt(c.created_utc).isoformat(),
                            "created_ts": c.created_utc,
                            "score": c.score,
                            "title": "",
                            "body": ctext,
                            "permalink": f"https://reddit.com{c.permalink}",
                            "parent_submission_id": f"t3_{s.id}",
                            "search_query": q,
                        }
                    )

    new_df = pd.DataFrame(rows)
    if new_df.empty:
        print("No rows collected (check credentials, queries, or filters).")
        return
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if merge_existing and out_path.exists():
        old = pd.read_parquet(out_path)
        new_df = pd.concat([old, new_df], ignore_index=True)
        new_df = new_df.drop_duplicates(subset=["id"], keep="last")
    new_df = new_df.sort_values("created_ts").reset_index(drop=True)
    new_df.to_parquet(out_path, index=False)
    print(f"Wrote {len(new_df)} rows to {out_path}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--config", type=Path, default=Path("config.yaml"))
    p.add_argument("--out", type=Path, default=Path("data/reddit_boston_housing.parquet"))
    p.add_argument("--no-dedupe", action="store_true", help="Allow duplicate items across queries")
    p.add_argument(
        "--fresh",
        action="store_true",
        help="Ignore existing parquet at --out (default merges and dedupes by id)",
    )
    args = p.parse_args()
    cfg = load_config(args.config)
    collect(
        reddit_client(),
        cfg,
        dedupe=not args.no_dedupe,
        out_path=args.out,
        merge_existing=not args.fresh,
    )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Stream Reddit JSONL dumps (torrent / academic releases) into the same Parquet
schema as collect_reddit.py, so embed_tsne_viz.py stays unchanged.

Primary source: monthly Academic Torrents–style bundles (RC_YYYY-MM.zst comments,
RS_YYYY-MM.zst submissions), NDJSON inside zstd.

Use --flush-matches 200000 (or similar) when scanning full months so RAM stays
bounded; see DUMP_WORKFLOW.txt.

Dump schemas vary slightly; this handles typical keys (created_utc, subreddit,
title, selftext, body, id, score, permalink, link_id). Adjust with jq pre-pass
if your files use different names.

Use torrents only where licensing and your institution's rules allow; files are
very large — start with one month or one subreddit slice if available.
"""

from __future__ import annotations

import argparse
import fcntl
import gzip
import json
import re
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from tqdm import tqdm

import pyarrow as pa
import pyarrow.parquet as pq

from config_util import load_config


@contextmanager
def _parquet_merge_lock(out_path: Path):
    """Serialize merge into one Parquet when parallel workers ingest different months."""
    lock_p = out_path.parent / ".reddit_parquet_merge.lock"
    lock_p.parent.mkdir(parents=True, exist_ok=True)
    f = open(lock_p, "w", encoding="utf-8")
    fcntl.flock(f.fileno(), fcntl.LOCK_EX)
    try:
        yield
    finally:
        fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        f.close()


# Stable column order for Parquet streaming and merges with PRAW-collected rows.
PARQUET_COLS = [
    "id",
    "type",
    "subreddit",
    "created_utc",
    "created_ts",
    "score",
    "title",
    "body",
    "permalink",
    "search_query",
    "parent_submission_id",
]


def open_text_line_stream(path: Path):
    """Return a context manager yielding text lines (utf-8)."""
    suffixes = path.suffixes
    if suffixes and suffixes[-1] == ".gz":
        return gzip.open(path, "rt", encoding="utf-8", errors="replace")
    if suffixes and suffixes[-1] == ".zst":
        import zstandard as zstd

        return zstd.open(path, "rt", encoding="utf-8", errors="replace")
    return path.open("r", encoding="utf-8", errors="replace")


def norm_subreddit(raw) -> str:
    if raw is None:
        return ""
    if isinstance(raw, str):
        return raw
    if isinstance(raw, dict):
        return str(raw.get("display_name") or raw.get("name") or "")
    return str(raw)


def utc_iso(ts) -> str:
    if ts is None:
        return ""
    t = float(ts)
    return datetime.fromtimestamp(t, tz=timezone.utc).isoformat()


def norm_permalink(p: str) -> str:
    if not p:
        return ""
    p = p.strip()
    if p.startswith("http"):
        return p
    if p.startswith("/"):
        return "https://reddit.com" + p
    return "https://reddit.com/" + p.lstrip("/")


def detect_kind(obj: dict) -> str | None:
    if "link_id" in obj and "body" in obj:
        return "comment"
    if "title" in obj:
        return "submission"
    return None


def row_submission(
    obj: dict,
    subs: set[str],
    pattern: re.Pattern | None,
    min_chars: int,
) -> dict | None:
    sub = norm_subreddit(obj.get("subreddit")).strip().lower()
    if sub not in subs:
        return None
    title = (obj.get("title") or "").strip()
    selftext = (obj.get("selftext") or obj.get("body") or "").strip()
    if selftext in ("[removed]", "[deleted]"):
        selftext = ""
    blob = f"{title}\n{selftext}"
    if min_chars > 0 and len(blob.strip()) < min_chars:
        return None
    if pattern and not pattern.search(blob):
        return None
    rid = obj.get("id")
    if not rid:
        return None
    rid = str(rid)
    if not rid.startswith("t3_"):
        rid = f"t3_{rid}"
    ts = obj.get("created_utc")
    if ts is None:
        return None
    ts = float(ts)
    return {
        "id": rid,
        "type": "submission",
        "subreddit": sub,
        "created_utc": utc_iso(ts),
        "created_ts": ts,
        "score": int(obj.get("score") or 0),
        "title": title,
        "body": selftext,
        "permalink": norm_permalink(str(obj.get("permalink") or "")),
        "search_query": "reddit_dump",
        "parent_submission_id": None,
    }


def row_comment(
    obj: dict,
    subs: set[str],
    pattern: re.Pattern | None,
    min_chars: int,
) -> dict | None:
    sub = norm_subreddit(obj.get("subreddit")).strip().lower()
    if sub not in subs:
        return None
    body = (obj.get("body") or "").strip()
    if not body or body in ("[removed]", "[deleted]"):
        return None
    if min_chars > 0 and len(body) < min_chars:
        return None
    if pattern and not pattern.search(body):
        return None
    rid = obj.get("id")
    if not rid:
        return None
    rid = str(rid)
    if not rid.startswith("t1_"):
        rid = f"t1_{rid}"
    ts = obj.get("created_utc")
    if ts is None:
        return None
    ts = float(ts)
    link_id = obj.get("link_id") or ""
    link_id = str(link_id)
    if link_id and not link_id.startswith("t3_"):
        link_id = "t3_" + link_id.removeprefix("t3_")
    return {
        "id": rid,
        "type": "comment",
        "subreddit": sub,
        "created_utc": utc_iso(ts),
        "created_ts": ts,
        "score": int(obj.get("score") or 0),
        "title": "",
        "body": body,
        "permalink": norm_permalink(str(obj.get("permalink") or "")),
        "parent_submission_id": link_id or None,
        "search_query": "reddit_dump",
    }


def parse_line(
    line: str,
    subs: set[str],
    pattern: re.Pattern | None,
    since_ts: float | None,
    until_ts: float | None,
    min_chars_submission: int,
    min_chars_comment: int,
) -> dict | None:
    line = line.strip()
    if not line:
        return None
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(obj, dict):
        return None
    kind = detect_kind(obj)
    if kind == "submission":
        row = row_submission(obj, subs, pattern, min_chars_submission)
    elif kind == "comment":
        row = row_comment(obj, subs, pattern, min_chars_comment)
    else:
        return None
    if row is None:
        return None
    ts = row["created_ts"]
    if since_ts is not None and ts < since_ts:
        return None
    if until_ts is not None and ts > until_ts:
        return None
    return row


def _rows_to_table(rows: list[dict]) -> pa.Table:
    df = pd.DataFrame(rows)
    for c in PARQUET_COLS:
        if c not in df.columns:
            df[c] = pd.NA
    df = df[PARQUET_COLS]
    return pa.Table.from_pandas(df, preserve_index=False)


def sorted_dump_paths(paths: list[Path]) -> list[Path]:
    """Oldest YYYY-MM first when present in filename (RS_/RC_ dumps)."""

    def key(p: Path) -> tuple[str, str]:
        m = re.search(r"(20\d{2}-\d{2})", p.name)
        ym = m.group(1) if m else "9999-99"
        return (ym, p.name.lower())

    return sorted(paths, key=key)


def ingest_files(
    paths: list[Path],
    cfg: dict,
    out_path: Path,
    merge_existing: bool,
    max_lines: int,
    max_matched: int,
    flush_matches: int,
    skip_keyword_filter: bool,
    since_ts: float | None,
    until_ts: float | None,
) -> None:
    with _parquet_merge_lock(out_path):
        subs = {str(s).strip().lower() for s in cfg.get("subreddits", [])}
        kw = "" if skip_keyword_filter else (cfg.get("keyword_regex") or "")
        pattern = re.compile(kw, re.I | re.S) if kw else None
        min_sub = int(cfg.get("min_chars_submission") or 0)
        min_com = int(cfg.get("min_chars_comment") or 0)

        rows: list[dict] = []
        n_in = 0
        n_matched = 0
        writer: pq.ParquetWriter | None = None
        tmp_path = out_path.with_suffix(out_path.suffix + ".ingest_tmp")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        use_stream = flush_matches > 0
        write_to_tmp = use_stream and merge_existing and out_path.exists()
        stream_target = tmp_path if write_to_tmp else out_path

        def flush_buffer() -> None:
            nonlocal writer, rows
            if not rows:
                return
            table = _rows_to_table(rows)
            if writer is None:
                writer = pq.ParquetWriter(stream_target, table.schema)
            else:
                table = table.cast(writer.schema)
            writer.write_table(table)
            rows = []

        outer = tqdm(paths, desc="files")
        for path in outer:
            outer.set_postfix_str(path.name)
            try:
                with open_text_line_stream(path) as f:
                    for line in tqdm(f, desc=path.name, leave=False):
                        if max_lines and n_in >= max_lines:
                            break
                        n_in += 1
                        r = parse_line(
                            line,
                            subs,
                            pattern,
                            since_ts,
                            until_ts,
                            min_sub,
                            min_com,
                        )
                        if r:
                            if max_matched and n_matched >= max_matched:
                                break
                            rows.append(r)
                            n_matched += 1
                            if use_stream and len(rows) >= flush_matches:
                                flush_buffer()
                            if max_matched and n_matched >= max_matched:
                                break
            except (OSError, EOFError, ValueError) as e:
                tqdm.write(f"[warn] skipping {path}: {e!r}")
            except Exception as e:
                tqdm.write(f"[warn] skipping {path} after error: {type(e).__name__}: {e!r}")
            if max_lines and n_in >= max_lines:
                break
            if max_matched and n_matched >= max_matched:
                break

        if use_stream:
            flush_buffer()
            if writer is not None:
                writer.close()
                writer = None
            if n_matched == 0:
                tmp_path.unlink(missing_ok=True)
                print("No rows matched filters. Check subreddit names and dump format.")
                return
            new_df = pd.read_parquet(stream_target)
        else:
            new_df = pd.DataFrame(rows)
            if new_df.empty:
                print("No rows matched filters. Check subreddit names and dump format.")
                return
            for c in PARQUET_COLS:
                if c not in new_df.columns:
                    new_df[c] = pd.NA
            new_df = new_df[PARQUET_COLS]

        # Merge only when new rows are not already the on-disk file: streaming to a
        # new out_path reads back that file as new_df — do not concat with out_path again.
        if merge_existing and out_path.exists() and (write_to_tmp or not use_stream):
            old = pd.read_parquet(out_path)
            new_df = pd.concat([old, new_df], ignore_index=True)
            new_df = new_df.drop_duplicates(subset=["id"], keep="last")
        if write_to_tmp and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        new_df = new_df.sort_values("created_ts").reset_index(drop=True)
        new_df.to_parquet(out_path, index=False)
        print(f"Wrote {len(new_df)} rows to {out_path}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--config", type=Path, default=Path("config.yaml"))
    p.add_argument(
        "--in",
        dest="inputs",
        type=Path,
        nargs="*",
        default=[],
        help="Input paths (.zst / .gz / plain NDJSON)",
    )
    p.add_argument(
        "--glob",
        action="append",
        default=[],
        metavar="PATTERN",
        help="Glob pattern (repeatable); merged with --in",
    )
    p.add_argument("--out", type=Path, default=Path("data/reddit_boston_housing.parquet"))
    p.add_argument("--fresh", action="store_true", help="Do not merge existing --out")
    p.add_argument("--max-lines", type=int, default=0, help="Stop after N source lines (0 = no limit)")
    p.add_argument(
        "--max-matched-rows",
        type=int,
        default=0,
        help="Stop after N kept rows (0 = no limit)",
    )
    p.add_argument(
        "--flush-matches",
        type=int,
        default=0,
        help="Stream Parquet in chunks of this many matches (0 = buffer all in RAM)",
    )
    p.add_argument(
        "--no-keyword-filter",
        action="store_true",
        help="Only filter by subreddit (faster scan; larger output)",
    )
    p.add_argument("--since", type=str, default="", help="UTC date YYYY-MM-DD inclusive")
    p.add_argument("--until", type=str, default="", help="UTC date YYYY-MM-DD inclusive")
    args = p.parse_args()

    paths: list[Path] = list(args.inputs)
    for pattern in args.glob:
        paths.extend(Path().glob(pattern))
    paths = sorted_dump_paths([p.resolve() for p in {p.resolve() for p in paths}])
    if not paths:
        p.error("Provide at least one path via --in and/or --glob")

    since_ts = None
    until_ts = None
    if args.since:
        since_ts = datetime.fromisoformat(args.since + "T00:00:00+00:00").timestamp()
    if args.until:
        until_ts = datetime.fromisoformat(args.until + "T23:59:59+00:00").timestamp()

    cfg = load_config(args.config)
    ingest_files(
        paths,
        cfg,
        args.out,
        merge_existing=not args.fresh,
        max_lines=args.max_lines,
        max_matched=args.max_matched_rows,
        flush_matches=args.flush_matches,
        skip_keyword_filter=args.no_keyword_filter,
        since_ts=since_ts,
        until_ts=until_ts,
    )


if __name__ == "__main__":
    main()

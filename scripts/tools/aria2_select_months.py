#!/usr/bin/env python3
"""
Build an aria2c command that downloads only RC_*.zst / RS_*.zst for months in [start,end].

Requires: aria2c on PATH. Uses `aria2c -S` to list file indices (--show-files; see aria2 manual).

Options:
  --dir PATH   include --dir= in the printed command (your dumps folder)
  --execute    run aria2c after printing (same flags)
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.torrent_utils import (  # noqa: E402
    aria2_list_files,
    ensure_local_torrent,
    months_in_range,
    parse_month_label,
)


def _month_arg(s: str) -> str:
    parse_month_label(s)
    return s.strip()


def indices_for_months(rows: list[tuple[int, str]], allowed: set[str]) -> list[int]:
    pat = re.compile(r"(RC|RS)_(\d{4}-\d{2})\.zst")
    idxs: list[int] = []
    for idx, p in rows:
        m = pat.search(p.replace("\\", "/"))
        if m and m.group(2) in allowed:
            idxs.append(idx)
    return sorted(set(idxs))


def main() -> None:
    ap = argparse.ArgumentParser(description="Build aria2c --select-file for RC/RS month range")
    ap.add_argument("--torrent", required=True, help="URL or path to .torrent file")
    ap.add_argument("--start", type=_month_arg, default="2020-01", help="YYYY-MM inclusive")
    ap.add_argument("--end", type=_month_arg, default="2025-12", help="YYYY-MM inclusive")
    ap.add_argument("--dir", type=Path, help="Output directory (for --dir=)")
    ap.add_argument("--execute", action="store_true", help="Run aria2c after printing")
    ap.add_argument(
        "--aria2",
        default="aria2c",
        help="aria2c binary name or path",
    )
    ap.add_argument(
        "--rate-limit",
        default="10M",
        help="Pass to --max-overall-download-limit (e.g. 10M). Use 0 to disable.",
    )
    ap.add_argument(
        "--force-torrent-refresh",
        action="store_true",
        help="Re-download .torrent from URL even if state/ cache exists",
    )
    args = ap.parse_args()

    allowed = set(months_in_range(args.start, args.end))
    local_torrent = ensure_local_torrent(args.torrent, force_refresh=args.force_torrent_refresh)

    rows = aria2_list_files(args.aria2, local_torrent)
    idxs = indices_for_months(rows, allowed)
    if not idxs:
        print("No RC_/RS_ files matched the month range. First 20 paths:", file=sys.stderr)
        for i, p in rows[:20]:
            print(f"  {i}|{p}", file=sys.stderr)
        sys.exit(1)

    sel = ",".join(str(i) for i in idxs)
    cmd = [
        args.aria2,
        f"--select-file={sel}",
        "--seed-time=0",
        "--file-allocation=none",
    ]
    if args.rate_limit and args.rate_limit != "0":
        cmd.append(f"--max-overall-download-limit={args.rate_limit}")
    if args.dir is not None:
        cmd.append(f"--dir={args.dir.resolve()}")
    cmd.append(str(local_torrent))

    print("Matched", len(idxs), "file(s) for months", args.start, "…", args.end)
    print("Local .torrent:", local_torrent)
    print()
    print("Run:")
    print(" ", subprocess.list2cmdline(cmd))
    print()

    if args.execute:
        sys.exit(subprocess.call(cmd, stdin=subprocess.DEVNULL))


if __name__ == "__main__":
    main()

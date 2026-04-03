#!/usr/bin/env python3
"""
Download one month (RC+RS), ingest with filters, delete raw .zst staging, repeat.
Runs several months in parallel via a thread pool (each month: aria2 then ingest).

Stop any long-running single aria2 download of the whole bundle first (kill that PID).

Example:
  python pipeline_months.py --workers 3 --start 2020-01 --end 2025-12 \\
    --torrent https://academictorrents.com/download/3d426c47c767d40f82c7ef0f47c3acacedd2bf44.torrent

Requires: aria2c, curl. Parquet merges are locked (see ingest_reddit_dump.py).

Logging: each run writes logs/pipeline_runs/<timestamp>/main.log plus per-month
aria2/ingest logs. Use --no-console for file-only (e.g. nohup overnight).
"""

from __future__ import annotations

import argparse
import glob
import logging
import os
import re
import shutil
import subprocess
import sys
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.pipeline_logging import get_logger, setup_logging  # noqa: E402
from tools.torrent_utils import (  # noqa: E402
    aria2_list_files,
    ensure_local_torrent,
    month_index_pairs,
    months_in_range,
    parse_month_label,
)

log = get_logger("pipeline")


def _short_path(p: Path) -> str:
    try:
        return str(p.relative_to(ROOT))
    except ValueError:
        return str(p)


def _month_arg(s: str) -> str:
    parse_month_label(s)
    return s.strip()


def _zst_paths_for_month(staging: Path, month: str) -> list[Path]:
    """Exactly RC_YYYY-MM.zst and RS_YYYY-MM.zst under staging (any subdir)."""
    safe = re.escape(month)
    pat = re.compile(rf"^(RC|RS)_{safe}\.zst$", re.IGNORECASE)
    found = sorted(p for p in staging.rglob("*.zst") if pat.match(p.name))
    return found


def _completed_months_from_logs(log_paths: list[Path]) -> set[str]:
    done: set[str] = set()
    pat = re.compile(r"RESULT ok\s+(\d{4}-\d{2})")
    for p in log_paths:
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        done.update(pat.findall(text))
    return done


def process_one_month(
    month: str,
    rc_idx: int,
    rs_idx: int,
    *,
    torrent_path: Path,
    aria2: str,
    rate_limit: str,
    flush_matches: int,
    py: str,
    run_dir: Path,
) -> tuple[str, bool, str]:
    staging = ROOT / "dumps" / ".staging" / month
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True, exist_ok=True)
    aria_log = run_dir / f"{month}_aria2.log"
    ingest_log = run_dir / f"{month}_ingest.log"
    try:
        cmd = [
            aria2,
            f"--select-file={rc_idx},{rs_idx}",
            "--seed-time=0",
            "--file-allocation=none",
        ]
        if rate_limit and rate_limit != "0":
            cmd.append(f"--max-overall-download-limit={rate_limit}")
        cmd.extend([f"--dir={staging}", str(torrent_path)])
        log.info("month %s: aria2 RC=%s RS=%s — log %s", month, rc_idx, rs_idx, _short_path(aria_log))
        log.debug("month %s: aria2 cmd %s", month, cmd)
        with open(aria_log, "w", encoding="utf-8") as af:
            af.write(f"# aria2c {month}\n# {' '.join(cmd)}\n\n")
            af.flush()
            r = subprocess.run(cmd, cwd=str(ROOT), stdin=subprocess.DEVNULL, stdout=af, stderr=subprocess.STDOUT)
        if r.returncode != 0:
            log.error("month %s: aria2c exit %s (see %s)", month, r.returncode, aria_log.name)
            return month, False, f"aria2c exit {r.returncode}"

        zsts = _zst_paths_for_month(staging, month)
        if len(zsts) != 2:
            log.error("month %s: expected 2 .zst, found %s: %s", month, len(zsts), zsts)
            return month, False, f"expected exactly 2 .zst for {month}, found {len(zsts)}: {zsts}"

        ingest_cmd = [
            py,
            str(ROOT / "ingest_reddit_dump.py"),
            "--config",
            str(ROOT / "config.yaml"),
            "--out",
            str(ROOT / "data" / "reddit_boston_housing.parquet"),
            "--flush-matches",
            str(flush_matches),
            "--in",
            *[str(p) for p in zsts],
        ]
        log.info("month %s: ingest — files %s — log %s", month, [p.name for p in zsts], _short_path(ingest_log))
        log.debug("month %s: ingest cmd %s", month, ingest_cmd)
        with open(ingest_log, "w", encoding="utf-8") as inf:
            inf.write(f"# ingest_reddit_dump {month}\n# {' '.join(ingest_cmd)}\n\n")
            inf.flush()
            r2 = subprocess.run(
                ingest_cmd,
                cwd=str(ROOT),
                stdin=subprocess.DEVNULL,
                stdout=inf,
                stderr=subprocess.STDOUT,
                env={**os.environ, "PYTHONUNBUFFERED": "1"},
            )
        if r2.returncode != 0:
            log.error("month %s: ingest exit %s (see %s)", month, r2.returncode, ingest_log.name)
            return month, False, f"ingest exit {r2.returncode}"
        log.info("month %s: completed ok", month)
        return month, True, "ok"
    except Exception as e:
        log.exception("month %s: unexpected error", month)
        return month, False, f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def main() -> None:
    ap = argparse.ArgumentParser(description="Parallel month-by-month torrent + ingest")
    ap.add_argument(
        "--torrent",
        default="https://academictorrents.com/download/3d426c47c767d40f82c7ef0f47c3acacedd2bf44.torrent",
        help=".torrent URL or path",
    )
    ap.add_argument("--start", type=_month_arg, default="2020-01")
    ap.add_argument("--end", type=_month_arg, default="2025-12")
    ap.add_argument(
        "--workers",
        type=int,
        default=3,
        metavar="N",
        help="Parallel month jobs (threads)",
    )
    ap.add_argument("--aria2", default="aria2c", help="aria2c binary path or name")
    ap.add_argument(
        "--rate-limit",
        default="20M",
        help="aria2 --max-overall-download-limit per worker (0 = no cap)",
    )
    ap.add_argument("--flush-matches", type=int, default=250_000)
    ap.add_argument(
        "--force-torrent-refresh",
        action="store_true",
        help="Re-download .torrent from URL even if state/ cache exists",
    )
    ap.add_argument(
        "--reverse",
        action="store_true",
        help="Process months in reverse chronological order",
    )
    ap.add_argument(
        "--log-dir",
        type=Path,
        default=None,
        metavar="DIR",
        help="Directory for main.log and per-month logs (default: logs/pipeline_runs/<timestamp>)",
    )
    ap.add_argument(
        "--no-console",
        action="store_true",
        help="Log only to files (no stderr); use with nohup overnight",
    )
    ap.add_argument(
        "--verbose",
        action="store_true",
        help="DEBUG logging (full commands, extra detail)",
    )
    ap.add_argument(
        "--skip-completed",
        action="store_true",
        help="Skip months that already have 'RESULT ok YYYY-MM' in historical main.log files",
    )
    ap.add_argument(
        "--completed-from-glob",
        default="logs/pipeline_runs/*/main.log",
        help="Glob for historical main.log files used by --skip-completed",
    )
    args = ap.parse_args()

    if args.workers < 1:
        ap.error("--workers must be >= 1")

    run_dir = (args.log_dir.expanduser().resolve() if args.log_dir else None) or (
        ROOT / "logs" / "pipeline_runs" / datetime.now().strftime("%Y%m%d_%H%M%S")
    )
    run_dir.mkdir(parents=True, exist_ok=True)
    main_log = run_dir / "main.log"
    setup_logging(main_log, verbose=args.verbose, console=not args.no_console)
    log.info("pid=%s cwd=%s", os.getpid(), ROOT)
    log.info("argv=%s", sys.argv)
    log.info(
        "python=%s platform=%s",
        sys.version.split()[0],
        sys.platform,
    )
    log.info("run_dir=%s", run_dir)
    try:
        (run_dir / "pipeline.pid").write_text(str(os.getpid()), encoding="utf-8")
    except OSError as e:
        log.warning("could not write pipeline.pid: %s", e)

    month_list = months_in_range(args.start, args.end)
    log.info("month range %s … %s (%s calendar months)", args.start, args.end, len(month_list))

    local_torrent = ensure_local_torrent(args.torrent, force_refresh=args.force_torrent_refresh)
    log.info("torrent file %s", local_torrent)
    rows = aria2_list_files(args.aria2, local_torrent)
    log.info("aria2 listed %s torrent file entries", len(rows))
    pairs = month_index_pairs(rows, month_list)
    missing = [m for m in month_list if m not in pairs]
    if missing:
        log.warning("no RC+RS pair in torrent for: %s", ", ".join(missing[:20]))
        if len(missing) > 20:
            log.warning("… and %s more missing months", len(missing) - 20)
    todo = [m for m in month_list if m in pairs]
    if args.reverse:
        todo = list(reversed(todo))

    if args.skip_completed:
        hist_glob = args.completed_from_glob
        if not Path(hist_glob).is_absolute():
            hist_glob = str((ROOT / hist_glob).resolve())
        hist_logs = sorted(Path(p) for p in glob.glob(hist_glob))
        done_months = _completed_months_from_logs(hist_logs)
        before = len(todo)
        todo = [m for m in todo if m not in done_months]
        skipped = before - len(todo)
        log.info(
            "skip_completed=%s history_logs=%s skipped_months=%s remaining=%s",
            args.skip_completed,
            len(hist_logs),
            skipped,
            len(todo),
        )
        if skipped:
            preview = sorted([m for m in month_list if m in done_months])[:20]
            if preview:
                log.info("skip_completed preview: %s", ", ".join(preview))
            if skipped > len(preview):
                log.info("skip_completed ... and %s more", skipped - len(preview))

    if not todo:
        log.error("no months to process")
        sys.exit(2)

    py = sys.executable
    workers = min(args.workers, len(todo))
    log.info(
        "months_to_process=%s workers=%s rate_limit=%s flush_matches=%s reverse=%s",
        len(todo),
        workers,
        args.rate_limit,
        args.flush_matches,
        args.reverse,
    )
    for m in todo:
        log.debug("month %s torrent indices RC=%s RS=%s", m, pairs[m][0], pairs[m][1])

    ok = 0
    fail = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {
            ex.submit(
                process_one_month,
                m,
                pairs[m][0],
                pairs[m][1],
                torrent_path=local_torrent,
                aria2=args.aria2,
                rate_limit=args.rate_limit,
                flush_matches=args.flush_matches,
                py=py,
                run_dir=run_dir,
            ): m
            for m in todo
        }
        for fut in as_completed(futs):
            month, success, msg = fut.result()
            if success:
                ok += 1
                print(f"[ok] {month}", file=sys.stderr)
                log.info("RESULT ok %s", month)
            else:
                fail += 1
                print(f"[FAIL] {month}: {msg}", file=sys.stderr)
                log.error("RESULT fail %s: %s", month, msg)

    log.info("finished ok=%s fail=%s output_parquet=%s", ok, fail, ROOT / "data" / "reddit_boston_housing.parquet")
    log.info("utc_end=%s", datetime.now(timezone.utc).isoformat())
    print()
    print(f"Done. ok={ok} fail={fail}  output: data/reddit_boston_housing.parquet")
    print(f"Logs: {run_dir}", file=sys.stderr)
    if fail:
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logging.getLogger("reddit_pipeline").warning("interrupted (KeyboardInterrupt)")
        sys.exit(130)
    except Exception:
        logging.getLogger("reddit_pipeline").exception("fatal error")
        raise

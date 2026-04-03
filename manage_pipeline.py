#!/usr/bin/env python3
"""
Long-running coordinator: watches dumps/ for new RC_*.zst / RS_*.zst, ingests only
unseen files (manifest), merges into data/reddit_boston_housing.parquet.

Filtering: ingest_reddit_dump.py only writes rows that pass subreddit + keyword filters;
everything else is dropped on the fly (not stored in RAM or Parquet). Optional:
--delete-dumps-after-ingest removes each .zst after a successful run to save disk.

If no dumps are present but .env has Reddit API keys, periodically runs collect_reddit.py
so something still accumulates.

Run (foreground):  python manage_pipeline.py
Run (daemon):      nohup python manage_pipeline.py >> logs/manager.log 2>&1 &
"""

from __future__ import annotations

import fcntl
import os
import subprocess
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
STATE = ROOT / "state"
MANIFEST = STATE / "processed_dumps.txt"
LOCK_PATH = STATE / "manager.lock"
VENV_PY = ROOT / ".venv" / "bin" / "python"


def log(msg: str) -> None:
    line = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()) + " — " + msg
    print(line, flush=True)


def list_dump_files(dumps: Path) -> list[Path]:
    """Find RC_*.zst / RS_*.zst under dumps/ (any depth; torrents often use comments/ and submissions/)."""
    out: list[Path] = []
    for pat in ("RC_*.zst", "RS_*.zst"):
        out.extend(dumps.rglob(pat))
    return sorted({p.resolve() for p in out}, key=lambda p: p.name)


def load_manifest() -> set[str]:
    if not MANIFEST.exists():
        return set()
    return {ln.strip() for ln in MANIFEST.read_text(encoding="utf-8").splitlines() if ln.strip()}


def append_manifest(paths: list[Path]) -> None:
    STATE.mkdir(parents=True, exist_ok=True)
    with open(MANIFEST, "a", encoding="utf-8") as f:
        for p in paths:
            f.write(str(p.resolve()) + "\n")


def env_truthy(name: str) -> bool:
    v = os.environ.get(name, "").strip().lower()
    return v in ("1", "true", "yes", "on")


def delete_dump_files(paths: list[Path]) -> None:
    for p in paths:
        try:
            p.unlink(missing_ok=True)
            log(f"removed processed dump: {p.name}")
        except OSError as e:
            log(f"could not remove {p}: {e}")


def acquire_lock() -> None:
    STATE.mkdir(parents=True, exist_ok=True)
    lock = open(LOCK_PATH, "w", encoding="utf-8")
    try:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log("Another manager instance is already running (lock held). Exiting.")
        sys.exit(1)
    lock.write(str(os.getpid()) + "\n")
    lock.flush()
    # Keep lock file open for process lifetime
    globals()["_lock_fp"] = lock


def run_ingest(paths: list[Path], flush_matches: int, out_parquet: Path) -> int:
    cmd = [
        str(VENV_PY if VENV_PY.exists() else sys.executable),
        str(ROOT / "ingest_reddit_dump.py"),
        "--config",
        str(ROOT / "config.yaml"),
        "--out",
        str(out_parquet),
        "--flush-matches",
        str(flush_matches),
        "--in",
        *[str(p) for p in paths],
    ]
    log("ingest: " + " ".join(cmd[:8]) + f" ... ({len(paths)} file(s))")
    return subprocess.call(cmd, cwd=str(ROOT))


def run_collect() -> int:
    py = str(VENV_PY if VENV_PY.exists() else sys.executable)
    cmd = [py, str(ROOT / "collect_reddit.py"), "--config", str(ROOT / "config.yaml")]
    log("collect_reddit (API top-up)")
    return subprocess.call(cmd, cwd=str(ROOT))


def api_configured() -> bool:
    load_dotenv(ROOT / ".env")
    return bool(os.environ.get("REDDIT_CLIENT_ID") and os.environ.get("REDDIT_CLIENT_SECRET"))


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--dumps", type=Path, default=ROOT / "dumps")
    ap.add_argument("--out", type=Path, default=ROOT / "data" / "reddit_boston_housing.parquet")
    ap.add_argument("--poll-seconds", type=int, default=120)
    ap.add_argument("--flush-matches", type=int, default=250_000)
    ap.add_argument(
        "--collect-every-seconds",
        type=int,
        default=7200,
        help="If no dump files yet, run PRAW this often when API keys exist (0=disable)",
    )
    ap.add_argument(
        "--delete-dumps-after-ingest",
        action="store_true",
        help="Delete each .zst after successful ingest (frees disk; keep torrents elsewhere if you need re-runs)",
    )
    args = ap.parse_args()

    if env_truthy("DELETE_DUMPS_AFTER_INGEST"):
        args.delete_dumps_after_ingest = True

    acquire_lock()
    log(f"manager start pid={os.getpid()} dumps={args.dumps}")

    done = load_manifest()
    last_collect = 0.0

    while True:
        args.dumps.mkdir(parents=True, exist_ok=True)
        (ROOT / "data").mkdir(parents=True, exist_ok=True)

        all_files = list_dump_files(args.dumps)
        new = [p for p in all_files if str(p) not in done]

        if new:
            rc = run_ingest(new, args.flush_matches, args.out)
            if rc == 0:
                append_manifest(new)
                done.update(str(p) for p in new)
                log(f"ingest OK; total manifest entries={len(done)}")
                if args.delete_dumps_after_ingest:
                    delete_dump_files(new)
            else:
                log(f"ingest failed rc={rc}; will retry these files on next cycle")

        elif args.collect_every_seconds > 0 and api_configured():
            now = time.monotonic()
            if now - last_collect >= args.collect_every_seconds:
                rc = run_collect()
                last_collect = now
                if rc != 0:
                    log(f"collect_reddit failed rc={rc}")
        elif not all_files:
            log("no dump files yet; place RC_*.zst / RS_*.zst in dumps/ (or add .env for API top-up)")

        time.sleep(args.poll_seconds)


if __name__ == "__main__":
    main()

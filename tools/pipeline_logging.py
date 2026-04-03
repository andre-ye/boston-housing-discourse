"""Shared logging setup for pipeline_months and torrent helpers."""

from __future__ import annotations

import logging
import sys
from pathlib import Path

_ROOT = "reddit_pipeline"


def setup_logging(
    main_log: Path | None,
    *,
    verbose: bool = False,
    console: bool = True,
) -> logging.Logger:
    """
    Configure the root namespace logger for this project. Child loggers use
    names like reddit_pipeline.torrent_utils and propagate here.
    """
    root = logging.getLogger(_ROOT)
    root.handlers.clear()
    root.setLevel(logging.DEBUG if verbose else logging.INFO)
    root.propagate = False

    fmt = logging.Formatter(
        "%(asctime)s %(levelname)s [%(threadName)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    if main_log is not None:
        main_log.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(main_log, encoding="utf-8")
        fh.setFormatter(fmt)
        root.addHandler(fh)
    if console:
        sh = logging.StreamHandler(sys.stderr)
        sh.setFormatter(fmt)
        root.addHandler(sh)
    return root


def get_logger(suffix: str) -> logging.Logger:
    """Return a child logger under reddit_pipeline (e.g. suffix 'torrent_utils')."""
    return logging.getLogger(f"{_ROOT}.{suffix}")

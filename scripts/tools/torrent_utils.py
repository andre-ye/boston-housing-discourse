"""Shared helpers for Academic Torrents .torrent listing (aria2c -S)."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse

from tools.pipeline_logging import get_logger

ROOT = Path(__file__).resolve().parent.parent

log = get_logger("torrent_utils")

# Typical bencode torrents start with 'd'; keeps obviously bad downloads out.
_MIN_TORRENT_BYTES = 64

_MONTH = re.compile(r"^(20\d{2})-(0[1-9]|1[0-2])$")


def parse_month_label(label: str) -> tuple[int, int]:
    """Parse YYYY-MM; raises ValueError if invalid."""
    m = _MONTH.fullmatch(label.strip())
    if not m:
        raise ValueError(f"Expected YYYY-MM (2000–2099), got {label!r}")
    return int(m.group(1)), int(m.group(2))


def months_in_range(start: str, end: str) -> list[str]:
    """Inclusive list of YYYY-MM strings from start through end."""
    sy, sm = parse_month_label(start)
    ey, em = parse_month_label(end)
    if (sy, sm) > (ey, em):
        raise ValueError("start after end")
    out: list[str] = []
    y, m = sy, sm
    while (y, m) <= (ey, em):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out


def ensure_local_torrent(path_or_url: str, *, force_refresh: bool = False) -> Path:
    """
    Return a local .torrent path. For http(s) URLs, download once into state/
    (atomic write, non-empty check). Reuses cache unless force_refresh is True.
    """
    raw = path_or_url.strip()
    if raw.startswith(("http://", "https://")):
        parsed = urlparse(raw)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError(f"Invalid torrent URL: {path_or_url!r}")
        state = ROOT / "state"
        state.mkdir(parents=True, exist_ok=True)
        dest = state / "academic_reddit_bundle.torrent"
        if dest.is_file() and dest.stat().st_size >= _MIN_TORRENT_BYTES and not force_refresh:
            log.info("using cached .torrent %s (%s bytes)", dest, dest.stat().st_size)
            return dest
        log.info("fetching .torrent from %s → %s", parsed.netloc, dest)
        tmp = dest.with_suffix(dest.suffix + ".part")
        try:
            subprocess.run(
                [
                    "curl",
                    "-fsSL",
                    "--globoff",
                    "-o",
                    str(tmp),
                    raw,
                ],
                check=True,
                stdin=subprocess.DEVNULL,
            )
        except subprocess.CalledProcessError:
            tmp.unlink(missing_ok=True)
            raise RuntimeError(f"curl failed to download torrent from {parsed.netloc}") from None
        try:
            if tmp.stat().st_size < _MIN_TORRENT_BYTES:
                raise RuntimeError("Downloaded .torrent is empty or too small")
            with tmp.open("rb") as f:
                if f.read(1) != b"d":
                    raise RuntimeError("Download does not look like a bencode torrent (dict)")
        except OSError:
            tmp.unlink(missing_ok=True)
            raise
        tmp.replace(dest)
        log.info("saved .torrent %s (%s bytes)", dest, dest.stat().st_size)
        return dest

    path = Path(raw).expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Torrent file not found: {path}")
    if path.stat().st_size < _MIN_TORRENT_BYTES:
        raise ValueError(f"Torrent file too small to be valid: {path}")
    log.info("using local .torrent %s (%s bytes)", path, path.stat().st_size)
    return path


def parse_show_files(stdout: str) -> list[tuple[int, str]]:
    rows: list[tuple[int, str]] = []
    for line in stdout.splitlines():
        m = re.match(r"^\s*(\d+)\|(.+)$", line)
        if m:
            rows.append((int(m.group(1)), m.group(2).strip()))
    return rows


def aria2_list_files(aria2: str, torrent_path: Path) -> list[tuple[int, str]]:
    r = subprocess.run(
        [aria2, "-S", str(torrent_path)],
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
    )
    if r.returncode != 0:
        log.warning("aria2c -S stderr/stdout: %s", (r.stderr or r.stdout or "").strip()[:4000])
        raise RuntimeError(f"aria2c -S failed with code {r.returncode}")
    rows = parse_show_files(r.stdout)
    if not rows:
        raise RuntimeError("No files parsed from aria2c -S output; check torrent URL.")
    return rows


def month_index_pairs(rows: list[tuple[int, str]], months: list[str]) -> dict[str, tuple[int, int]]:
    """Map YYYY-MM -> (RC index, RS index). Last occurrence wins if duplicates exist."""
    rc: dict[str, int] = {}
    rs: dict[str, int] = {}
    for idx, p in rows:
        p = p.replace("\\", "/")
        m = re.search(r"RC_(\d{4}-\d{2})\.zst", p)
        if m:
            rc[m.group(1)] = idx
        m = re.search(r"RS_(\d{4}-\d{2})\.zst", p)
        if m:
            rs[m.group(1)] = idx
    out: dict[str, tuple[int, int]] = {}
    for ym in months:
        if ym in rc and ym in rs:
            out[ym] = (rc[ym], rs[ym])
    return out

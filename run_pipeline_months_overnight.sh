#!/usr/bin/env bash
# Start pipeline_months.py in the background with full file logging (survives closing the laptop/terminal).
#
# Before sleep: ensure no other aria2c is downloading the full bundle; activate venv; then:
#   chmod +x run_pipeline_months_overnight.sh
#   ./run_pipeline_months_overnight.sh
#
# Watch progress:
#   tail -f logs/pipeline_runs/<RUN_ID>/main.log
# Per-month download / ingest detail:
#   ls logs/pipeline_runs/<RUN_ID>/
#
# Stop:
#   kill "$(cat logs/pipeline_runs/<RUN_ID>/pipeline.pid)"
#
# Environment (optional overrides):
#   START=2020-01 END=2025-12 WORKERS=3 RATE_LIMIT=20M
#   TORRENT_URL=...  FORCE_TORRENT=1  FLUSH_MATCHES=250000  VERBOSE=1
#   REVERSE=1   # run months newest->oldest within [START, END]
#   SKIP_COMPLETED=1  # skip months already logged as RESULT ok (default on)

set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

mkdir -p logs/pipeline_runs data state

if [[ ! -f .venv/bin/activate ]]; then
  echo "Missing .venv. Run: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi
# shellcheck source=/dev/null
source .venv/bin/activate

export PYTHONUNBUFFERED=1

START="${START:-2020-01}"
END="${END:-2025-12}"
WORKERS="${WORKERS:-3}"
RATE_LIMIT="${RATE_LIMIT:-20M}"
FLUSH_MATCHES="${FLUSH_MATCHES:-250000}"
TORRENT_URL="${TORRENT_URL:-https://academictorrents.com/download/3d426c47c767d40f82c7ef0f47c3acacedd2bf44.torrent}"
FORCE_TORRENT="${FORCE_TORRENT:-0}"
REVERSE="${REVERSE:-0}"
SKIP_COMPLETED="${SKIP_COMPLETED:-1}"

RUN_ID="$(date +%Y%m%d_%H%M%S)"
LOG_DIR="$ROOT/logs/pipeline_runs/${RUN_ID}"
mkdir -p "$LOG_DIR"

PY="$ROOT/.venv/bin/python"
ARGS=(
  "$PY" "$ROOT/pipeline_months.py"
  "--start" "$START"
  "--end" "$END"
  "--workers" "$WORKERS"
  "--rate-limit" "$RATE_LIMIT"
  "--flush-matches" "$FLUSH_MATCHES"
  "--torrent" "$TORRENT_URL"
  "--log-dir" "$LOG_DIR"
  "--no-console"
)

if [[ "$FORCE_TORRENT" == "1" ]]; then
  ARGS+=("--force-torrent-refresh")
fi
if [[ "$REVERSE" == "1" ]]; then
  ARGS+=("--reverse")
fi
if [[ "$SKIP_COMPLETED" == "1" ]]; then
  ARGS+=("--skip-completed")
fi
if [[ "${VERBOSE:-0}" == "1" ]]; then
  ARGS+=("--verbose")
fi

echo "=== pipeline overnight $(date -u) ==="
echo "LOG_DIR=$LOG_DIR"
echo "START=$START END=$END WORKERS=$WORKERS RATE_LIMIT=$RATE_LIMIT FLUSH_MATCHES=$FLUSH_MATCHES REVERSE=$REVERSE SKIP_COMPLETED=$SKIP_COMPLETED"
echo "tail -f $LOG_DIR/main.log"
echo

nohup "${ARGS[@]}" >>"$LOG_DIR/nohup.out" 2>&1 &
echo $! >"$LOG_DIR/pipeline.pid"

echo "Started PID $(cat "$LOG_DIR/pipeline.pid")"
echo "Logs: $LOG_DIR/main.log"
echo "Also: $LOG_DIR/nohup.out (crash output before Python logging starts)"

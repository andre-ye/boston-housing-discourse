#!/usr/bin/env bash
# Ingest all Academic Torrents–style monthly dumps under $DUMPS into one Parquet (merge + dedupe).
# Usage: place RS_YYYY-MM.zst and RC_YYYY-MM.zst in dumps/, then:
#   chmod +x run_overnight.sh
#   ./run_overnight.sh
# Env:
#   DUMPS              — folder with .zst files (default: ./dumps)
#   WAIT_MAX_MINUTES   — if no .zst yet, poll this many minutes (default: 720 = 12h)
#   FLUSH_MATCHES      — chunk size for streaming (default: 250000)

set -euo pipefail
set -o pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

mkdir -p logs dumps data
LOG="logs/ingest_$(date +%Y%m%d_%H%M%S).log"
DUMPS="${DUMPS:-$ROOT/dumps}"
WAIT_MAX_MINUTES="${WAIT_MAX_MINUTES:-720}"
FLUSH_MATCHES="${FLUSH_MATCHES:-250000}"

if [[ ! -f .venv/bin/activate ]]; then
  echo "Missing .venv. Run: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" | tee "$LOG"
  exit 1
fi
# shellcheck source=/dev/null
source .venv/bin/activate

wait_for_dumps() {
  local start now deadline
  start=$(date +%s)
  deadline=$((start + WAIT_MAX_MINUTES * 60))
  while true; do
    shopt -s nullglob
    local files=( "$DUMPS"/RC_*.zst "$DUMPS"/RS_*.zst )
    shopt -u nullglob
    if ((${#files[@]} > 0)); then
      echo "Found ${#files[@]} dump file(s) under $DUMPS"
      return 0
    fi
    now=$(date +%s)
    if ((now >= deadline)); then
      echo "Timeout after ${WAIT_MAX_MINUTES}m: no RC_*.zst / RS_*.zst in $DUMPS"
      return 1
    fi
    echo "$(date -u) — waiting for .zst files in $DUMPS (next check in 120s)..."
    sleep 120
  done
}

wait_for_dumps | tee "$LOG"

exec > >(tee -a "$LOG") 2>&1
echo "=== ingest start $(date -u) ==="
echo "DUMPS=$DUMPS FLUSH_MATCHES=$FLUSH_MATCHES"

python ingest_reddit_dump.py \
  --config config.yaml \
  --glob "$DUMPS/RS_*.zst" \
  --glob "$DUMPS/RC_*.zst" \
  --flush-matches "$FLUSH_MATCHES" \
  --out data/reddit_boston_housing.parquet

echo "=== ingest done $(date -u) ==="

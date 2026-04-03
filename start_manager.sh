#!/usr/bin/env bash
# Start the long-running pipeline manager (single instance via flock).
# Optional: export DELETE_DUMPS_AFTER_INGEST=1 to delete each .zst after successful ingest.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
mkdir -p logs dumps data state
if [[ ! -f .venv/bin/activate ]]; then
  echo "Missing .venv — run: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
  exit 1
fi
# shellcheck source=/dev/null
source .venv/bin/activate
exec >> logs/manager.log 2>&1
echo "=== $(date -u) launching manager ==="
exec python -u manage_pipeline.py "$@"

#!/usr/bin/env bash
# Local static server for viz/ — browsers block ES modules and fetch() over file://
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VIZ="$ROOT/viz"
PORT="${PORT:-8765}"
PY="python3"
if [[ -x "$ROOT/.venv/bin/python" ]]; then
  PY="$ROOT/.venv/bin/python"
fi
cd "$VIZ"
echo "Serving:  $VIZ"
echo "Open:     http://127.0.0.1:${PORT}/"
echo "Press Ctrl+C to stop."
exec "$PY" -m http.server "$PORT" --bind 127.0.0.1

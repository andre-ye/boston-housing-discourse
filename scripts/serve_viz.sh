#!/usr/bin/env bash
# Local static server for viz/ — browsers block ES modules and fetch() over file://
# Uses a no-cache handler so edits are always picked up on plain Cmd+R.
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
exec "$PY" - "$PORT" <<'PYEOF'
import sys, http.server, functools

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # This header is what makes the no-`?v=` policy in viz/ safe — every
        # response is uncacheable, so import URLs don't need cache-buster
        # query strings (which would create duplicate ES module instances if
        # any importer drifted out of sync). Don't loosen this without
        # restoring per-import cache busting.
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()
    def log_message(self, fmt, *args):
        pass  # silence per-request noise

http.server.test(HandlerClass=NoCacheHandler, port=port, bind='127.0.0.1')
PYEOF
